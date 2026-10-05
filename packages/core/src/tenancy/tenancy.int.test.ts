import { sql } from "drizzle-orm";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settings } from "../db/common";
import { mysqlErrorCode, parseMysqlUrl, type Db } from "../db/mysql";
import { createTestCore, type TestCore } from "../testing/harness";

let t: TestCore;

/** Runs a raw statement and reports MySQL's verdict. */
const attempt = async (db: Db, statement: string): Promise<string> => {
  try {
    await db.execute(sql.raw(statement));
    return "allowed";
  } catch (err) {
    return mysqlErrorCode(err) ?? "unknown error";
  }
};
const DENIED = ["ER_TABLEACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR"];

beforeAll(async () => {
  t = await createTestCore();
});

afterAll(async () => {
  await t.cleanup();
});

describe("tenant provisioning", () => {
  it("gives every tenant its own database, its own MySQL user and its own data key", async () => {
    const a = await t.core.tenants.provision({ name: "Acme Corp" });
    const b = await t.core.tenants.provision({ name: "Acme Corp" });

    expect(a.status).toBe("active");
    expect(a.dbName).not.toBe(b.dbName);
    expect(a.dbUser).not.toBe(b.dbUser);
    expect(a.dbName.startsWith(t.config.database.tenantPrefix)).toBe(true);
    expect(a.dbUser.length).toBeLessThanOrEqual(32);
    // Same display name, different slugs.
    expect(a.slug).toBe("acme-corp");
    expect(b.slug).not.toBe(a.slug);

    // Secrets are stored wrapped, never in the clear.
    expect(a.dbPasswordEnc.startsWith("v1.")).toBe(true);
    const keyA = await t.core.tenants.dataKey(a);
    const keyB = await t.core.tenants.dataKey(b);
    expect(keyA).toHaveLength(32);
    expect(keyA.equals(keyB)).toBe(false);
  });

  it("applies the tenant schema and starts an empty, valid audit chain", async () => {
    const tenant = await t.core.tenants.provision({ name: "Schema Check" });
    const db = await t.core.tenants.db(tenant);
    const [rows] = (await db.execute(sql`SHOW TABLES`)) as unknown as [Array<Record<string, string>>];
    const tables = rows.map((r) => Object.values(r)[0]);
    expect(tables).toEqual(
      expect.arrayContaining(["audit_log", "audit_heads", "settings", "storage_targets"]),
    );
    expect(await t.core.audit.verify(db)).toEqual({ ok: true, entries: 0, brokenAtSeq: null });
  });
});

describe("tenant isolation", () => {
  it("a tenant's database credentials cannot read or write another tenant's database", async () => {
    const a = await t.core.tenants.provision({ name: "Tenant A" });
    const b = await t.core.tenants.provision({ name: "Tenant B" });

    const dbB = await t.core.tenants.db(b);
    await dbB.insert(settings).values({ key: "secret.of.b", value: "only for B" });

    // Tenant A's own handle works on its own database...
    const dbA = await t.core.tenants.db(a);
    expect(await dbA.select().from(settings)).toEqual([]);

    // ...but MySQL itself refuses it access to B's database, whatever the query.
    expect(DENIED).toContain(await attempt(dbA, `SELECT * FROM \`${b.dbName}\`.settings`));
    expect(DENIED).toContain(
      await attempt(dbA, `INSERT INTO \`${b.dbName}\`.settings (\`key\`, value) VALUES ('x', '1')`),
    );
    expect(DENIED).toContain(await attempt(dbA, `DROP TABLE \`${b.dbName}\`.settings`));
    expect(DENIED).toContain(await attempt(dbA, `USE \`${b.dbName}\``));
    // Sanity check: the same kind of statement against its own database is allowed.
    expect(await attempt(dbA, `SELECT * FROM \`${a.dbName}\`.settings`)).toBe("allowed");

    // Nor can it see the platform database, MySQL's own user table, or other tenants' databases.
    const platformDb = parseMysqlUrl(t.config.database.url).database!;
    expect(DENIED).toContain(await attempt(dbA, `SELECT * FROM \`${platformDb}\`.tenants`));
    expect(DENIED).toContain(await attempt(dbA, `SELECT * FROM mysql.user`));
    const [visible] = (await dbA.execute(sql`SHOW DATABASES`)) as unknown as [Array<{ Database: string }>];
    const names = visible.map((r) => r.Database);
    expect(names).toContain(a.dbName);
    expect(names).not.toContain(b.dbName);
    expect(names).not.toContain(platformDb);
  });

  it("the grant does not treat underscores in the database name as wildcards", async () => {
    const a = await t.core.tenants.provision({ name: "Wildcard Check" });
    const { host, port, user, password } = parseMysqlUrl(t.config.database.adminUrl);
    const admin = await mysql.createConnection({ host, port, user, password });
    try {
      const [grants] = await admin.query<mysql.RowDataPacket[]>(`SHOW GRANTS FOR ?@'%'`, [a.dbUser]);
      const text = grants.map((g) => Object.values(g)[0]).join("\n");
      expect(text).toContain(a.dbName.replace(/_/g, "\\_"));
    } finally {
      await admin.end();
    }
  });
});

describe("tenant deletion", () => {
  it("drops the database and the MySQL user, and removes the registry row", async () => {
    const tenant = await t.core.tenants.provision({ name: "Short Lived" });
    await t.core.tenants.destroy(tenant);

    expect(await t.core.tenants.findById(tenant.id)).toBeNull();
    const { host, port, user, password } = parseMysqlUrl(t.config.database.adminUrl);
    const admin = await mysql.createConnection({ host, port, user, password });
    try {
      const [dbs] = await admin.query<mysql.RowDataPacket[]>(`SHOW DATABASES LIKE ?`, [
        tenant.dbName.replace(/_/g, "\\_"),
      ]);
      expect(dbs).toHaveLength(0);
      const [users] = await admin.query<mysql.RowDataPacket[]>(`SELECT user FROM mysql.user WHERE user = ?`, [
        tenant.dbUser,
      ]);
      expect(users).toHaveLength(0);
    } finally {
      await admin.end();
    }
  });
});
