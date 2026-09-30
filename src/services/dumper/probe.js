const { Client } = require("pg");
const mysql = require("mysql2/promise");

const PG_SYSTEM = new Set(["template0", "template1"]);
const MYSQL_SYSTEM = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

// Connects with the supplied details and returns the server version plus the
// list of databases the user can see (used by the "select database" dropdown).
const testConnection = async (dbType, conn) => {
  if (dbType === "postgres") {
    const client = new Client({
      host: conn.host,
      port: conn.port,
      user: conn.username,
      password: conn.password || undefined,
      database: conn.database || "postgres",
      ssl: conn.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
      statement_timeout: 10000,
    });
    await client.connect();
    try {
      const { rows: v } = await client.query("SHOW server_version");
      const { rows } = await client.query(
        "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname"
      );
      return {
        version: `PostgreSQL ${v[0].server_version}`,
        databases: rows.map((r) => r.datname).filter((d) => !PG_SYSTEM.has(d)),
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  const connection = await mysql.createConnection({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password: conn.password || undefined,
    database: conn.database || undefined,
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10000,
  });
  try {
    const [[v]] = await connection.query("SELECT VERSION() AS version");
    const [rows] = await connection.query("SHOW DATABASES");
    return {
      version: /mariadb/i.test(v.version) ? `MariaDB ${v.version}` : `MySQL ${v.version}`,
      databases: rows.map((r) => r.Database).filter((d) => !MYSQL_SYSTEM.has(d)),
    };
  } finally {
    await connection.end().catch(() => {});
  }
};

module.exports = { testConnection };
