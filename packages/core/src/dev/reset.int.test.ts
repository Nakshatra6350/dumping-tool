import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Redis } from "ioredis";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { createCore } from "../core";
import { parseMysqlUrl, quoteIdentifier } from "../db/mysql";
import type { RequestMeta } from "../auth/service";
import { users } from "../db/platform/schema";
import { createTestCore } from "../testing/harness";
import { assertSafeToReset, resetDevelopmentData } from "./reset";

const meta: RequestMeta = { ip: "203.0.113.9", userAgent: "vitest", requestId: "req-reset" };
const signupInput = {
  name: "First Owner",
  workspaceName: "First",
  email: "first@example.com",
  password: "a long test passphrase",
  locale: "en" as const,
  timezone: "UTC",
};

describe("development reset: safety checks", () => {
  it("refuses production, remote databases and storage directories that are too broad", async () => {
    const t = await createTestCore();
    try {
      expect(() => assertSafeToReset(t.config)).not.toThrow();

      expect(() => assertSafeToReset({ ...t.config, isProduction: true })).toThrow(/production/);

      const remote = { ...t.config.database, url: "mysql://root:pw@db.example.com:3306/dbrb_platform" };
      expect(() => assertSafeToReset({ ...t.config, database: remote })).toThrow(/not this machine/);
      const remoteAdmin = { ...t.config.database, adminUrl: "mysql://root:pw@10.0.0.5:3306" };
      expect(() => assertSafeToReset({ ...t.config, database: remoteAdmin })).toThrow(/not this machine/);

      for (const localDir of [
        path.parse(os.homedir()).root,
        os.homedir(),
        t.config.rootDir,
        path.dirname(t.config.rootDir),
      ]) {
        expect(() => assertSafeToReset({ ...t.config, storage: { localDir } })).toThrow(/too broad/);
      }
    } finally {
      await t.cleanup();
    }
  });
});

describe("development reset", () => {
  it("erases every workspace and leaves an empty platform where the next sign-up is the owner", async () => {
    const t = await createTestCore();
    const { config } = t;
    const { host, port, user, password } = parseMysqlUrl(config.database.adminUrl);
    const platformDb = parseMysqlUrl(config.database.url).database!;
    const orphanDb = `${config.database.tenantPrefix}orphan`;
    const rateLimitPrefix = `${config.database.tenantPrefix}rl`;
    const admin = await mysql.createConnection({ host, port, user, password });
    const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });

    const exists = async (database: string) => {
      const [rows] = await admin.query<mysql.RowDataPacket[]>(
        "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
        [database],
      );
      return rows.length > 0;
    };
    const userExists = async (name: string) => {
      const [rows] = await admin.query<mysql.RowDataPacket[]>("SELECT 1 FROM mysql.user WHERE user = ?", [
        name,
      ]);
      return rows.length > 0;
    };

    try {
      // Two real workspaces, a database left behind by an interrupted sign-up,
      // a stored file and a sign-in counter.
      const first = await t.core.auth.signup(signupInput, meta);
      const second = await t.core.tenants.provision({ name: "Second" });
      await admin.query(`CREATE DATABASE ${quoteIdentifier(orphanDb)}`);
      await mkdir(path.join(config.storage.localDir, "tenants", "x"), { recursive: true });
      await writeFile(
        path.join(config.storage.localDir, "tenants", "x", "backup.sql.gz"),
        "not a real backup",
      );
      await redis.set(`${rateLimitPrefix}:login:first@example.com`, "5");
      await redis.set(`${config.database.tenantPrefix}other:keep`, "1");

      const firstTenant = first.session.tenant;
      expect(first.session.user.isPlatformAdmin).toBe(true);
      await t.core.close();

      const summary = await resetDevelopmentData(config, { rateLimitPrefix });

      expect(summary).toEqual({ tenantDatabases: 3, mysqlUsers: 2, storageEntries: 1, rateLimitKeys: 1 });
      for (const database of [firstTenant.dbName, second.dbName, orphanDb])
        expect(await exists(database)).toBe(false);
      for (const name of [firstTenant.dbUser, second.dbUser]) expect(await userExists(name)).toBe(false);
      expect(await readdir(config.storage.localDir)).toEqual([]);
      expect(await redis.exists(`${rateLimitPrefix}:login:first@example.com`)).toBe(0);
      // Keys that are not sign-in counters are not touched.
      expect(await redis.exists(`${config.database.tenantPrefix}other:keep`)).toBe(1);

      // The platform is empty, its audit chain is valid, and it works: the same
      // person can sign up again and is the platform owner once more.
      const fresh = createCore(config);
      try {
        await fresh.init();
        expect(await fresh.platform.db.select().from(users)).toEqual([]);
        expect(await fresh.tenants.list()).toEqual([]);
        expect(await fresh.audit.verify(fresh.platform.db)).toEqual({
          ok: true,
          entries: 0,
          brokenAtSeq: null,
        });

        const again = await fresh.auth.signup(signupInput, meta);
        expect(again.session.user.isPlatformAdmin).toBe(true);
        for (const tenant of await fresh.tenants.list()) await fresh.tenants.destroy(tenant);
      } finally {
        await fresh.close();
      }
    } finally {
      await redis.del(`${config.database.tenantPrefix}other:keep`).catch(() => {});
      redis.disconnect();
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(orphanDb)}`).catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(platformDb)}`).catch(() => {});
      await admin.end();
      await rm(config.storage.localDir, { recursive: true, force: true });
    }
  });
});
