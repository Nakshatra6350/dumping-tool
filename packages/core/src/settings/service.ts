import {
  SETTING_DEFINITIONS,
  SettingValidationError,
  defaultSettingValue,
  parseSettingValue,
  type ResolvedSetting,
  type SettingKey,
  type SettingValues,
} from "@dbrb/shared";
import { and, eq } from "drizzle-orm";
import type { Actor, AuditService } from "../audit/service";
import { settings } from "../db/common";
import type { Db } from "../db/mysql";
import { tenantOverrides } from "../db/platform/schema";
import { badRequest, forbidden } from "../errors";
import type { TenantRecord, TenantService } from "../tenancy/tenants";

/**
 * The global configuration service. Resolves every setting in layers, most
 * specific first:
 *
 *   forced    (platform DB, tenant_overrides)  the platform owner pinned it for this tenant
 *   tenant    (tenant DB, settings)            the tenant's admin chose it
 *   platform  (platform DB, settings)          the platform-wide value
 *   default   (code)                           the built-in default
 *
 * Every change is validated against the registry and written to the audit trail.
 */
export class SettingsService {
  private cache: { loadedAt: number; values: Map<string, unknown> } | null = null;

  constructor(
    private readonly platform: Db,
    private readonly tenants: TenantService,
    private readonly audit: AuditService,
    private readonly cacheMs = 3_000,
  ) {}

  // -- Platform-wide values ---------------------------------------------------

  /** The platform-wide value: what the platform owner set, or the built-in default. */
  async platformValue<K extends SettingKey>(key: K): Promise<{ value: SettingValues[K]; isSet: boolean }> {
    const stored = this.parseStored(key, (await this.platformValues()).get(key));
    return stored === undefined
      ? { value: defaultSettingValue(key), isSet: false }
      : { value: stored, isSet: true };
  }

  async setPlatform<K extends SettingKey>(key: K, raw: unknown, actor: Actor): Promise<SettingValues[K]> {
    const value = this.validate(key, raw);
    const previous = (await this.platformValue(key)).value;
    await this.upsert(this.platform, key, value, actor);
    this.cache = null;
    await this.audit.record(this.platform, {
      actor,
      action: "settings.platform.updated",
      targetType: "setting",
      targetId: key,
      metadata: { from: previous, to: value },
    });
    return value;
  }

  // -- One tenant's view ------------------------------------------------------

  /** The value in effect for a tenant, and which layer it came from. */
  async resolve<K extends SettingKey>(tenant: TenantRecord, key: K): Promise<ResolvedSetting<K>> {
    const forced = await this.forcedValue(tenant.id, key);
    if (forced !== undefined) return { key, value: forced, source: "forced", locked: true };

    if (SETTING_DEFINITIONS[key].tenantEditable) {
      const own = await this.tenantValue(tenant, key);
      if (own !== undefined) return { key, value: own, source: "tenant", locked: false };
    }

    const platform = await this.platformValue(key);
    return { key, value: platform.value, source: platform.isSet ? "platform" : "default", locked: false };
  }

  /** What the tenant's own admin chose, if anything. */
  async tenantValue<K extends SettingKey>(
    tenant: TenantRecord,
    key: K,
  ): Promise<SettingValues[K] | undefined> {
    const db = await this.tenants.db(tenant);
    const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return this.parseStored(key, row?.value);
  }

  async setTenant<K extends SettingKey>(
    tenant: TenantRecord,
    key: K,
    raw: unknown,
    actor: Actor,
  ): Promise<SettingValues[K]> {
    if (!SETTING_DEFINITIONS[key].tenantEditable) {
      throw forbidden("setting_not_editable", "This setting is managed by the platform");
    }
    if ((await this.forcedValue(tenant.id, key)) !== undefined) {
      throw forbidden("setting_locked", "This setting has been locked by the platform owner");
    }
    const value = this.validate(key, raw);
    const previous = (await this.resolve(tenant, key)).value;
    const db = await this.tenants.db(tenant);
    await this.upsert(db, key, value, actor);
    await this.audit.record(db, {
      actor,
      action: "settings.updated",
      targetType: "setting",
      targetId: key,
      metadata: { from: previous, to: value },
    });
    return value;
  }

  /** Removes the tenant's own choice, so the platform value applies again. */
  async clearTenant(tenant: TenantRecord, key: SettingKey, actor: Actor): Promise<void> {
    const previous = await this.tenantValue(tenant, key);
    if (previous === undefined) return;
    const db = await this.tenants.db(tenant);
    await db.delete(settings).where(eq(settings.key, key));
    await this.audit.record(db, {
      actor,
      action: "settings.reset",
      targetType: "setting",
      targetId: key,
      metadata: { from: previous },
    });
  }

  // -- Platform overrides for a single tenant ---------------------------------

  async forcedValue<K extends SettingKey>(tenantId: string, key: K): Promise<SettingValues[K] | undefined> {
    const [row] = await this.platform
      .select()
      .from(tenantOverrides)
      .where(and(eq(tenantOverrides.tenantId, tenantId), eq(tenantOverrides.key, key)))
      .limit(1);
    return this.parseStored(key, row?.value);
  }

  /** Every tenant that has this setting pinned by the platform owner. */
  async forcedValues<K extends SettingKey>(key: K): Promise<Map<string, SettingValues[K]>> {
    const rows = await this.platform.select().from(tenantOverrides).where(eq(tenantOverrides.key, key));
    const result = new Map<string, SettingValues[K]>();
    for (const row of rows) {
      const value = this.parseStored(key, row.value);
      if (value !== undefined) result.set(row.tenantId, value);
    }
    return result;
  }

  /**
   * Pins a value for one tenant (or releases the pin with `null`). Recorded in
   * the platform audit log and in the tenant's own log, so the tenant can see
   * that the platform changed their configuration.
   */
  async force<K extends SettingKey>(
    tenant: TenantRecord,
    key: K,
    raw: unknown | null,
    actor: Actor,
  ): Promise<void> {
    const previous = await this.forcedValue(tenant.id, key);
    const value = raw === null ? null : this.validate(key, raw);

    if (value === null) {
      await this.platform
        .delete(tenantOverrides)
        .where(and(eq(tenantOverrides.tenantId, tenant.id), eq(tenantOverrides.key, key)));
    } else {
      await this.platform
        .insert(tenantOverrides)
        .values({ tenantId: tenant.id, key, value, updatedBy: actor.id, updatedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { value, updatedBy: actor.id, updatedAt: new Date() } });
    }

    const metadata = { key, from: previous ?? null, to: value };
    await this.audit.record(this.platform, {
      actor,
      action: value === null ? "settings.tenant_override.removed" : "settings.tenant_override.set",
      targetType: "tenant",
      targetId: tenant.id,
      tenantId: tenant.id,
      metadata,
    });
    await this.audit.record(await this.tenants.db(tenant), {
      actor: { ...actor, type: "platform" },
      action: value === null ? "settings.unlocked_by_platform" : "settings.locked_by_platform",
      targetType: "setting",
      targetId: key,
      metadata,
    });
  }

  // -- Internals --------------------------------------------------------------

  private validate<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] {
    try {
      return parseSettingValue(key, raw);
    } catch (err) {
      if (err instanceof SettingValidationError) throw badRequest("invalid_setting", err.message);
      throw err;
    }
  }

  /** Stored values are re-validated on read, so a value that is no longer valid is treated as unset. */
  private parseStored<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] | undefined {
    if (raw === undefined || raw === null) return undefined;
    try {
      return parseSettingValue(key, raw);
    } catch {
      return undefined;
    }
  }

  private async platformValues(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.cacheMs) return this.cache.values;
    const rows = await this.platform.select().from(settings);
    const values = new Map(rows.map((row) => [row.key, row.value]));
    this.cache = { loadedAt: Date.now(), values };
    return values;
  }

  private async upsert(db: Db, key: string, value: unknown, actor: Actor): Promise<void> {
    await db
      .insert(settings)
      .values({ key, value, updatedBy: actor.id, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value, updatedBy: actor.id, updatedAt: new Date() } });
  }
}
