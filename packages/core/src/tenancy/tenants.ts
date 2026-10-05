import type { TenantView } from "@dbrb/shared";
import { asc, eq } from "drizzle-orm";
import mysql from "mysql2/promise";
import type { AppConfig } from "../config";
import { generateDataKey, type KeyProvider } from "../crypto/keys";
import { randomToken } from "../crypto/tokens";
import {
  createHandle,
  migrateTenant,
  parseMysqlUrl,
  quoteGrantDatabase,
  quoteIdentifier,
  type Db,
} from "../db/mysql";
import { auditHeads } from "../db/common";
import { tenants } from "../db/platform/schema";
import { newId } from "../ids";
import type { Logger } from "../logger";
import { GENESIS_HASH } from "../audit/hash";
import { tenantDataKeyContext, tenantDbPasswordContext, type TenantConnections } from "./connections";

export type TenantRecord = typeof tenants.$inferSelect;

export const toTenantView = (t: TenantRecord): TenantView => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  status: t.status,
  plan: t.plan,
  createdAt: t.createdAt.toISOString(),
});

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

/**
 * The tenant registry and lifecycle: creating a tenant's isolated database,
 * looking tenants up, and removing them completely.
 */
export class TenantService {
  constructor(
    private readonly config: Pick<AppConfig, "database">,
    private readonly platform: Db,
    private readonly connections: TenantConnections,
    private readonly keys: KeyProvider,
    private readonly log: Logger,
  ) {}

  async findById(id: string): Promise<TenantRecord | null> {
    const [row] = await this.platform.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return row ?? null;
  }

  async list(): Promise<TenantRecord[]> {
    return this.platform.select().from(tenants).orderBy(asc(tenants.createdAt));
  }

  db(tenant: TenantRecord): Promise<Db> {
    return this.connections.db(tenant);
  }

  dataKey(tenant: TenantRecord): Promise<Buffer> {
    return this.connections.dataKey(tenant);
  }

  /**
   * Creates a tenant with its own database, its own MySQL user (which can reach
   * only that database) and its own encryption key, then applies the tenant
   * schema. If any step fails, everything created so far is removed.
   */
  async provision(input: { name: string }): Promise<TenantRecord> {
    const id = newId();
    const suffix = id.toLowerCase();
    const dbName = `${this.config.database.tenantPrefix}${suffix}`;
    // MySQL user names are limited to 32 characters.
    const dbUser = `t_${suffix}`;
    const dbPassword = randomToken(32);

    const admin = await this.adminConnection();
    try {
      await admin.query(
        `CREATE DATABASE ${quoteIdentifier(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [dbUser, dbPassword]);
      await admin.query(`GRANT ALL PRIVILEGES ON ${quoteGrantDatabase(dbName)}.* TO ?@'%'`, [dbUser]);

      const record = {
        id,
        name: input.name,
        slug: await this.uniqueSlug(input.name),
        status: "provisioning" as const,
        dbName,
        dbUser,
        dbPasswordEnc: await this.keys.wrap(Buffer.from(dbPassword, "utf8"), tenantDbPasswordContext(id)),
        dataKeyEnc: await this.keys.wrap(generateDataKey(), tenantDataKeyContext(id)),
      };
      await this.platform.insert(tenants).values(record);

      const tenant = (await this.findById(id))!;
      const db = await this.connections.db(tenant);
      await migrateTenant(db);
      await db.insert(auditHeads).values({ scope: "main", lastSeq: 0, lastHash: GENESIS_HASH });

      await this.platform
        .update(tenants)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(tenants.id, id));
      this.log.info({ tenantId: id, dbName }, "tenant provisioned");
      return (await this.findById(id))!;
    } catch (err) {
      this.log.error({ err, tenantId: id }, "tenant provisioning failed, rolling back");
      await this.connections.close(id);
      await this.platform
        .delete(tenants)
        .where(eq(tenants.id, id))
        .catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)}`).catch(() => {});
      await admin.query(`DROP USER IF EXISTS ?@'%'`, [dbUser]).catch(() => {});
      throw err;
    } finally {
      await admin.end();
    }
  }

  /**
   * Permanently erases a tenant: its database, its MySQL user and its registry
   * row (which holds the wrapped data key, so anything it encrypted elsewhere
   * becomes unrecoverable). Used for account deletion and by tests.
   */
  async destroy(tenant: TenantRecord): Promise<void> {
    await this.connections.close(tenant.id);
    const admin = await this.adminConnection();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(tenant.dbName)}`);
      await admin.query(`DROP USER IF EXISTS ?@'%'`, [tenant.dbUser]);
    } finally {
      await admin.end();
    }
    await this.platform.delete(tenants).where(eq(tenants.id, tenant.id));
    this.log.info({ tenantId: tenant.id }, "tenant destroyed");
  }

  /** Applies pending tenant migrations to every tenant database. */
  async migrateAll(): Promise<{ migrated: number; failed: string[] }> {
    const failed: string[] = [];
    let migrated = 0;
    for (const tenant of await this.list()) {
      if (tenant.status === "deleted") continue;
      try {
        await migrateTenant(await this.connections.db(tenant));
        migrated += 1;
      } catch (err) {
        this.log.error({ err, tenantId: tenant.id }, "tenant migration failed");
        failed.push(tenant.id);
      }
    }
    return { migrated, failed };
  }

  private adminConnection() {
    const { host, port, user, password } = parseMysqlUrl(this.config.database.adminUrl);
    return mysql.createConnection({ host, port, user, password });
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug =
        attempt === 0
          ? base
          : `${base}-${randomToken(3)
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "x")}`;
      const [taken] = await this.platform
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      if (!taken) return slug;
    }
    return `${base}-${newId().toLowerCase().slice(-8)}`;
  }
}

/** Creates the platform database if it does not exist yet (development and tests). */
export const ensurePlatformDatabase = async (config: Pick<AppConfig, "database">): Promise<void> => {
  const { host, port, user, password } = parseMysqlUrl(config.database.adminUrl);
  const { database } = parseMysqlUrl(config.database.url);
  if (!database) throw new Error("DATABASE_URL must include a database name");
  const admin = await mysql.createConnection({ host, port, user, password });
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await admin.end();
  }
};

export const createPlatformHandle = (config: Pick<AppConfig, "database">) => {
  const endpoint = parseMysqlUrl(config.database.url);
  return createHandle({ ...endpoint, connectionLimit: 10 });
};
