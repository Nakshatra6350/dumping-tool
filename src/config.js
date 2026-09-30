const path = require("path");
require("dotenv").config({ quiet: true });

const env = process.env.NODE_ENV || "development";
const isProd = env === "production";
const port = Number(process.env.PORT) || 8080;

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

// Secrets are mandatory in production. In development we fall back to fixed
// values so the app boots with zero configuration.
const secret = (name, devFallback) => {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  console.warn(`[config] ${name} is not set, using an insecure development value`);
  return devFallback;
};

const config = {
  env,
  isProd,
  port,
  // RENDER_EXTERNAL_URL is injected automatically on Render.
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dumping_tool",
  jwtSecret: secret("JWT_SECRET", "dev-only-jwt-secret-change-me"),
  encryptionKey: secret("ENCRYPTION_KEY", "dev-only-encryption-key-change-me"),
  sessionDays: int(process.env.SESSION_DAYS, 7),
  timezone: process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",

  admin: {
    email: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "",
    name: process.env.ADMIN_NAME || "Administrator",
  },

  storage: {
    driver: (process.env.STORAGE_DRIVER || "local").toLowerCase(),
    localDir: path.resolve(process.env.STORAGE_LOCAL_DIR || "./data/dumps"),
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || "auto",
      bucket: process.env.S3_BUCKET || "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
      prefix: (process.env.S3_PREFIX || "dumps").replace(/^\/+|\/+$/g, ""),
    },
  },

  email: {
    provider: (process.env.EMAIL_PROVIDER || "console").toLowerCase(),
    from: process.env.EMAIL_FROM || "",
    fromName: process.env.EMAIL_FROM_NAME || "Dumping Tool",
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: int(process.env.SMTP_PORT, 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
    brevoApiKey: process.env.BREVO_API_KEY || "",
    resendApiKey: process.env.RESEND_API_KEY || "",
  },

  dump: {
    maxConcurrent: int(process.env.MAX_CONCURRENT_DUMPS, 2),
    timeoutMinutes: int(process.env.DUMP_TIMEOUT_MINUTES, 120),
    defaultRetention: int(process.env.DEFAULT_RETENTION, 7),
    pgDumpPath: process.env.PG_DUMP_PATH || "",
    mysqldumpPath: process.env.MYSQLDUMP_PATH || "",
    tmpDir: path.resolve(process.env.DUMP_TMP_DIR || "./data/tmp"),
  },

  schedulerIntervalMs: int(process.env.SCHEDULER_INTERVAL_SECONDS, 20) * 1000,
};

module.exports = config;
