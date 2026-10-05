import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessions, users } from "../db/platform/schema";
import { AppError } from "../errors";
import { createTestCore, type TestCore } from "../testing/harness";
import type { RequestMeta } from "./service";

let t: TestCore;
const meta: RequestMeta = { ip: "203.0.113.7", userAgent: "vitest", requestId: "req-auth" };

beforeAll(async () => {
  t = await createTestCore({ platformAdminEmails: ["staff@dbrb.dev"] });
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

const signup = (email: string, workspaceName = "Acme") =>
  t.core.auth.signup(
    {
      name: "Asha Rao",
      email,
      password: "correct-horse-battery",
      workspaceName,
      locale: "hi",
      timezone: "Asia/Kolkata",
    },
    meta,
  );

describe("sign-up", () => {
  it("creates the account, a workspace with its own database, and an owner session", async () => {
    const { token, session } = await signup("asha@acme.com");

    expect(session.role).toBe("owner");
    expect(session.user).toMatchObject({ email: "asha@acme.com", locale: "hi", timezone: "Asia/Kolkata" });
    expect(session.tenant).toMatchObject({ name: "Acme", status: "active" });
    // The password is stored as a slow hash, never in the clear.
    expect(session.user.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(session.user.passwordHash).not.toContain("correct-horse-battery");

    const resolved = await t.core.auth.resolve(token);
    expect(resolved).toMatchObject({
      role: "owner",
      user: { id: session.user.id },
      tenant: { id: session.tenant.id },
    });
    // Only a hash of the session token is stored.
    const [row] = await t.core.platform.db.select().from(sessions).where(eq(sessions.id, session.sessionId));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.ip).toBe("203.0.113.7");
  });

  it("makes the first account the platform owner, and later ones ordinary", async () => {
    const [first] = await t.core.platform.db.select().from(users).where(eq(users.email, "asha@acme.com"));
    expect(first!.isPlatformAdmin).toBe(true);

    const second = await signup("ravi@globex.com", "Globex");
    expect(second.session.user.isPlatformAdmin).toBe(false);
    expect(second.session.tenant.id).not.toBe(
      (await t.core.auth.login({ email: "asha@acme.com", password: "correct-horse-battery" }, meta)).session
        .tenant.id,
    );

    const staff = await signup("staff@dbrb.dev", "Staff");
    expect(staff.session.user.isPlatformAdmin).toBe(true);
  });

  it("refuses a duplicate email and leaves nothing half-created", async () => {
    const before = (await t.core.tenants.list()).length;
    const error = await failure(signup("asha@acme.com", "Duplicate"));
    expect(error.code).toBe("email_taken");
    expect(error.fields).toHaveProperty("email");
    expect((await t.core.tenants.list()).length).toBe(before);
  });

  it("two simultaneous sign-ups with the same email cannot both succeed", async () => {
    const before = (await t.core.tenants.list()).length;
    const results = await Promise.allSettled([
      signup("race@acme.com", "Race A"),
      signup("race@acme.com", "Race B"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe("email_taken");
    // Exactly one workspace was created for the winner; the loser left nothing behind.
    expect((await t.core.tenants.list()).length).toBe(before + 1);
  });

  it("can be closed by the platform owner", async () => {
    await t.core.settings.setPlatform("signup.enabled", false, {
      type: "platform",
      id: null,
      label: "owner",
    });
    expect((await failure(signup("late@comer.com"))).code).toBe("signup_disabled");
    await t.core.settings.setPlatform("signup.enabled", true, { type: "platform", id: null, label: "owner" });
  });
});

describe("login and sessions", () => {
  it("rejects a wrong password and an unknown email with the same message", async () => {
    const wrong = await failure(
      t.core.auth.login({ email: "asha@acme.com", password: "nope-nope-nope" }, meta),
    );
    const unknown = await failure(
      t.core.auth.login({ email: "nobody@nowhere.com", password: "nope-nope-nope" }, meta),
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.message).toBe(unknown.message);
  });

  it("signs in, and signing out revokes the session", async () => {
    const { token, session } = await t.core.auth.login(
      { email: "asha@acme.com", password: "correct-horse-battery" },
      meta,
    );
    expect(session.role).toBe("owner");
    expect(await t.core.auth.resolve(token)).not.toBeNull();
    await t.core.auth.logout(token);
    expect(await t.core.auth.resolve(token)).toBeNull();
    expect(await t.core.auth.resolve("made-up-token")).toBeNull();
  });

  it("stops honouring an expired session", async () => {
    const { token, session } = await t.core.auth.login(
      { email: "asha@acme.com", password: "correct-horse-battery" },
      meta,
    );
    await t.core.platform.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, session.sessionId));
    expect(await t.core.auth.resolve(token)).toBeNull();
  });

  it("changing the password signs out every other device", async () => {
    const laptop = await t.core.auth.login(
      { email: "ravi@globex.com", password: "correct-horse-battery" },
      meta,
    );
    const phone = await t.core.auth.login(
      { email: "ravi@globex.com", password: "correct-horse-battery" },
      meta,
    );

    const wrong = await failure(
      t.core.auth.changePassword(
        laptop.session,
        { currentPassword: "not-my-password", newPassword: "a-brand-new-password" },
        meta,
      ),
    );
    expect(wrong.code).toBe("wrong_password");

    await t.core.auth.changePassword(
      laptop.session,
      { currentPassword: "correct-horse-battery", newPassword: "a-brand-new-password" },
      meta,
    );
    expect(await t.core.auth.resolve(laptop.token)).not.toBeNull();
    expect(await t.core.auth.resolve(phone.token)).toBeNull();
    expect(
      (
        await failure(
          t.core.auth.login({ email: "ravi@globex.com", password: "correct-horse-battery" }, meta),
        )
      ).status,
    ).toBe(401);
    expect(
      (await t.core.auth.login({ email: "ravi@globex.com", password: "a-brand-new-password" }, meta)).session
        .role,
    ).toBe("owner");
  });

  it("writes sign-ups, logins and failures to the audit trails", async () => {
    const platformLog = await t.core.audit.list(t.core.platform.db, { limit: 200 });
    const actions = platformLog.entries.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["auth.signup", "auth.login", "auth.login_failed", "auth.password_changed"]),
    );
    const failed = platformLog.entries.filter((e) => e.action === "auth.login_failed");
    expect(failed.map((e) => e.actorLabel)).toEqual(
      expect.arrayContaining(["asha@acme.com", "ravi@globex.com"]),
    );
    expect(failed.every((e) => e.ip === "203.0.113.7")).toBe(true);

    const [asha] = await t.core.platform.db.select().from(users).where(eq(users.email, "asha@acme.com"));
    const login = await t.core.auth.login({ email: asha!.email, password: "correct-horse-battery" }, meta);
    const tenantLog = await t.core.audit.list(await t.core.tenants.db(login.session.tenant), { limit: 50 });
    expect(tenantLog.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(["workspace.created", "auth.login"]),
    );
    expect(JSON.stringify([platformLog, tenantLog])).not.toContain("correct-horse-battery");
  });
});
