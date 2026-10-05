import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { S3TargetInput } from "@dbrb/shared";
import mysql from "mysql2/promise";
import type { Actor } from "../audit/service";
import { loadConfig, type AppConfig } from "../config";
import { createCore, type Core } from "../core";
import { randomToken } from "../crypto/tokens";
import { parseMysqlUrl, quoteIdentifier } from "../db/mysql";
import { DEV_S3 } from "./devS3";

/**
 * Test harness: a complete Core running against the real local services
 * (MySQL, S3) but in its own throwaway platform database, with its own tenant
 * database prefix and storage directory. Nothing touches development data, and
 * `cleanup()` removes everything it created.
 */
export interface TestCore {
  core: Core;
  config: AppConfig;
  cleanup(): Promise<void>;
}

export const createTestCore = async (overrides: Partial<AppConfig> = {}): Promise<TestCore> => {
  const suffix = randomToken(5)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "x");
  const base = loadConfig({ NODE_ENV: "test" });
  const url = new URL(base.database.url);
  const platformDb = `dbrb_test_${suffix}`;
  url.pathname = `/${platformDb}`;
  const localDir = path.join(os.tmpdir(), `dbrb-test-${suffix}`);

  const config: AppConfig = {
    ...base,
    database: { url: url.toString(), adminUrl: base.database.adminUrl, tenantPrefix: `dbrbtest_${suffix}_` },
    storage: { localDir },
    // Tests never send real mail, whatever the developer's .env says.
    mail: { ...base.mail, driver: "console" },
    autoMigrate: true,
    logLevel: "silent",
    allowPrivateNetworkTargets: true,
    ...overrides,
  };

  const core = createCore(config);
  await core.init();

  return {
    core,
    config,
    async cleanup() {
      for (const tenant of await core.tenants.list()) await core.tenants.destroy(tenant);
      await core.close();
      const { host, port, user, password } = parseMysqlUrl(config.database.adminUrl);
      const admin = await mysql.createConnection({ host, port, user, password });
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(platformDb)}`);
      await admin.end();
      await rm(localDir, { recursive: true, force: true });
    },
  };
};

export const testActor = (label = "tester@example.com"): Actor => ({
  type: "user",
  id: null,
  label,
  ip: "127.0.0.1",
});

/** S3 details for the local development server, as an admin would type them into the panel. */
export const devS3Input = (bucket: string, extra: Partial<S3TargetInput> = {}): S3TargetInput => ({
  bucket,
  region: DEV_S3.region,
  endpoint: DEV_S3.endpoint,
  forcePathStyle: true,
  prefix: "",
  accessKeyId: DEV_S3.accessKeyId,
  secretAccessKey: DEV_S3.secretAccessKey,
  ...extra,
});
