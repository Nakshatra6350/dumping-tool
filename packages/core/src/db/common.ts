import type { S3PublicConfig } from "@dbrb/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Tables that exist with the same shape in BOTH the platform database and every
 * tenant database. Defining them once means the audit, settings and storage code
 * works unchanged against either: the only difference is which database handle
 * it is given.
 */

export const idColumn = (name: string) => char(name, { length: 26 });

/** UTC timestamps with millisecond precision. */
export const timestampColumn = (name: string) => datetime(name, { mode: "date", fsp: 3 });

export const NOW = sql`CURRENT_TIMESTAMP(3)`;

/**
 * Append-only, hash-chained audit trail. `seq` is assigned by the application
 * under a row lock on audit_heads, so the chain has no gaps and every entry's
 * hash covers the previous one (see audit/service.ts).
 */
export const auditLog = mysqlTable(
  "audit_log",
  {
    seq: bigint("seq", { mode: "number", unsigned: true }).primaryKey(),
    id: idColumn("id").notNull(),
    ts: timestampColumn("ts").notNull(),
    /** user = a signed-in person, system = automation, platform = platform staff acting on a tenant */
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorId: idColumn("actor_id"),
    actorLabel: varchar("actor_label", { length: 255 }),
    action: varchar("action", { length: 96 }).notNull(),
    targetType: varchar("target_type", { length: 48 }),
    targetId: varchar("target_id", { length: 96 }),
    /** Only used in the platform database, for actions that concern one tenant. */
    tenantId: idColumn("tenant_id"),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
    requestId: varchar("request_id", { length: 40 }),
    metadata: json("metadata").$type<Record<string, unknown> | null>(),
    prevHash: char("prev_hash", { length: 64 }).notNull(),
    hash: char("hash", { length: 64 }).notNull(),
  },
  (t) => [index("idx_audit_ts").on(t.ts), index("idx_audit_action").on(t.action)],
);

/** One row ("main") holding the tip of the audit chain. Locked while appending. */
export const auditHeads = mysqlTable("audit_heads", {
  scope: varchar("scope", { length: 16 }).primaryKey(),
  lastSeq: bigint("last_seq", { mode: "number", unsigned: true }).notNull(),
  lastHash: char("last_hash", { length: 64 }).notNull(),
});

/**
 * S3 buckets that backups can be written to. In the platform database this is
 * the platform's own ("managed") bucket; in a tenant database it is that
 * tenant's own bucket. Secrets are encrypted before they are stored.
 *
 * A target is never deleted while backups may still live in it: changing the
 * bucket retires the old row (still readable) and creates a new one.
 */
export const storageTargets = mysqlTable("storage_targets", {
  id: idColumn("id").primaryKey(),
  kind: varchar("kind", { length: 16 }).notNull(),
  status: mysqlEnum("status", ["active", "retired"]).notNull().default("active"),
  config: json("config").$type<S3PublicConfig>().notNull(),
  secretsEnc: text("secrets_enc").notNull(),
  /** Last four characters of the access key ID, to recognise which key is saved. */
  accessKeyIdHint: varchar("access_key_id_hint", { length: 8 }).notNull(),
  lastCheckAt: timestampColumn("last_check_at"),
  lastCheckOk: boolean("last_check_ok"),
  lastCheckDetail: varchar("last_check_detail", { length: 500 }),
  createdBy: idColumn("created_by"),
  createdAt: timestampColumn("created_at").notNull().default(NOW),
  updatedAt: timestampColumn("updated_at").notNull().default(NOW),
});

/**
 * Key/value configuration. In the platform database: platform-wide values.
 * In a tenant database: the values that tenant's admin chose.
 */
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: json("value").$type<unknown>().notNull(),
  updatedBy: idColumn("updated_by"),
  updatedAt: timestampColumn("updated_at").notNull().default(NOW),
});
