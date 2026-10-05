import {
  boolean,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { NOW, idColumn, timestampColumn } from "../common";

/**
 * The platform database: identities, the tenant registry, sessions, and the
 * platform owner's rules. It holds NO customer backup data and no tenant
 * configuration; that all lives in each tenant's own database.
 */
export * from "../common";

export const users = mysqlTable(
  "users",
  {
    id: idColumn("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    /** Platform owner / staff: can open the platform console. */
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    locale: varchar("locale", { length: 10 }).notNull().default("en"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    emailVerifiedAt: timestampColumn("email_verified_at"),
    lastLoginAt: timestampColumn("last_login_at"),
    createdAt: timestampColumn("created_at").notNull().default(NOW),
    updatedAt: timestampColumn("updated_at").notNull().default(NOW),
  },
  (t) => [uniqueIndex("uq_users_email").on(t.email)],
);

/**
 * The tenant registry. Each tenant's data lives in its own MySQL database,
 * reached with its own MySQL user, so one tenant's credentials can never read
 * another tenant's tables.
 */
export const tenants = mysqlTable(
  "tenants",
  {
    id: idColumn("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 63 }).notNull(),
    status: mysqlEnum("status", ["provisioning", "active", "suspended", "pending_deletion", "deleted"])
      .notNull()
      .default("provisioning"),
    plan: varchar("plan", { length: 32 }).notNull().default("free"),
    dbName: varchar("db_name", { length: 64 }).notNull(),
    dbUser: varchar("db_user", { length: 32 }).notNull(),
    /** The tenant database password, wrapped by the key provider. */
    dbPasswordEnc: text("db_password_enc").notNull(),
    /** The tenant's data key (encrypts its secrets), wrapped by the key provider. */
    dataKeyEnc: text("data_key_enc").notNull(),
    suspendedAt: timestampColumn("suspended_at"),
    suspendedReason: varchar("suspended_reason", { length: 255 }),
    createdAt: timestampColumn("created_at").notNull().default(NOW),
    updatedAt: timestampColumn("updated_at").notNull().default(NOW),
  },
  (t) => [uniqueIndex("uq_tenants_slug").on(t.slug), uniqueIndex("uq_tenants_db_name").on(t.dbName)],
);

export const memberships = mysqlTable(
  "memberships",
  {
    id: idColumn("id").primaryKey(),
    tenantId: idColumn("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: idColumn("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull(),
    createdAt: timestampColumn("created_at").notNull().default(NOW),
  },
  (t) => [
    uniqueIndex("uq_memberships_tenant_user").on(t.tenantId, t.userId),
    index("idx_memberships_user").on(t.userId),
  ],
);

/** Server-side sessions. Only a hash of the cookie token is stored. */
export const sessions = mysqlTable(
  "sessions",
  {
    id: idColumn("id").primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: idColumn("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The workspace this session is currently working in. */
    tenantId: idColumn("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: timestampColumn("created_at").notNull().default(NOW),
    lastSeenAt: timestampColumn("last_seen_at").notNull().default(NOW),
    expiresAt: timestampColumn("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_sessions_token").on(t.tokenHash),
    index("idx_sessions_user").on(t.userId),
    index("idx_sessions_expires").on(t.expiresAt),
  ],
);

/**
 * Values the platform owner pinned for one specific tenant. A pinned value wins
 * over whatever the tenant's admin chose, and the tenant cannot change it.
 */
export const tenantOverrides = mysqlTable(
  "tenant_overrides",
  {
    tenantId: idColumn("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 128 }).notNull(),
    value: json("value").$type<unknown>().notNull(),
    updatedBy: idColumn("updated_by"),
    updatedAt: timestampColumn("updated_at").notNull().default(NOW),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);
