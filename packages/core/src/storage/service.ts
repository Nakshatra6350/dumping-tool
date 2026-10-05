import {
  STORAGE_MODES,
  type PlatformStorageView,
  type S3PublicConfig,
  type S3Secrets,
  type S3TargetInput,
  type S3TargetView,
  type StorageCheckResult,
  type StorageLocation,
  type StorageMode,
  type StorageModeSource,
  type TenantStorageView,
} from "@dbrb/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Actor, AuditService } from "../audit/service";
import type { AppConfig } from "../config";
import type { KeyProvider } from "../crypto/keys";
import { openJson, sealJson } from "../crypto/seal";
import { storageTargets } from "../db/common";
import type { Db } from "../db/mysql";
import { badRequest, forbidden, notFound, unprocessable } from "../errors";
import { newId } from "../ids";
import type { SettingsService } from "../settings/service";
import { toTenantView, type TenantRecord, type TenantService } from "../tenancy/tenants";
import { runStorageCheck, streamToString } from "./check";
import { LocalDriver } from "./local";
import { assertSafeEndpoint } from "./netguard";
import { S3Driver } from "./s3";
import { LocalUrlSigner } from "./signing";
import type { StorageDriver } from "./types";

type TargetRow = typeof storageTargets.$inferSelect;

/** Whose storage target: the platform's managed bucket, or one tenant's own bucket. */
export type TargetScope = { kind: "platform" } | { kind: "tenant"; tenant: TenantRecord };

export interface ResolvedStorage {
  mode: StorageMode;
  source: StorageModeSource;
  locked: boolean;
  driver: StorageDriver;
  /** Where new objects go. Save this (plus the key) with whatever you store. */
  location: Omit<StorageLocation, "key">;
}

interface Dependencies {
  config: Pick<AppConfig, "signingKey" | "apiUrl" | "storage" | "allowPrivateNetworkTargets">;
  platform: Db;
  tenants: TenantService;
  keys: KeyProvider;
  settings: SettingsService;
  audit: AuditService;
}

const toTargetView = (row: TargetRow): S3TargetView => ({
  id: row.id,
  ...row.config,
  accessKeyIdHint: row.accessKeyIdHint,
  lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
  lastCheckOk: row.lastCheckOk,
  lastCheckDetail: row.lastCheckDetail,
  updatedAt: row.updatedAt.toISOString(),
});

const summarise = (check: StorageCheckResult): string | null =>
  check.ok ? null : (check.steps.find((s) => !s.ok)?.detail ?? "The storage check failed.");

/**
 * Decides where each tenant's backups are stored, and gives the rest of the
 * system a driver to read and write with.
 *
 *   - The platform owner sets the rules: the default mode, which modes tenants
 *     may pick, the managed S3 bucket, and optional per-tenant pins.
 *   - Each tenant's admin picks a mode within those rules, and may connect the
 *     tenant's own bucket.
 *   - Every stored object records its own location, so switching modes only
 *     affects NEW backups; existing ones stay readable where they are.
 *
 * Nothing here is configured through environment variables except the local
 * directory path: buckets and keys are entered in the admin panel and encrypted.
 */
export class StorageService {
  readonly local: LocalDriver;
  readonly signer: LocalUrlSigner;
  private readonly s3Drivers = new Map<string, S3Driver>();

  constructor(private readonly deps: Dependencies) {
    this.signer = new LocalUrlSigner(deps.config.signingKey, deps.config.apiUrl);
    this.local = new LocalDriver(deps.config.storage.localDir, this.signer);
  }

  // ---------------------------------------------------------------------------
  // Resolution: which storage is in effect for a tenant
  // ---------------------------------------------------------------------------

  /** The storage new backups for this tenant should be written to. */
  async resolve(tenant: TenantRecord): Promise<ResolvedStorage> {
    const state = await this.state(tenant);
    const { mode, source } = state.effective;
    const locked = state.forced !== undefined;

    if (mode === "platform_s3" && state.platformTarget) {
      return {
        mode,
        source,
        locked,
        driver: await this.driverForRow({ kind: "platform" }, state.platformTarget),
        location: { scope: "platform", kind: "s3", targetId: state.platformTarget.id },
      };
    }
    if (mode === "own_s3" && state.ownTarget) {
      const scope: TargetScope = { kind: "tenant", tenant };
      return {
        mode,
        source,
        locked,
        driver: await this.driverForRow(scope, state.ownTarget),
        location: { scope: "tenant", kind: "s3", targetId: state.ownTarget.id },
      };
    }
    return {
      mode: "local",
      source,
      locked,
      driver: this.local,
      location: { scope: "platform", kind: "local", targetId: null },
    };
  }

  /**
   * A driver for an object that was stored earlier, wherever that was. Works for
   * retired targets too, which is what keeps old backups usable after a switch.
   */
  async driverFor(tenant: TenantRecord, location: Omit<StorageLocation, "key">): Promise<StorageDriver> {
    if (location.kind === "local") return this.local;
    if (!location.targetId) throw new Error("S3 location without a target");
    const scope: TargetScope =
      location.scope === "platform" ? { kind: "platform" } : { kind: "tenant", tenant };
    const [row] = await (
      await this.db(scope)
    )
      .select()
      .from(storageTargets)
      .where(eq(storageTargets.id, location.targetId))
      .limit(1);
    if (!row) throw notFound("Storage target");
    return this.driverForRow(scope, row);
  }

  // ---------------------------------------------------------------------------
  // Tenant admin: view and choose
  // ---------------------------------------------------------------------------

  async tenantView(tenant: TenantRecord): Promise<TenantStorageView> {
    const state = await this.state(tenant);
    const ttl = await this.deps.settings.resolve(tenant, "storage.download_url_ttl_seconds");
    return {
      effective: { ...state.effective, locked: state.forced !== undefined },
      choice: state.choice ?? null,
      platformDefault: state.platformDefault,
      options: STORAGE_MODES.map((mode) => {
        const allowed = state.allowed.includes(mode);
        const ready = state.ready[mode];
        return {
          mode,
          allowed,
          ready,
          reason: !allowed
            ? "not_allowed"
            : ready
              ? null
              : mode === "platform_s3"
                ? "platform_s3_not_configured"
                : "own_s3_not_configured",
        };
      }),
      ownS3: state.ownTarget ? toTargetView(state.ownTarget) : null,
      downloadUrlTtlSeconds: ttl.value,
    };
  }

  async setTenantMode(tenant: TenantRecord, mode: StorageMode, actor: Actor): Promise<void> {
    const state = await this.state(tenant);
    if (state.forced !== undefined) {
      throw forbidden("storage_locked", "Storage for this workspace is locked by the platform owner");
    }
    if (!state.allowed.includes(mode)) {
      throw forbidden("storage_mode_not_allowed", "This storage option is not available on this platform");
    }
    if (!state.ready[mode]) {
      throw unprocessable(
        "storage_not_ready",
        mode === "own_s3"
          ? "Connect and test your own S3 bucket first"
          : "The platform's S3 storage is not set up yet",
      );
    }
    await this.deps.settings.setTenant(tenant, "storage.mode", mode, actor);
  }

  // ---------------------------------------------------------------------------
  // Platform owner: rules and overview
  // ---------------------------------------------------------------------------

  async platformView(): Promise<PlatformStorageView> {
    const { settings, tenants } = this.deps;
    const [defaultMode, allowedModes, platformTarget, allTenants] = await Promise.all([
      settings.platformValue("storage.mode"),
      settings.platformValue("storage.allowed_modes"),
      this.activeTarget({ kind: "platform" }),
      tenants.list(),
    ]);

    const rows = [];
    for (const tenant of allTenants) {
      if (tenant.status === "deleted" || tenant.status === "provisioning") continue;
      const state = await this.state(tenant);
      rows.push({
        tenant: toTenantView(tenant),
        effectiveMode: state.effective.mode,
        source: state.effective.source,
        forcedMode: state.forced ?? null,
        choice: state.choice ?? null,
      });
    }

    return {
      defaultMode: defaultMode.value,
      allowedModes: allowedModes.value,
      platformS3: platformTarget ? toTargetView(platformTarget) : null,
      localDirectory: this.local.directory,
      tenants: rows,
    };
  }

  /** Sets the default mode for all tenants and which modes they may choose. */
  async setPlatformRules(
    rules: { defaultMode: StorageMode; allowedModes: StorageMode[] },
    actor: Actor,
  ): Promise<void> {
    if (rules.defaultMode === "own_s3") {
      throw badRequest("invalid_default", "The default must be local disk or the platform's S3 bucket");
    }
    if (!rules.allowedModes.includes(rules.defaultMode)) {
      throw badRequest("invalid_default", "The default storage must be one of the allowed options");
    }
    if (rules.defaultMode === "platform_s3") {
      const target = await this.activeTarget({ kind: "platform" });
      if (target?.lastCheckOk !== true) {
        throw unprocessable(
          "storage_not_ready",
          "Set up and test the platform's S3 bucket before making it the default",
        );
      }
    }
    const { settings } = this.deps;
    const current = {
      defaultMode: (await settings.platformValue("storage.mode")).value,
      allowedModes: (await settings.platformValue("storage.allowed_modes")).value,
    };
    if (current.defaultMode !== rules.defaultMode) {
      await settings.setPlatform("storage.mode", rules.defaultMode, actor);
    }
    if ([...current.allowedModes].sort().join() !== [...rules.allowedModes].sort().join()) {
      await settings.setPlatform("storage.allowed_modes", rules.allowedModes, actor);
    }
  }

  /** Pins one tenant to a storage mode (or releases the pin with `null`). */
  async forceTenantMode(tenant: TenantRecord, mode: StorageMode | null, actor: Actor): Promise<void> {
    if (mode !== null) {
      const state = await this.state(tenant);
      if (!state.ready[mode]) {
        throw unprocessable(
          "storage_not_ready",
          mode === "own_s3"
            ? "This workspace has not connected its own bucket"
            : "The platform's S3 storage is not set up yet",
        );
      }
    }
    await this.deps.settings.force(tenant, "storage.mode", mode, actor);
  }

  // ---------------------------------------------------------------------------
  // S3 targets: entered in the admin panel, tested, encrypted, saved
  // ---------------------------------------------------------------------------

  async target(scope: TargetScope): Promise<S3TargetView | null> {
    const row = await this.activeTarget(scope);
    return row ? toTargetView(row) : null;
  }

  /**
   * Saves S3 details typed into the admin panel. The details are tested first
   * (write, read, signed download, delete) and are only saved if every step
   * passes. Keys are encrypted before they touch the database.
   *
   * Changing the bucket retires the previous target instead of deleting it, so
   * backups already stored there remain readable.
   */
  async saveTarget(
    scope: TargetScope,
    input: S3TargetInput,
    actor: Actor,
  ): Promise<{ target: S3TargetView; check: StorageCheckResult }> {
    const { accessKeyId, secretAccessKey, ...config } = input;
    const existing = await this.activeTarget(scope);

    let secrets: S3Secrets;
    if (accessKeyId && secretAccessKey) {
      secrets = { accessKeyId, secretAccessKey };
    } else if (!accessKeyId && !secretAccessKey && existing) {
      secrets = await this.secrets(scope, existing);
    } else {
      throw badRequest("keys_required", "Enter both the access key ID and the secret access key", {
        accessKeyId: accessKeyId ? "" : "Required",
        secretAccessKey: secretAccessKey ? "" : "Required",
      });
    }

    // Tenants must not be able to point the server at its own internal network.
    if (scope.kind === "tenant") {
      await assertSafeEndpoint(config.endpoint, this.deps.config.allowPrivateNetworkTargets);
    }

    const candidate = new S3Driver(config, secrets);
    let check: StorageCheckResult;
    try {
      check = await this.check(candidate);
    } finally {
      candidate.destroy();
    }
    if (!check.ok) {
      throw unprocessable("storage_check_failed", summarise(check) ?? "The storage check failed.", check);
    }

    const sameLocation =
      existing &&
      existing.config.bucket === config.bucket &&
      existing.config.endpoint === config.endpoint &&
      existing.config.prefix === config.prefix;

    const db = await this.db(scope);
    const id = sameLocation ? existing.id : newId();
    const values = {
      config,
      secretsEnc: await this.encryptSecrets(scope, id, secrets),
      accessKeyIdHint: secrets.accessKeyId.slice(-4),
      lastCheckAt: new Date(),
      lastCheckOk: true,
      lastCheckDetail: null,
      updatedAt: new Date(),
    };

    if (sameLocation) {
      await db.update(storageTargets).set(values).where(eq(storageTargets.id, id));
    } else {
      if (existing) {
        await db
          .update(storageTargets)
          .set({ status: "retired", updatedAt: new Date() })
          .where(eq(storageTargets.id, existing.id));
      }
      await db
        .insert(storageTargets)
        .values({ id, kind: "s3", status: "active", createdBy: actor.id, ...values });
    }

    await this.deps.audit.record(db, {
      actor,
      action: "storage.target.saved",
      targetType: "storage_target",
      targetId: id,
      // Never the keys: only where the bucket is.
      metadata: {
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint || "Amazon S3",
        prefix: config.prefix,
        replacedTarget: existing && !sameLocation ? existing.id : null,
        keysChanged: Boolean(accessKeyId),
      },
    });

    const [saved] = await db.select().from(storageTargets).where(eq(storageTargets.id, id)).limit(1);
    return { target: toTargetView(saved!), check };
  }

  /** Re-runs the self-test on the saved target and records the outcome. */
  async recheckTarget(scope: TargetScope, actor: Actor): Promise<StorageCheckResult> {
    const row = await this.activeTarget(scope);
    if (!row) throw notFound("S3 storage");
    const check = await this.check(await this.driverForRow(scope, row));
    const db = await this.db(scope);
    await db
      .update(storageTargets)
      .set({ lastCheckAt: new Date(), lastCheckOk: check.ok, lastCheckDetail: summarise(check) })
      .where(eq(storageTargets.id, row.id));
    await this.deps.audit.record(db, {
      actor,
      action: "storage.target.checked",
      targetType: "storage_target",
      targetId: row.id,
      metadata: { ok: check.ok, failedStep: check.steps.find((s) => !s.ok)?.step ?? null },
    });
    return check;
  }

  checkLocal(): Promise<StorageCheckResult> {
    return this.check(this.local);
  }

  /** Runs the write / read / signed download / delete self-test against a driver. */
  check(driver: StorageDriver): Promise<StorageCheckResult> {
    return runStorageCheck(driver, async (url) => {
      if (driver.kind === "local") {
        // Verify the signed link in-process, exactly as the download route would.
        const claims = this.signer.verify(this.signer.tokenFromUrl(url));
        if (!claims) throw new Error("The signed link was rejected.");
        return streamToString((await this.local.read(claims.key)).stream);
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`The signed link returned HTTP ${res.status}.`);
      return res.text();
    });
  }

  close(): void {
    for (const driver of this.s3Drivers.values()) driver.destroy();
    this.s3Drivers.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private db(scope: TargetScope): Promise<Db> {
    return scope.kind === "platform"
      ? Promise.resolve(this.deps.platform)
      : this.deps.tenants.db(scope.tenant);
  }

  private async activeTarget(scope: TargetScope): Promise<TargetRow | null> {
    const [row] = await (
      await this.db(scope)
    )
      .select()
      .from(storageTargets)
      .where(and(eq(storageTargets.kind, "s3"), eq(storageTargets.status, "active")))
      .orderBy(desc(storageTargets.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** Everything that decides a tenant's storage, gathered once. */
  private async state(tenant: TenantRecord) {
    const { settings } = this.deps;
    const [platformTarget, ownTarget, allowedSetting, defaultSetting, forced, choice] = await Promise.all([
      this.activeTarget({ kind: "platform" }),
      this.activeTarget({ kind: "tenant", tenant }),
      settings.platformValue("storage.allowed_modes"),
      settings.platformValue("storage.mode"),
      settings.forcedValue(tenant.id, "storage.mode"),
      settings.tenantValue(tenant, "storage.mode"),
    ]);

    const ready: Record<StorageMode, boolean> = {
      local: true,
      platform_s3: platformTarget?.lastCheckOk === true,
      own_s3: ownTarget?.lastCheckOk === true,
    };
    const allowed = allowedSetting.value;
    const platformDefault = defaultSetting.value;

    let effective: { mode: StorageMode; source: StorageModeSource };
    if (forced !== undefined) {
      effective = ready[forced] ? { mode: forced, source: "forced" } : { mode: "local", source: "fallback" };
    } else if (choice !== undefined && allowed.includes(choice) && ready[choice]) {
      effective = { mode: choice, source: "tenant" };
    } else if (ready[platformDefault]) {
      effective = { mode: platformDefault, source: "platform_default" };
    } else {
      effective = { mode: "local", source: "fallback" };
    }

    return { platformTarget, ownTarget, ready, allowed, platformDefault, forced, choice, effective };
  }

  private secretsContext(scope: TargetScope, id: string): string {
    return scope.kind === "platform" ? `platform-storage-target:${id}` : `storage-target:${id}`;
  }

  /** Platform secrets are wrapped by the key provider; tenant secrets by that tenant's own data key. */
  private async encryptSecrets(scope: TargetScope, id: string, secrets: S3Secrets): Promise<string> {
    const context = this.secretsContext(scope, id);
    if (scope.kind === "platform") {
      return this.deps.keys.wrap(Buffer.from(JSON.stringify(secrets), "utf8"), context);
    }
    return sealJson(await this.deps.tenants.dataKey(scope.tenant), secrets, context);
  }

  private async secrets(scope: TargetScope, row: TargetRow): Promise<S3Secrets> {
    const context = this.secretsContext(scope, row.id);
    if (scope.kind === "platform") {
      return JSON.parse((await this.deps.keys.unwrap(row.secretsEnc, context)).toString("utf8")) as S3Secrets;
    }
    return openJson<S3Secrets>(await this.deps.tenants.dataKey(scope.tenant), row.secretsEnc, context);
  }

  /** One client per target version; replaced when the target is edited. Secrets are only decrypted on a miss. */
  private async driverForRow(scope: TargetScope, row: TargetRow): Promise<S3Driver> {
    const owner = scope.kind === "platform" ? "platform" : scope.tenant.id;
    const prefix = `${owner}:${row.id}:`;
    const cacheKey = `${prefix}${row.updatedAt.getTime()}`;
    const cached = this.s3Drivers.get(cacheKey);
    if (cached) return cached;
    const secrets = await this.secrets(scope, row);
    for (const [key, driver] of this.s3Drivers) {
      if (key.startsWith(prefix)) {
        driver.destroy();
        this.s3Drivers.delete(key);
      }
    }
    const driver = new S3Driver(row.config as S3PublicConfig, secrets);
    this.s3Drivers.set(cacheKey, driver);
    return driver;
  }
}
