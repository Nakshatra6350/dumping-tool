import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Redis } from "ioredis";
import mysql from "mysql2/promise";
import { RATE_LIMIT_KEY_PREFIX, type AppConfig } from "../config";
import { createCore } from "../core";
import { parseMysqlUrl, quoteIdentifier } from "../db/mysql";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const SYSTEM_SCHEMAS = new Set(["mysql", "sys", "information_schema", "performance_schema"]);

export interface ResetSummary {
  tenantDatabases: number;
  mysqlUsers: number;
  storageEntries: number;
  rateLimitKeys: number;
}

/** True when `child` is `parent` itself or somewhere inside it. */
const contains = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * Throws unless wiping this configuration's data is plainly a development
 * action: not production, a database on this machine, and a storage directory
 * that is not a drive root, the project itself or someone's home directory.
 */
export const assertSafeToReset = (config: AppConfig): void => {
  if (config.isProduction) throw new Error("Refusing to reset: NODE_ENV is production.");

  for (const url of [config.database.url, config.database.adminUrl]) {
    const { host } = parseMysqlUrl(url);
    if (!LOCAL_HOSTS.has(host))
      throw new Error(`Refusing to reset: the database host "${host}" is not this machine.`);
  }

  const dir = path.resolve(config.storage.localDir);
  if (path.parse(dir).root === dir || contains(dir, config.rootDir) || contains(dir, os.homedir())) {
    throw new Error(`Refusing to reset: the storage directory "${dir}" is too broad to empty safely.`);
  }
};

/**
 * Erases all development data and leaves an empty, migrated platform, so the
 * next sign-up is the first account again (and therefore the platform owner).
 *
 * Removed: every workspace database and its MySQL user, the platform database,
 * the files in local storage and the sign-in rate-limit counters. Objects in S3
 * buckets are left alone. Anything still connected (a running API) must be
 * restarted afterwards, because it will be holding connections to databases
 * that no longer exist.
 */
export const resetDevelopmentData = async (
  config: AppConfig,
  options: { rateLimitPrefix?: string } = {},
): Promise<ResetSummary> => {
  assertSafeToReset(config);

  const { host, port, user, password } = parseMysqlUrl(config.database.adminUrl);
  const platformDb = parseMysqlUrl(config.database.url).database;
  if (!platformDb) throw new Error("DATABASE_URL must include a database name");
  const prefix = config.database.tenantPrefix;

  const databases = new Set<string>();
  const users = new Set<string>();
  const admin = await mysql.createConnection({ host, port, user, password });
  try {
    // Workspaces the registry knows about...
    try {
      const [rows] = await admin.query<mysql.RowDataPacket[]>(
        `SELECT db_name AS dbName, db_user AS dbUser FROM ${quoteIdentifier(platformDb)}.tenants`,
      );
      for (const row of rows) {
        databases.add(String(row.dbName));
        users.add(String(row.dbUser));
      }
    } catch {
      // No platform database yet, so nothing is registered.
    }

    // ...and any left behind by an interrupted sign-up.
    const [schemas] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA",
    );
    for (const row of schemas) {
      const name = String(row.name);
      if (!name.startsWith(prefix)) continue;
      databases.add(name);
      const suffix = name.slice(prefix.length);
      if (/^[0-9a-z]{26}$/.test(suffix)) users.add(`t_${suffix}`);
    }

    databases.delete(platformDb);
    for (const name of databases) {
      if (SYSTEM_SCHEMAS.has(name.toLowerCase()))
        throw new Error(`Refusing to drop the system schema "${name}".`);
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
    }
    for (const name of users) await admin.query(`DROP USER IF EXISTS ?@'%'`, [name]);
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(platformDb)}`);
  } finally {
    await admin.end();
  }

  // Backup files written by the "local disk" storage mode.
  let storageEntries = 0;
  const dir = path.resolve(config.storage.localDir);
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
    storageEntries += 1;
  }

  // Sign-in and sign-up attempt counters, so a reset never leaves you locked out.
  // If Redis is not running they are skipped: they expire by themselves.
  let rateLimitKeys = 0;
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${options.rateLimitPrefix ?? RATE_LIMIT_KEY_PREFIX}:*`,
        "COUNT",
        500,
      );
      cursor = next;
      if (keys.length) rateLimitKeys += await redis.unlink(...keys);
    } while (cursor !== "0");
  } catch {
    // Redis unavailable.
  } finally {
    redis.disconnect();
  }

  // Recreate an empty platform database with the current schema.
  const core = createCore({ ...config, autoMigrate: true });
  try {
    await core.init();
  } finally {
    await core.close();
  }

  return { tenantDatabases: databases.size, mysqlUsers: users.size, storageEntries, rateLimitKeys };
};
