import { SYSTEM_ACTOR, randomToken } from "@dbrb/core";
import { DEV_S3, createTestCore, devS3Input, type TestCore } from "@dbrb/core/testing";
import type { PlatformStorageView, SessionView, TenantStorageView } from "@dbrb/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

let t: TestCore;
let app: Express;

// Three people: the platform owner (first to sign up), another workspace's owner, and a viewer.
let owner: ReturnType<typeof request.agent>;
let ravi: ReturnType<typeof request.agent>;
let viewer: ReturnType<typeof request.agent>;
let ownerSession: SessionView;
let raviSession: SessionView;

const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct-horse-battery";

const signup = async (agent: ReturnType<typeof request.agent>, email: string, workspaceName: string) =>
  agent
    .post("/api/v1/auth/signup")
    .set("Origin", ORIGIN)
    .send({ name: email.split("@")[0], email, password: PASSWORD, workspaceName });

beforeAll(async () => {
  t = await createTestCore();
  app = createApp(t.core, { rateLimits: false });
  owner = request.agent(app);
  ravi = request.agent(app);
  viewer = request.agent(app);
});

afterAll(async () => {
  await t.cleanup();
});

describe("health", () => {
  it("answers liveness and readiness checks without a session", async () => {
    expect((await request(app).get("/healthz")).body).toEqual({ ok: true });
    expect((await request(app).get("/readyz")).status).toBe(200);
  });

  it("sends security headers and a request id", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("authentication", () => {
  it("rejects every workspace and platform route without a session", async () => {
    for (const path of [
      "/api/v1/storage",
      "/api/v1/settings",
      "/api/v1/audit",
      "/api/v1/auth/me",
      "/api/v1/platform/storage",
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
    }
  });

  it("explains validation problems field by field", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ name: "", email: "nope", password: "short", workspaceName: "A" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["email", "name", "password", "workspaceName"]);
  });

  it("signs up, sets an HttpOnly session cookie, and returns the session", async () => {
    const res = await signup(owner, "owner@acme.com", "Acme");
    expect(res.status).toBe(201);
    ownerSession = res.body;
    expect(ownerSession).toMatchObject({
      role: "owner",
      user: { email: "owner@acme.com", isPlatformAdmin: true },
      tenant: { name: "Acme", status: "active" },
    });
    expect(ownerSession.permissions).toContain("storage.manage");
    expect(JSON.stringify(res.body)).not.toMatch(/password|dbPassword|dataKey/i);

    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/dbrb_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    expect((await owner.get("/api/v1/auth/me")).body.user.email).toBe("owner@acme.com");
  });

  it("refuses state-changing requests that come from another website (CSRF)", async () => {
    const evil = await owner
      .put("/api/v1/storage/mode")
      .set("Origin", "https://evil.example")
      .send({ mode: "local" });
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe("bad_origin");
    const genuine = await owner.put("/api/v1/storage/mode").set("Origin", ORIGIN).send({ mode: "local" });
    expect(genuine.status).toBe(200);
  });

  it("logs in with the right password only", async () => {
    raviSession = (await signup(ravi, "ravi@globex.com", "Globex")).body;
    expect(raviSession.user.isPlatformAdmin).toBe(false);

    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ravi@globex.com", password: "wrong-wrong-wrong" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers["set-cookie"]).toBeUndefined();

    const fresh = request.agent(app);
    expect(
      (await fresh.post("/api/v1/auth/login").send({ email: "ravi@globex.com", password: PASSWORD })).status,
    ).toBe(200);
    expect((await fresh.get("/api/v1/auth/me")).body.tenant.name).toBe("Globex");
    expect((await fresh.post("/api/v1/auth/logout").send({})).status).toBe(200);
    expect((await fresh.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("updates the profile language and timezone", async () => {
    const res = await ravi
      .put("/api/v1/auth/profile")
      .set("Origin", ORIGIN)
      .send({ name: "Ravi Kumar", locale: "hi", timezone: "Asia/Kolkata" });
    expect(res.body.user).toMatchObject({ name: "Ravi Kumar", locale: "hi", timezone: "Asia/Kolkata" });
    expect(
      (await ravi.put("/api/v1/auth/profile").send({ name: "R", locale: "xx", timezone: "Nowhere/Land" }))
        .status,
    ).toBe(400);
  });
});

describe("workspace storage", () => {
  it("starts on local disk, with the workspace's own bucket not yet connected", async () => {
    const view: TenantStorageView = (await owner.get("/api/v1/storage")).body;
    expect(view.effective).toEqual({ mode: "local", source: "tenant", locked: false });
    expect(view.options.find((o) => o.mode === "own_s3")).toMatchObject({
      ready: false,
      reason: "own_s3_not_configured",
    });
    expect(view.ownS3).toBeNull();
  });

  it("refuses bucket details that do not work, and says which step failed", async () => {
    const res = await owner
      .put("/api/v1/storage/own-s3")
      .send(devS3Input(DEV_S3.tenantBucket, { secretAccessKey: "not-the-real-secret" }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("storage_check_failed");
    expect(res.body.error.details.steps[0]).toMatchObject({ step: "write", ok: false });
    expect((await owner.get("/api/v1/storage")).body.ownS3).toBeNull();
  });

  it("saves working bucket details and never returns the keys", async () => {
    const res = await owner
      .put("/api/v1/storage/own-s3")
      .send(devS3Input(DEV_S3.tenantBucket, { prefix: `api-test-${randomToken(4)}` }));
    expect(res.status).toBe(200);
    expect(res.body.check.ok).toBe(true);
    expect(res.body.target).toMatchObject({ bucket: DEV_S3.tenantBucket, lastCheckOk: true });
    expect(JSON.stringify(res.body)).not.toContain(DEV_S3.secretAccessKey);
    expect(res.body.storage.options.find((o: { mode: string }) => o.mode === "own_s3").ready).toBe(true);
  });

  it("switches the workspace to its own bucket, and re-tests it on demand", async () => {
    const res = await owner.put("/api/v1/storage/mode").send({ mode: "own_s3" });
    expect(res.body.effective).toEqual({ mode: "own_s3", source: "tenant", locked: false });
    const check = await owner.post("/api/v1/storage/own-s3/check").send({});
    expect(check.body.check.ok).toBe(true);
    expect((await owner.put("/api/v1/storage/mode").send({ mode: "tape" })).status).toBe(400);
  });

  it("keeps each workspace's storage private from other workspaces", async () => {
    const view: TenantStorageView = (await ravi.get("/api/v1/storage")).body;
    expect(view.ownS3).toBeNull();
    expect(view.effective.mode).toBe("local");
    expect((await ravi.put("/api/v1/storage/mode").send({ mode: "own_s3" })).body.error.code).toBe(
      "storage_not_ready",
    );
  });

  it("lets a workspace change its download-link lifetime within limits", async () => {
    const ok = await owner.put("/api/v1/settings/storage.download_url_ttl_seconds").send({ value: 900 });
    expect(ok.body).toMatchObject({ value: 900, source: "tenant" });
    expect((await owner.get("/api/v1/storage")).body.downloadUrlTtlSeconds).toBe(900);
    expect(
      (await owner.put("/api/v1/settings/storage.download_url_ttl_seconds").send({ value: 5 })).body.error
        .code,
    ).toBe("invalid_setting");
    expect(
      (await owner.put("/api/v1/settings/storage.allowed_modes").send({ value: ["local"] })).body.error.code,
    ).toBe("setting_not_editable");
    expect((await owner.put("/api/v1/settings/not.a.setting").send({ value: 1 })).body.error.code).toBe(
      "unknown_setting",
    );
    const reset = await owner.delete("/api/v1/settings/storage.download_url_ttl_seconds");
    expect(reset.body).toMatchObject({ value: 300, source: "default" });
  });
});

describe("platform console", () => {
  it("is closed to everyone except the platform owner", async () => {
    for (const [method, path] of [
      ["get", "/api/v1/platform/storage"],
      ["get", "/api/v1/platform/audit"],
      ["get", "/api/v1/platform/settings"],
    ] as const) {
      const res = await ravi[method](path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe("platform_only");
    }
    expect(
      (
        await ravi
          .put("/api/v1/platform/storage/rules")
          .send({ defaultMode: "local", allowedModes: ["local"] })
      ).status,
    ).toBe(403);
    expect(
      (await ravi.put(`/api/v1/platform/tenants/${ownerSession.tenant.id}/storage`).send({ mode: "local" }))
        .status,
    ).toBe(403);
  });

  it("shows every workspace and where its backups go", async () => {
    const view: PlatformStorageView = (await owner.get("/api/v1/platform/storage")).body;
    expect(view.defaultMode).toBe("local");
    expect(view.platformS3).toBeNull();
    expect(view.tenants.map((r) => [r.tenant.name, r.effectiveMode])).toEqual([
      ["Acme", "own_s3"],
      ["Globex", "local"],
    ]);
  });

  it("sets up the managed bucket and makes it the default", async () => {
    const early = await owner
      .put("/api/v1/platform/storage/rules")
      .send({ defaultMode: "platform_s3", allowedModes: ["local", "platform_s3", "own_s3"] });
    expect(early.body.error.code).toBe("storage_not_ready");

    const saved = await owner
      .put("/api/v1/platform/storage/s3")
      .send(devS3Input(DEV_S3.platformBucket, { prefix: `api-test-${randomToken(4)}` }));
    expect(saved.status).toBe(200);
    expect(saved.body.check.ok).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain(DEV_S3.secretAccessKey);

    const rules = await owner
      .put("/api/v1/platform/storage/rules")
      .send({ defaultMode: "platform_s3", allowedModes: ["local", "platform_s3", "own_s3"] });
    expect(rules.body.defaultMode).toBe("platform_s3");

    // Globex never chose, so it follows the new default.
    expect((await ravi.get("/api/v1/storage")).body.effective).toEqual({
      mode: "platform_s3",
      source: "platform_default",
      locked: false,
    });
    expect((await owner.post("/api/v1/platform/storage/local/check").send({})).body.check.ok).toBe(true);
  });

  it("can pin one workspace, which that workspace then cannot override", async () => {
    const pinned = await owner
      .put(`/api/v1/platform/tenants/${raviSession.tenant.id}/storage`)
      .send({ mode: "local" });
    expect(
      pinned.body.tenants.find((r: { tenant: { id: string } }) => r.tenant.id === raviSession.tenant.id),
    ).toMatchObject({ effectiveMode: "local", source: "forced", forcedMode: "local" });

    expect((await ravi.get("/api/v1/storage")).body.effective).toEqual({
      mode: "local",
      source: "forced",
      locked: true,
    });
    expect((await ravi.put("/api/v1/storage/mode").send({ mode: "platform_s3" })).body.error.code).toBe(
      "storage_locked",
    );

    await owner.put(`/api/v1/platform/tenants/${raviSession.tenant.id}/storage`).send({ mode: null });
    expect((await ravi.get("/api/v1/storage")).body.effective.locked).toBe(false);
    expect(
      (await owner.put("/api/v1/platform/tenants/01J0000000000000000000NONE/storage").send({ mode: "local" }))
        .status,
    ).toBe(404);
  });

  it("changes platform-wide settings, with storage rules protected from the generic endpoint", async () => {
    expect(
      (await owner.put("/api/v1/platform/settings/signup.enabled").send({ value: false })).body,
    ).toMatchObject({ value: false, isSet: true });
    const blocked = await signup(request.agent(app), "late@comer.com", "Late");
    expect(blocked.body.error.code).toBe("signup_disabled");
    await owner.put("/api/v1/platform/settings/signup.enabled").send({ value: true });
    expect(
      (await owner.put("/api/v1/platform/settings/storage.mode").send({ value: "local" })).body.error.code,
    ).toBe("use_storage_rules");
  });
});

describe("roles", () => {
  it("lets a viewer look but not change anything", async () => {
    const session: SessionView = (await signup(viewer, "viewer@initech.com", "Initech")).body;
    // Demote this member to viewer directly (member management arrives in a later milestone).
    await t.core.platform.pool.query("UPDATE memberships SET role = 'viewer' WHERE user_id = ?", [
      session.user.id,
    ]);

    const me: SessionView = (await viewer.get("/api/v1/auth/me")).body;
    expect(me.role).toBe("viewer");
    expect(me.permissions).not.toContain("storage.manage");

    expect((await viewer.get("/api/v1/storage")).status).toBe(200);
    for (const res of [
      await viewer.put("/api/v1/storage/mode").send({ mode: "local" }),
      await viewer.put("/api/v1/storage/own-s3").send(devS3Input(DEV_S3.tenantBucket)),
      await viewer.put("/api/v1/settings/storage.download_url_ttl_seconds").send({ value: 600 }),
      await viewer.get("/api/v1/audit"),
      await viewer.get("/api/v1/audit/export"),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    }
  });
});

describe("downloads from local disk", () => {
  it("honours a signed link without a session, and nothing else", async () => {
    const key = `tenants/${ownerSession.tenant.id}/sample.sql.gz`;
    await t.core.storage.local.put(key, Buffer.from("-- local dump --"));
    const url = new URL(
      await t.core.storage.local.signedDownloadUrl(key, { expiresInSeconds: 60, fileName: "sample.sql.gz" }),
    );

    const ok = await request(app).get(url.pathname);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-disposition"]).toBe('attachment; filename="sample.sql.gz"');
    expect(ok.body.toString()).toBe("-- local dump --");

    const expired = new URL(
      await t.core.storage.local.signedDownloadUrl(key, { expiresInSeconds: -1, fileName: "x" }),
    );
    expect((await request(app).get(expired.pathname)).status).toBe(404);
    expect((await request(app).get(url.pathname.slice(0, -4) + "AAAA")).status).toBe(404);
    expect((await request(app).get("/api/v1/storage/local/not-a-token")).status).toBe(404);
  });
});

describe("audit trail", () => {
  it("shows a workspace its own history, verifiable and exportable", async () => {
    const page = (await owner.get("/api/v1/audit?limit=100")).body;
    const actions = page.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "workspace.created",
        "storage.target.saved",
        "settings.updated",
        "storage.target.checked",
      ]),
    );
    expect(JSON.stringify(page)).not.toContain(DEV_S3.secretAccessKey);

    expect((await owner.get("/api/v1/audit/verify")).body).toMatchObject({ ok: true, brokenAtSeq: null });

    const csv = await owner.get("/api/v1/audit/export");
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\n")[0]).toBe(
      "seq,time_utc,actor_type,actor,action,target_type,target_id,ip,details,hash",
    );
    expect(csv.text).toContain("storage.target.saved");
    // The export is itself recorded.
    expect((await owner.get("/api/v1/audit?action=audit.")).body.entries[0].action).toBe("audit.exported");
  });

  it("keeps workspaces' histories separate, and shows the platform log only to the owner", async () => {
    const ravisLog = (await ravi.get("/api/v1/audit?limit=100")).body.entries.map(
      (e: { action: string }) => e.action,
    );
    expect(ravisLog).toEqual(
      expect.arrayContaining(["settings.locked_by_platform", "settings.unlocked_by_platform"]),
    );
    expect(ravisLog).not.toContain("storage.target.saved");

    const platformLog = (await owner.get("/api/v1/platform/audit?limit=100")).body.entries.map(
      (e: { action: string }) => e.action,
    );
    expect(platformLog).toEqual(
      expect.arrayContaining([
        "auth.signup",
        "storage.target.saved",
        "settings.platform.updated",
        "settings.tenant_override.set",
      ]),
    );
    expect((await owner.get("/api/v1/platform/audit/verify")).body.ok).toBe(true);
  });

  it("exports the whole record however long it is, and puts up with nonsense paging", async () => {
    const tenant = (await t.core.tenants.findById(raviSession.tenant.id))!;
    const db = await t.core.tenants.db(tenant);
    // More than two pages of entries.
    for (let i = 0; i < 450; i++) {
      await t.core.audit.record(db, { actor: SYSTEM_ACTOR, action: "test.filler", metadata: { i } });
    }
    const existing = (await ravi.get("/api/v1/audit/verify")).body.entries as number;

    const csv = await ravi.get("/api/v1/audit/export");
    const lines = csv.text.trim().split("\n");
    // The header, every entry that existed, and the entry that records this export.
    expect(lines).toHaveLength(1 + existing + 1);
    expect(new Set(lines.slice(1).map((line) => line.split(",")[0])).size).toBe(existing + 1);

    expect((await ravi.get("/api/v1/audit?limit=abc&before=xyz")).status).toBe(200);
    expect((await ravi.get("/api/v1/audit?limit=1.5")).body.entries).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  it("slows down repeated wrong passwords", async () => {
    const limited = createApp(t.core, { rateLimits: true, rateLimitPrefix: `dbrb:test:${randomToken(6)}` });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (
          await request(limited)
            .post("/api/v1/auth/login")
            .send({ email: "owner@acme.com", password: "wrong-wrong-wrong" })
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
