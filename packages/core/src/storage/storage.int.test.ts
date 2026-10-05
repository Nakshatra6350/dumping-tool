import type { StorageLocation } from "@dbrb/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storageTargets } from "../db/common";
import { AppError } from "../errors";
import { DEV_S3 } from "../testing/devS3";
import { createTestCore, devS3Input, testActor, type TestCore } from "../testing/harness";
import type { TenantRecord } from "../tenancy/tenants";
import { streamToString } from "./check";

let t: TestCore;
let acme: TenantRecord;
let globex: TenantRecord;
const admin = testActor("admin@acme.com");
const owner = { ...testActor("owner@platform.com"), type: "platform" as const };

beforeAll(async () => {
  t = await createTestCore();
  acme = await t.core.tenants.provision({ name: "Acme" });
  globex = await t.core.tenants.provision({ name: "Globex" });
});

afterAll(async () => {
  await t.cleanup();
});

const failure = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected the call to fail");
};

const keyFor = (tenant: TenantRecord, name: string) => `tenants/${tenant.id}/${name}`;

describe("local disk", () => {
  it("passes the self-test and is the default for a new tenant", async () => {
    expect((await t.core.storage.checkLocal()).ok).toBe(true);
    const resolved = await t.core.storage.resolve(acme);
    expect(resolved).toMatchObject({
      mode: "local",
      source: "platform_default",
      locked: false,
      location: { scope: "platform", kind: "local", targetId: null },
    });
    expect(resolved.driver.kind).toBe("local");
  });
});

describe("a tenant's own S3 bucket", () => {
  it("cannot be selected before it is connected", async () => {
    const view = await t.core.storage.tenantView(acme);
    expect(view.options.find((o) => o.mode === "own_s3")).toEqual({
      mode: "own_s3",
      allowed: true,
      ready: false,
      reason: "own_s3_not_configured",
    });
    expect((await failure(t.core.storage.setTenantMode(acme, "own_s3", admin))).code).toBe(
      "storage_not_ready",
    );
    expect(
      (
        await failure(
          t.core.storage.saveTarget(
            { kind: "tenant", tenant: acme },
            { ...devS3Input(DEV_S3.tenantBucket), accessKeyId: undefined, secretAccessKey: undefined },
            admin,
          ),
        )
      ).code,
    ).toBe("keys_required");
  });

  it("is tested before saving, and wrong details save nothing", async () => {
    const scope = { kind: "tenant" as const, tenant: acme };
    const wrongSecret = await failure(
      t.core.storage.saveTarget(
        scope,
        devS3Input(DEV_S3.tenantBucket, { secretAccessKey: "not-the-secret" }),
        admin,
      ),
    );
    expect(wrongSecret.code).toBe("storage_check_failed");
    expect(wrongSecret.status).toBe(422);
    expect((wrongSecret.details as { steps: Array<{ step: string; ok: boolean }> }).steps[0]).toMatchObject({
      step: "write",
      ok: false,
    });

    const noBucket = await failure(
      t.core.storage.saveTarget(scope, devS3Input("dbrb-bucket-that-does-not-exist"), admin),
    );
    expect(noBucket.code).toBe("storage_check_failed");

    expect(await t.core.storage.target(scope)).toBeNull();
  });

  it("saves working details with the keys encrypted, then can be selected", async () => {
    const scope = { kind: "tenant" as const, tenant: acme };
    const { target, check } = await t.core.storage.saveTarget(
      scope,
      devS3Input(DEV_S3.tenantBucket, { prefix: "acme" }),
      admin,
    );

    expect(check.ok).toBe(true);
    expect(check.steps.map((s) => s.step)).toEqual(["write", "read", "signed_url", "delete"]);
    expect(target).toMatchObject({
      bucket: DEV_S3.tenantBucket,
      prefix: "acme",
      lastCheckOk: true,
      accessKeyIdHint: DEV_S3.accessKeyId.slice(-4),
    });
    // The API view never carries the keys.
    expect(JSON.stringify(target)).not.toContain(DEV_S3.secretAccessKey);
    expect(JSON.stringify(target)).not.toContain(DEV_S3.accessKeyId);

    // And the database only holds ciphertext.
    const [row] = await (
      await t.core.tenants.db(acme)
    )
      .select()
      .from(storageTargets)
      .where(eq(storageTargets.id, target.id));
    expect(row!.secretsEnc.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(DEV_S3.secretAccessKey);

    await t.core.storage.setTenantMode(acme, "own_s3", admin);
    const resolved = await t.core.storage.resolve(acme);
    expect(resolved).toMatchObject({
      mode: "own_s3",
      source: "tenant",
      location: { scope: "tenant", kind: "s3", targetId: target.id },
    });
    expect(resolved.driver.kind).toBe("s3");
  });

  it("serves downloads through a presigned link that needs no credentials", async () => {
    const { driver } = await t.core.storage.resolve(acme);
    const key = keyFor(acme, "presigned.sql.gz");
    await driver.put(key, Buffer.from("-- dump contents --"));
    const url = await driver.signedDownloadUrl(key, {
      expiresInSeconds: 120,
      fileName: "shop backup.sql.gz",
    });

    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("-- dump contents --");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="shop_backup.sql.gz"');

    // Without the signature the bucket is private.
    expect((await fetch(url.split("?")[0]!)).status).toBe(403);
    await driver.delete(key);
  });
});

describe("switching storage", () => {
  it("only affects new backups: earlier ones stay readable where they are", async () => {
    // Stored while the tenant was on its own bucket.
    const onS3 = await t.core.storage.resolve(acme);
    const s3Key = keyFor(acme, "stored-on-s3.sql.gz");
    await onS3.driver.put(s3Key, Buffer.from("lives in s3"));
    const s3Location = { ...onS3.location, key: s3Key };

    // Switch to local disk.
    await t.core.storage.setTenantMode(acme, "local", admin);
    const onLocal = await t.core.storage.resolve(acme);
    expect(onLocal.mode).toBe("local");
    const localKey = keyFor(acme, "stored-locally.sql.gz");
    await onLocal.driver.put(localKey, Buffer.from("lives on disk"));
    const localLocation = { ...onLocal.location, key: localKey };

    // The S3 object is still reachable through its recorded location.
    const s3Again = await t.core.storage.driverFor(acme, s3Location);
    expect(await streamToString((await s3Again.read(s3Key)).stream)).toBe("lives in s3");

    // Switch back: the local object is still reachable too.
    await t.core.storage.setTenantMode(acme, "own_s3", admin);
    const localAgain = await t.core.storage.driverFor(acme, localLocation);
    expect(await streamToString((await localAgain.read(localKey)).stream)).toBe("lives on disk");

    await s3Again.delete(s3Key);
    await localAgain.delete(localKey);
  });

  it("changing the bucket retires the old target but keeps its objects readable", async () => {
    const scope = { kind: "tenant" as const, tenant: acme };
    const before = await t.core.storage.resolve(acme);
    const key = keyFor(acme, "in-old-bucket.sql.gz");
    await before.driver.put(key, Buffer.from("old bucket"));

    // Rotating keys only (same bucket) keeps the same target...
    const rotated = await t.core.storage.saveTarget(
      scope,
      devS3Input(DEV_S3.tenantBucket, { prefix: "acme", accessKeyId: undefined, secretAccessKey: undefined }),
      admin,
    );
    expect(rotated.target.id).toBe(before.location.targetId);

    // ...but pointing at a different location creates a new one and retires the old.
    const moved = await t.core.storage.saveTarget(
      scope,
      devS3Input(DEV_S3.tenantBucket, { prefix: "acme-v2" }),
      admin,
    );
    expect(moved.target.id).not.toBe(before.location.targetId);
    const rows = await (await t.core.tenants.db(acme)).select().from(storageTargets);
    expect(rows.find((r) => r.id === before.location.targetId)!.status).toBe("retired");
    expect(rows.find((r) => r.id === moved.target.id)!.status).toBe("active");

    const after = await t.core.storage.resolve(acme);
    expect(after.location.targetId).toBe(moved.target.id);

    // What a backup stored earlier would have on record: where it is, and its key.
    const stored: StorageLocation = { ...before.location, key };
    const old = await t.core.storage.driverFor(acme, stored);
    expect(await streamToString((await old.read(key)).stream)).toBe("old bucket");
    await old.delete(key);
  });

  it("one tenant can never reach another tenant's bucket", async () => {
    const acmeLocation = (await t.core.storage.resolve(acme)).location;
    expect((await failure(t.core.storage.driverFor(globex, acmeLocation))).code).toBe("not_found");
    expect((await t.core.storage.tenantView(globex)).ownS3).toBeNull();
  });
});

describe("platform rules", () => {
  it("refuses an S3 default until the platform bucket is set up", async () => {
    const error = await failure(
      t.core.storage.setPlatformRules(
        { defaultMode: "platform_s3", allowedModes: ["local", "platform_s3", "own_s3"] },
        owner,
      ),
    );
    expect(error.code).toBe("storage_not_ready");
    expect(
      (
        await failure(
          t.core.storage.setPlatformRules({ defaultMode: "own_s3", allowedModes: ["own_s3"] }, owner),
        )
      ).code,
    ).toBe("invalid_default");
    expect(
      (
        await failure(
          t.core.storage.setPlatformRules({ defaultMode: "local", allowedModes: ["own_s3"] }, owner),
        )
      ).code,
    ).toBe("invalid_default");
  });

  it("the platform bucket becomes the default for tenants that have not chosen", async () => {
    const { check } = await t.core.storage.saveTarget(
      { kind: "platform" },
      devS3Input(DEV_S3.platformBucket),
      owner,
    );
    expect(check.ok).toBe(true);
    await t.core.storage.setPlatformRules(
      { defaultMode: "platform_s3", allowedModes: ["local", "platform_s3", "own_s3"] },
      owner,
    );

    const resolved = await t.core.storage.resolve(globex);
    expect(resolved).toMatchObject({
      mode: "platform_s3",
      source: "platform_default",
      location: { scope: "platform", kind: "s3" },
    });
    // Acme chose its own bucket, so the new default does not move it.
    expect((await t.core.storage.resolve(acme)).mode).toBe("own_s3");

    const view = await t.core.storage.platformView();
    expect(view).toMatchObject({ defaultMode: "platform_s3", platformS3: { bucket: DEV_S3.platformBucket } });
    expect(view.tenants.find((r) => r.tenant.id === globex.id)).toMatchObject({
      effectiveMode: "platform_s3",
      source: "platform_default",
      choice: null,
    });
    expect(view.tenants.find((r) => r.tenant.id === acme.id)).toMatchObject({
      effectiveMode: "own_s3",
      source: "tenant",
      choice: "own_s3",
    });
  });

  it("narrowing the allowed options moves tenants off an option that is no longer allowed", async () => {
    await t.core.storage.setPlatformRules(
      { defaultMode: "platform_s3", allowedModes: ["local", "platform_s3"] },
      owner,
    );
    expect((await t.core.storage.resolve(acme)).mode).toBe("platform_s3");
    expect((await failure(t.core.storage.setTenantMode(acme, "own_s3", admin))).code).toBe(
      "storage_mode_not_allowed",
    );
    expect((await t.core.storage.tenantView(acme)).options.find((o) => o.mode === "own_s3")).toMatchObject({
      allowed: false,
      reason: "not_allowed",
    });
    await t.core.storage.setPlatformRules(
      { defaultMode: "platform_s3", allowedModes: ["local", "platform_s3", "own_s3"] },
      owner,
    );
    expect((await t.core.storage.resolve(acme)).mode).toBe("own_s3");
  });

  it("the platform owner can pin one tenant, which locks that tenant's choice", async () => {
    await t.core.storage.forceTenantMode(acme, "local", owner);
    expect(await t.core.storage.resolve(acme)).toMatchObject({
      mode: "local",
      source: "forced",
      locked: true,
    });
    expect((await failure(t.core.storage.setTenantMode(acme, "own_s3", admin))).code).toBe("storage_locked");
    expect((await t.core.storage.tenantView(acme)).effective).toEqual({
      mode: "local",
      source: "forced",
      locked: true,
    });
    // Globex is unaffected.
    expect((await t.core.storage.resolve(globex)).mode).toBe("platform_s3");

    await t.core.storage.forceTenantMode(acme, null, owner);
    expect(await t.core.storage.resolve(acme)).toMatchObject({
      mode: "own_s3",
      source: "tenant",
      locked: false,
    });
    expect((await failure(t.core.storage.forceTenantMode(globex, "own_s3", owner))).code).toBe(
      "storage_not_ready",
    );
  });

  it("recorded every storage change without ever logging a key", async () => {
    const tenantLog = await t.core.audit.list(await t.core.tenants.db(acme), { limit: 200 });
    const actions = tenantLog.entries.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "storage.target.saved",
        "settings.updated",
        "settings.locked_by_platform",
        "settings.unlocked_by_platform",
      ]),
    );
    const platformLog = await t.core.audit.list(t.core.platform.db, { limit: 200 });
    expect(platformLog.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "storage.target.saved",
        "settings.platform.updated",
        "settings.tenant_override.set",
      ]),
    );

    const everything = JSON.stringify([tenantLog, platformLog]);
    expect(everything).not.toContain(DEV_S3.secretAccessKey);
    expect(everything).not.toContain(DEV_S3.accessKeyId);
    expect(await t.core.audit.verify(await t.core.tenants.db(acme))).toMatchObject({ ok: true });
  });
});

describe("hosted deployments", () => {
  it("do not let a tenant point the server at an internal address", async () => {
    const hosted = await createTestCore({ allowPrivateNetworkTargets: false });
    try {
      const tenant = await hosted.core.tenants.provision({ name: "Sneaky" });
      const error = await failure(
        hosted.core.storage.saveTarget(
          { kind: "tenant", tenant },
          devS3Input(DEV_S3.tenantBucket, { endpoint: "https://169.254.169.254" }),
          admin,
        ),
      );
      expect(error.code).toBe("private_address_not_allowed");
      const plainHttp = await failure(
        hosted.core.storage.saveTarget({ kind: "tenant", tenant }, devS3Input(DEV_S3.tenantBucket), admin),
      );
      expect(plainHttp.code).toBe("invalid_endpoint");
    } finally {
      await hosted.cleanup();
    }
  });
});
