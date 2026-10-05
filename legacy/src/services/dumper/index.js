const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const config = require("../../config");
const { findBinary } = require("./binaries");

const STDERR_LIMIT = 8 * 1024;

// Values are passed as `--flag=value` and positional names are validated so a
// user-supplied value can never be interpreted as an extra CLI option.
const assertSafe = (label, value) => {
  if (!value || String(value).startsWith("-") || /[\0\r\n]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
};

// MySQL option files support double-quoted values with backslash escapes.
const optionValue = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const buildPostgres = (conn, tool) => ({
  args: [
    `--host=${conn.host}`,
    `--port=${conn.port}`,
    `--username=${conn.username}`,
    `--dbname=${conn.database}`,
    "--format=plain",
    "--encoding=UTF8",
    "--no-owner",
    "--no-privileges",
    "--no-password",
  ],
  env: {
    PGPASSWORD: conn.password || "",
    PGSSLMODE: conn.ssl ? "require" : "prefer",
    PGCONNECT_TIMEOUT: "15",
  },
  tool,
});

const buildMysql = async (conn, tool, tmpDir) => {
  // Password goes in a private option file instead of argv/env.
  const optionsFile = path.join(tmpDir, `my-${crypto.randomUUID()}.cnf`);
  await fs.promises.writeFile(
    optionsFile,
    `[client]\nuser=${optionValue(conn.username)}\npassword=${optionValue(conn.password || "")}\n`,
    { mode: 0o600 }
  );
  const args = [
    `--defaults-extra-file=${optionsFile}`,
    `--host=${conn.host}`,
    `--port=${conn.port}`,
    "--protocol=TCP",
    "--single-transaction",
    "--quick",
    "--routines",
    "--triggers",
    "--no-tablespaces",
  ];
  if (tool.flavor === "mariadb") {
    if (conn.ssl) args.push("--ssl", "--skip-ssl-verify-server-cert");
  } else {
    args.push("--column-statistics=0", "--set-gtid-purged=OFF");
    if (conn.ssl) args.push("--ssl-mode=REQUIRED");
  }
  args.push("--databases", conn.database);
  return { args, env: {}, tool, cleanup: () => fs.promises.rm(optionsFile, { force: true }) };
};

/**
 * Runs pg_dump / mysqldump and streams the output through gzip into outFile.
 * Resolves with { sizeBytes, sha256, tool }.
 */
const runDump = async ({ dbType, connection, outFile }) => {
  assertSafe("host", connection.host);
  assertSafe("username", connection.username);
  assertSafe("database name", connection.database);

  const tool = await findBinary(dbType);
  if (!tool) {
    throw new Error(
      dbType === "postgres"
        ? "pg_dump was not found on this server. Install the PostgreSQL client tools or set PG_DUMP_PATH."
        : "mysqldump was not found on this server. Install the MySQL/MariaDB client tools or set MYSQLDUMP_PATH."
    );
  }

  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  const spec =
    dbType === "postgres"
      ? buildPostgres(connection, tool)
      : await buildMysql(connection, tool, path.dirname(outFile));

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(spec.tool.bin, spec.args, {
        env: { ...process.env, ...spec.env },
        windowsHide: true,
      });
      const gzip = zlib.createGzip({ level: 6 });
      const out = fs.createWriteStream(outFile);
      const hash = crypto.createHash("sha256");
      let size = 0;
      let stderr = "";
      let exitCode = null;
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        out.destroy();
        reject(err);
      };

      const timer = setTimeout(
        () => fail(new Error(`Dump timed out after ${config.dump.timeoutMinutes} minutes`)),
        config.dump.timeoutMinutes * 60 * 1000
      );

      gzip.on("data", (chunk) => {
        size += chunk.length;
        hash.update(chunk);
      });

      child.stderr.on("data", (d) => {
        if (stderr.length < STDERR_LIMIT) stderr += d.toString();
      });
      child.on("error", fail);
      child.on("close", (code) => {
        exitCode = code;
      });
      gzip.on("error", fail);
      out.on("error", fail);

      child.stdout.pipe(gzip).pipe(out);

      out.on("finish", () => {
        // `close` on the child may fire slightly after the stream ends.
        const done = () => {
          if (settled) return;
          if (exitCode !== 0) {
            fail(new Error(cleanStderr(stderr) || `${path.basename(spec.tool.bin)} exited with code ${exitCode}`));
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve({ sizeBytes: size, sha256: hash.digest("hex"), tool: spec.tool.version });
        };
        if (exitCode === null) child.once("close", done);
        else done();
      });
    });
  } catch (err) {
    await fs.promises.rm(outFile, { force: true });
    throw err;
  } finally {
    await spec.cleanup?.();
  }
};

const cleanStderr = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/using a password on the command line/i.test(l))
    .join("\n")
    .slice(0, 2000);

module.exports = { runDump };
