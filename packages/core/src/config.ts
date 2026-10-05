import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Infrastructure configuration, read from the environment once at startup.
 *
 * Only things the server needs in order to boot live here: where the database
 * and Redis are, the encryption keys, ports. Product behaviour (storage mode,
 * S3 buckets, sign-ups...) is NOT configured here: it lives in the database
 * and is changed from the admin panel (see settings/ and storage/).
 */

/** Redis key prefix of the request rate limiters (sign-in attempts and the like). */
export const RATE_LIMIT_KEY_PREFIX = "dbrb:rl";

const DEV_MASTER_KEY = "dbrb-development-master-key-do-not-use-in-production";
const DEV_SIGNING_KEY = "dbrb-development-signing-key-do-not-use-in-production";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Public URL of the web app (used in emails and CORS/CSRF checks). */
  APP_URL: z.url().default("http://localhost:5173"),
  /** Public URL of this API (used for signed local download links). */
  API_URL: z.url().default("http://localhost:4000"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  /** Platform database. The user needs CREATE DATABASE / CREATE USER to provision tenants. */
  DATABASE_URL: z.string().default("mysql://root:dbrb_dev_root@127.0.0.1:3310/dbrb_platform"),
  /** Optional separate, more privileged connection used only for provisioning tenants. */
  DATABASE_ADMIN_URL: z.string().optional(),
  /** Each tenant gets its own database named <prefix><tenant id>. */
  TENANT_DB_PREFIX: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,23}$/, "lowercase letters, digits and underscores only")
    .default("dbrb_t_"),

  REDIS_URL: z.string().default("redis://127.0.0.1:6380"),

  /** Root of all encryption (wraps tenant data keys and platform secrets). */
  MASTER_KEY: z.string().min(32).optional(),
  /** Signs session-independent links such as local download URLs. */
  SIGNING_KEY: z.string().min(32).optional(),

  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  /** Directory used by the "local disk" storage mode. Relative paths resolve from the repo root. */
  STORAGE_LOCAL_DIR: z.string().default("./data/storage"),

  /**
   * Whether tenant-supplied hosts (S3 endpoints, later database hosts) may point at
   * private or loopback addresses. Must stay off for a hosted, multi-tenant deployment
   * (it prevents server-side request forgery); on for local development and self-hosting.
   */
  ALLOW_PRIVATE_NETWORK_TARGETS: z.stringbool().optional(),

  MAIL_DRIVER: z.enum(["console", "smtp"]).default("console"),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM: z.string().default("DBRB <no-reply@dbrb.local>"),

  /** Comma-separated emails that are platform owners. The very first account always is. */
  PLATFORM_ADMIN_EMAILS: z.string().default(""),

  /** Apply database migrations on startup. Defaults to on outside production. */
  AUTO_MIGRATE: z.stringbool().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  /** scrypt work factor as a power of two. 17 follows OWASP; tests use a lower value for speed. */
  PASSWORD_HASH_COST: z.coerce.number().int().min(10).max(20).optional(),
});

export interface AppConfig {
  env: "development" | "test" | "production";
  isProduction: boolean;
  /** Repository (or deployment) root; relative paths resolve from here. */
  rootDir: string;
  appUrl: string;
  apiUrl: string;
  apiPort: number;
  database: {
    url: string;
    adminUrl: string;
    tenantPrefix: string;
  };
  redisUrl: string;
  masterKey: string;
  signingKey: string;
  sessionTtlDays: number;
  storage: {
    localDir: string;
  };
  allowPrivateNetworkTargets: boolean;
  mail: {
    driver: "console" | "smtp";
    from: string;
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  };
  platformAdminEmails: string[];
  autoMigrate: boolean;
  logLevel: string;
  passwordHashCost: number;
}

/** Walks up from `from` to the directory that contains pnpm-workspace.yaml. */
export const findWorkspaceRoot = (from: string = process.cwd()): string => {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
};

export const loadConfig = (overrides: Record<string, string | undefined> = {}): AppConfig => {
  const rootDir = findWorkspaceRoot();
  loadDotenv({ path: path.join(rootDir, ".env"), quiet: true });

  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";

  if (isProduction && (!env.MASTER_KEY || !env.SIGNING_KEY)) {
    throw new Error("MASTER_KEY and SIGNING_KEY are required in production (32+ characters each)");
  }

  return {
    env: env.NODE_ENV,
    isProduction,
    rootDir,
    appUrl: env.APP_URL.replace(/\/+$/, ""),
    apiUrl: env.API_URL.replace(/\/+$/, ""),
    apiPort: env.API_PORT,
    database: {
      url: env.DATABASE_URL,
      adminUrl: env.DATABASE_ADMIN_URL ?? env.DATABASE_URL,
      tenantPrefix: env.TENANT_DB_PREFIX,
    },
    redisUrl: env.REDIS_URL,
    masterKey: env.MASTER_KEY ?? DEV_MASTER_KEY,
    signingKey: env.SIGNING_KEY ?? DEV_SIGNING_KEY,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    storage: {
      localDir: path.resolve(rootDir, env.STORAGE_LOCAL_DIR),
    },
    allowPrivateNetworkTargets: env.ALLOW_PRIVATE_NETWORK_TARGETS ?? !isProduction,
    mail: {
      driver: env.MAIL_DRIVER,
      from: env.MAIL_FROM,
      smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    },
    platformAdminEmails: env.PLATFORM_ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    autoMigrate: env.AUTO_MIGRATE ?? !isProduction,
    logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === "test" ? "silent" : isProduction ? "info" : "debug"),
    passwordHashCost: env.PASSWORD_HASH_COST ?? (env.NODE_ENV === "test" ? 12 : 17),
  };
};
