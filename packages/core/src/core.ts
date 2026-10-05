import { mkdir } from "node:fs/promises";
import { Redis } from "ioredis";
import { AuditService } from "./audit/service";
import { AuthService } from "./auth/service";
import { loadConfig, type AppConfig } from "./config";
import { LocalKeyProvider, type KeyProvider } from "./crypto/keys";
import { migratePlatform, type DbHandle } from "./db/mysql";
import { createLogger, type Logger } from "./logger";
import { Mailer } from "./mail/mailer";
import { SettingsService } from "./settings/service";
import { StorageService } from "./storage/service";
import { TenantConnections } from "./tenancy/connections";
import { TenantService, createPlatformHandle, ensurePlatformDatabase } from "./tenancy/tenants";

/**
 * Every server-side service, wired together once. The API (and, from milestone
 * 2, the workers) build one Core at startup and share it.
 */
export interface Core {
  config: AppConfig;
  log: Logger;
  platform: DbHandle;
  keys: KeyProvider;
  tenants: TenantService;
  audit: AuditService;
  settings: SettingsService;
  storage: StorageService;
  mailer: Mailer;
  auth: AuthService;
  /** Shared Redis connection, opened on first use. */
  redis(): Redis;
  /** Prepares the databases (migrations when enabled) and local storage. Call once at startup. */
  init(): Promise<void>;
  close(): Promise<void>;
}

export const createCore = (config: AppConfig = loadConfig()): Core => {
  const log = createLogger(config);
  const keys = new LocalKeyProvider(config.masterKey);
  const platform = createPlatformHandle(config);
  const connections = new TenantConnections(config, keys);
  const tenants = new TenantService(config, platform.db, connections, keys, log);
  const audit = new AuditService();
  const settings = new SettingsService(platform.db, tenants, audit);
  const storage = new StorageService({ config, platform: platform.db, tenants, keys, settings, audit });
  const mailer = new Mailer(config.mail, log);
  const auth = new AuthService({ config, platform: platform.db, tenants, audit, settings, mailer, log });

  let redis: Redis | null = null;

  return {
    config,
    log,
    platform,
    keys,
    tenants,
    audit,
    settings,
    storage,
    mailer,
    auth,

    redis() {
      if (!redis) {
        redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: true });
        redis.on("error", (err) => log.warn({ err: err.message }, "redis error"));
      }
      return redis;
    },

    async init() {
      if (config.autoMigrate) {
        await ensurePlatformDatabase(config);
        await migratePlatform(platform.db);
      }
      await audit.ensureHead(platform.db);
      await mkdir(config.storage.localDir, { recursive: true });
      if (config.autoMigrate) {
        const result = await tenants.migrateAll();
        if (result.failed.length)
          log.error({ failed: result.failed }, "some tenant databases failed to migrate");
        else log.debug({ tenants: result.migrated }, "tenant databases are up to date");
      }
    },

    async close() {
      storage.close();
      mailer.close();
      await connections.closeAll();
      await platform.pool.end().catch(() => {});
      if (redis) {
        redis.disconnect();
        redis = null;
      }
    },
  };
};
