import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { createTestCore, testActor, type TestCore } from "../testing/harness";
import type { TenantRecord } from "../tenancy/tenants";

let t: TestCore;
let tenant: TenantRecord;
let other: TenantRecord;
const actor = testActor("admin@acme.com");
const owner = { ...testActor("owner@platform.com"), type: "platform" as const };

beforeAll(async () => {
  t = await createTestCore();
  tenant = await t.core.tenants.provision({ name: "Acme" });
  other = await t.core.tenants.provision({ name: "Other" });
});

afterAll(async () => {
  await t.cleanup();
});

const code = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "no error";
  } catch (err) {
    return err instanceof AppError ? err.code : `unexpected: ${(err as Error).message}`;
  }
};

describe("layered configuration", () => {
  const key = "storage.download_url_ttl_seconds";

  it("starts at the built-in default", async () => {
    expect(await t.core.settings.resolve(tenant, key)).toEqual({
      key,
      value: 300,
      source: "default",
      locked: false,
    });
  });

  it("platform value applies to every tenant", async () => {
    await t.core.settings.setPlatform(key, 600, owner);
    expect(await t.core.settings.resolve(tenant, key)).toMatchObject({ value: 600, source: "platform" });
    expect(await t.core.settings.resolve(other, key)).toMatchObject({ value: 600, source: "platform" });
  });

  it("a tenant's own choice wins over the platform value, for that tenant only", async () => {
    await t.core.settings.setTenant(tenant, key, 900, actor);
    expect(await t.core.settings.resolve(tenant, key)).toMatchObject({
      value: 900,
      source: "tenant",
      locked: false,
    });
    expect(await t.core.settings.resolve(other, key)).toMatchObject({ value: 600, source: "platform" });
  });

  it("a platform pin wins over the tenant's choice and locks it", async () => {
    await t.core.settings.force(tenant, key, 120, owner);
    expect(await t.core.settings.resolve(tenant, key)).toEqual({
      key,
      value: 120,
      source: "forced",
      locked: true,
    });
    expect(await code(t.core.settings.setTenant(tenant, key, 1000, actor))).toBe("setting_locked");
    expect((await t.core.settings.forcedValues(key)).get(tenant.id)).toBe(120);
  });

  it("releasing the pin restores the tenant's choice; clearing the choice restores the platform value", async () => {
    await t.core.settings.force(tenant, key, null, owner);
    expect(await t.core.settings.resolve(tenant, key)).toMatchObject({ value: 900, source: "tenant" });
    await t.core.settings.clearTenant(tenant, key, actor);
    expect(await t.core.settings.resolve(tenant, key)).toMatchObject({ value: 600, source: "platform" });
  });

  it("validates values and refuses platform-only settings from tenants", async () => {
    expect(await code(t.core.settings.setTenant(tenant, key, 5, actor))).toBe("invalid_setting");
    expect(await code(t.core.settings.setPlatform("storage.mode", "tape", owner))).toBe("invalid_setting");
    expect(await code(t.core.settings.setTenant(tenant, "storage.allowed_modes", ["local"], actor))).toBe(
      "setting_not_editable",
    );
    expect(await code(t.core.settings.setTenant(tenant, "signup.enabled", false, actor))).toBe(
      "setting_not_editable",
    );
  });

  it("writes every change to the right audit trail", async () => {
    const tenantLog = await t.core.audit.list(await t.core.tenants.db(tenant));
    expect(tenantLog.entries.map((e) => e.action)).toEqual([
      "settings.reset",
      "settings.unlocked_by_platform",
      "settings.locked_by_platform",
      "settings.updated",
    ]);
    const locked = tenantLog.entries.find((e) => e.action === "settings.locked_by_platform")!;
    expect(locked).toMatchObject({
      actorType: "platform",
      actorLabel: "owner@platform.com",
      metadata: { key, to: 120 },
    });

    const platformLog = await t.core.audit.list(t.core.platform.db);
    expect(platformLog.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "settings.platform.updated",
        "settings.tenant_override.set",
        "settings.tenant_override.removed",
      ]),
    );
    // The other tenant's log knows nothing about any of this.
    expect((await t.core.audit.list(await t.core.tenants.db(other))).entries).toEqual([]);

    expect(await t.core.audit.verify(await t.core.tenants.db(tenant))).toMatchObject({ ok: true });
    expect(await t.core.audit.verify(t.core.platform.db)).toMatchObject({ ok: true });
  });
});
