import {
  isLocale,
  isRole,
  isValidTimeZone,
  permissionsFor,
  type ChangePasswordInput,
  type LoginInput,
  type ProfileInput,
  type Role,
  type SessionView,
  type SignupInput,
  type UserView,
} from "@dbrb/shared";
import { and, asc, count, eq, gt, ne } from "drizzle-orm";
import type { Actor, AuditService } from "../audit/service";
import type { AppConfig } from "../config";
import { hashPassword, needsRehash, verifyPassword } from "../crypto/passwords";
import { randomToken, sha256Hex } from "../crypto/tokens";
import { mysqlErrorCode, type Db } from "../db/mysql";
import { memberships, sessions, tenants, users } from "../db/platform/schema";
import { AppError, badRequest, conflict, forbidden, unauthorized } from "../errors";
import { newId } from "../ids";
import type { Logger } from "../logger";
import type { Mailer } from "../mail/mailer";
import { welcomeEmail } from "../mail/templates";
import type { SettingsService } from "../settings/service";
import { toTenantView, type TenantRecord, type TenantService } from "../tenancy/tenants";

export type UserRecord = typeof users.$inferSelect;

/** Where a request came from; copied onto audit entries and sessions. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** An authenticated request: who, in which workspace, with which role. */
export interface SessionContext {
  sessionId: string;
  user: UserRecord;
  tenant: TenantRecord;
  role: Role;
}

export const toUserView = (u: UserRecord): UserView => ({
  id: u.id,
  email: u.email,
  name: u.name,
  locale: isLocale(u.locale) ? u.locale : "en",
  timezone: u.timezone,
  isPlatformAdmin: u.isPlatformAdmin,
  createdAt: u.createdAt.toISOString(),
});

export const toSessionView = (s: SessionContext): SessionView => ({
  user: toUserView(s.user),
  tenant: toTenantView(s.tenant),
  role: s.role,
  permissions: [...permissionsFor(s.role)],
});

export const actorFromSession = (s: SessionContext, meta: RequestMeta): Actor => ({
  type: "user",
  id: s.user.id,
  label: s.user.email,
  ...meta,
});

/** Platform staff acting through the platform console. */
export const platformActor = (s: SessionContext, meta: RequestMeta): Actor => ({
  type: "platform",
  id: s.user.id,
  label: s.user.email,
  ...meta,
});

const LAST_SEEN_INTERVAL_MS = 5 * 60_000;
// A real hash to verify against when the email is unknown, so timing does not reveal which emails exist.
let dummyHash: Promise<string> | null = null;

interface Dependencies {
  config: Pick<AppConfig, "sessionTtlDays" | "platformAdminEmails" | "passwordHashCost" | "appUrl">;
  platform: Db;
  tenants: TenantService;
  audit: AuditService;
  settings: SettingsService;
  mailer: Mailer;
  log: Logger;
}

export class AuthService {
  constructor(private readonly deps: Dependencies) {}

  /**
   * Creates an account and a workspace. The workspace gets its own database,
   * and the new user becomes its owner. The very first account on an
   * installation is also the platform owner.
   */
  async signup(input: SignupInput, meta: RequestMeta): Promise<{ token: string; session: SessionContext }> {
    const { platform, config, tenants: tenantService, audit } = this.deps;

    const [{ total } = { total: 0 }] = await platform.select({ total: count() }).from(users);
    const isFirstUser = total === 0;
    if (!isFirstUser && !(await this.deps.settings.platformValue("signup.enabled")).value) {
      throw forbidden("signup_disabled", "New sign-ups are currently closed");
    }

    const [existing] = await platform
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing) {
      throw new AppError(409, "email_taken", "An account with this email already exists", {
        fields: { email: "An account with this email already exists" },
      });
    }

    const userId = newId();
    try {
      await platform.insert(users).values({
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password, config.passwordHashCost),
        isPlatformAdmin: isFirstUser || config.platformAdminEmails.includes(input.email),
        locale: input.locale ?? "en",
        timezone: input.timezone && isValidTimeZone(input.timezone) ? input.timezone : "UTC",
      });
    } catch (err) {
      // Two sign-ups with the same email at the same moment: the unique index decides.
      if (mysqlErrorCode(err) === "ER_DUP_ENTRY") {
        throw conflict("email_taken", "An account with this email already exists");
      }
      throw err;
    }

    let tenant: TenantRecord;
    try {
      tenant = await tenantService.provision({ name: input.workspaceName });
      await platform.insert(memberships).values({ id: newId(), tenantId: tenant.id, userId, role: "owner" });
    } catch (err) {
      // Never leave an account without a workspace behind.
      await platform.delete(users).where(eq(users.id, userId));
      throw err;
    }

    const user = (await this.findUser(userId))!;
    const { token, sessionId } = await this.createSession(user.id, tenant.id, meta);
    const session: SessionContext = { sessionId, user, tenant, role: "owner" };
    const actor = actorFromSession(session, meta);

    await audit.record(platform, {
      actor,
      action: "auth.signup",
      targetType: "user",
      targetId: user.id,
      tenantId: tenant.id,
      metadata: { platformAdmin: user.isPlatformAdmin },
    });
    await audit.record(await tenantService.db(tenant), {
      actor,
      action: "workspace.created",
      targetType: "tenant",
      targetId: tenant.id,
      metadata: { name: tenant.name },
    });

    // A failed welcome email must not fail the sign-up.
    this.deps.mailer
      .send({
        to: user.email,
        ...welcomeEmail(user.locale, { name: user.name, workspace: tenant.name, appUrl: config.appUrl }),
      })
      .catch((err) => this.deps.log.warn({ err }, "could not send welcome email"));

    return { token, session };
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<{ token: string; session: SessionContext }> {
    const { platform, config, audit } = this.deps;
    const invalid = () => unauthorized("Incorrect email or password");

    const [user] = await platform.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user) {
      dummyHash ??= hashPassword("dbrb-timing-equaliser", config.passwordHashCost);
      await verifyPassword(input.password, await dummyHash);
      throw invalid();
    }

    if (!(await verifyPassword(input.password, user.passwordHash))) {
      await audit.record(platform, {
        actor: { type: "user", id: user.id, label: user.email, ...meta },
        action: "auth.login_failed",
        targetType: "user",
        targetId: user.id,
      });
      throw invalid();
    }

    // Sign in to the workspace the user joined first that is still usable.
    const [membership] = await platform
      .select({ tenant: tenants, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.userId, user.id),
          ne(tenants.status, "deleted"),
          ne(tenants.status, "provisioning"),
        ),
      )
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    if (!membership || !isRole(membership.role)) {
      throw forbidden("no_workspace", "This account is not a member of any workspace");
    }

    const updates: Partial<UserRecord> = { lastLoginAt: new Date() };
    if (needsRehash(user.passwordHash, config.passwordHashCost)) {
      updates.passwordHash = await hashPassword(input.password, config.passwordHashCost);
    }
    await platform.update(users).set(updates).where(eq(users.id, user.id));

    const { token, sessionId } = await this.createSession(user.id, membership.tenant.id, meta);
    const session: SessionContext = { sessionId, user, tenant: membership.tenant, role: membership.role };
    const actor = actorFromSession(session, meta);

    await audit.record(platform, {
      actor,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      tenantId: membership.tenant.id,
    });
    await audit.record(await this.deps.tenants.db(membership.tenant), {
      actor,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
    });

    return { token, session };
  }

  async logout(token: string): Promise<void> {
    await this.deps.platform.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
  }

  /** Turns a session cookie into who is asking, or null if it is missing, expired or revoked. */
  async resolve(token: string): Promise<SessionContext | null> {
    const { platform } = this.deps;
    const [row] = await platform
      .select({ session: sessions, user: users, tenant: tenants, role: memberships.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
      .innerJoin(
        memberships,
        and(eq(memberships.userId, sessions.userId), eq(memberships.tenantId, sessions.tenantId)),
      )
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (!row || !isRole(row.role)) return null;
    if (row.tenant.status === "deleted" || row.tenant.status === "provisioning") return null;

    if (Date.now() - row.session.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
      void platform
        .update(sessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(sessions.id, row.session.id))
        .catch(() => {});
    }
    return { sessionId: row.session.id, user: row.user, tenant: row.tenant, role: row.role };
  }

  /** Changes the password and signs out every other session of this user. */
  async changePassword(
    session: SessionContext,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    const { platform, config, audit } = this.deps;
    const user = (await this.findUser(session.user.id))!;
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw badRequest("wrong_password", "Your current password is incorrect", {
        currentPassword: "Your current password is incorrect",
      });
    }
    await platform
      .update(users)
      .set({
        passwordHash: await hashPassword(input.newPassword, config.passwordHashCost),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await platform
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, session.sessionId)));
    await audit.record(platform, {
      actor: actorFromSession(session, meta),
      action: "auth.password_changed",
      targetType: "user",
      targetId: user.id,
    });
  }

  async updateProfile(session: SessionContext, input: ProfileInput): Promise<UserRecord> {
    await this.deps.platform
      .update(users)
      .set({ name: input.name, locale: input.locale, timezone: input.timezone, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));
    return (await this.findUser(session.user.id))!;
  }

  private async findUser(id: string): Promise<UserRecord | null> {
    const [row] = await this.deps.platform.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  private async createSession(userId: string, tenantId: string, meta: RequestMeta) {
    const token = randomToken(32);
    const sessionId = newId();
    await this.deps.platform.insert(sessions).values({
      id: sessionId,
      tokenHash: sha256Hex(token),
      userId,
      tenantId,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      expiresAt: new Date(Date.now() + this.deps.config.sessionTtlDays * 86_400_000),
    });
    return { token, sessionId };
  }
}
