const { spawn } = require("child_process");
const config = require("../../config");

const CANDIDATES = {
  postgres: () => [config.dump.pgDumpPath, "pg_dump"].filter(Boolean),
  mysql: () => [config.dump.mysqldumpPath, "mysqldump", "mariadb-dump"].filter(Boolean),
};

const cache = new Map();

const probe = (bin) =>
  new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(bin, ["--version"], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
  });

// Locates the dump binary for a database type and reports its version/flavor.
const findBinary = async (dbType) => {
  if (cache.has(dbType)) return cache.get(dbType);
  let found = null;
  for (const bin of CANDIDATES[dbType]()) {
    const version = await probe(bin);
    if (version) {
      found = { bin, version, flavor: /mariadb/i.test(version) ? "mariadb" : dbType };
      break;
    }
  }
  if (found) cache.set(dbType, found);
  return found;
};

const toolStatus = async () => ({
  postgres: await findBinary("postgres"),
  mysql: await findBinary("mysql"),
});

module.exports = { findBinary, toolStatus };
