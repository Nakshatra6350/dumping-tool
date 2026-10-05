import { loadConfig } from "../config";
import { assertSafeToReset, resetDevelopmentData } from "../dev/reset";
import { parseMysqlUrl } from "../db/mysql";

/**
 * Wipes local development data and starts again from an empty platform:
 *
 *   pnpm db:reset
 *
 * The next account to sign up becomes the platform owner. It refuses to run in
 * production or against a database that is not on this machine.
 */
const main = async () => {
  const config = { ...loadConfig(), logLevel: "warn" };
  assertSafeToReset(config);

  const { host, port, database } = parseMysqlUrl(config.database.url);
  console.log(`Resetting DBRB development data on ${host}:${port} (${database})...`);

  const summary = await resetDevelopmentData(config);

  console.log(
    [
      "",
      "Done. Removed:",
      `  workspace databases   ${summary.tenantDatabases}`,
      `  MySQL users           ${summary.mysqlUsers}`,
      `  local storage items   ${summary.storageEntries}`,
      `  sign-in counters      ${summary.rateLimitKeys}`,
      "",
      "The platform database is empty and up to date.",
      "The next account to sign up becomes the platform owner.",
      "If `pnpm dev` is running, restart it: it is still connected to the old databases.",
      "",
    ].join("\n"),
  );
};

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
