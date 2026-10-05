const { z } = require("zod");
const config = require("../config");

const DEFAULT_PORTS = { postgres: 5432, mysql: 3306 };

const hostRe = /^[A-Za-z0-9]([A-Za-z0-9.\-_]*[A-Za-z0-9])?$|^\[[0-9a-fA-F:]+\]$/;
const noLeadingDash = (v) => !v.startsWith("-");

const email = z.string().trim().toLowerCase().email();

const connectionFields = z.object({
  host: z.string().trim().min(1, "is required").max(255).regex(hostRe, "is not a valid hostname"),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1, "is required").max(128).refine(noLeadingDash, "is invalid"),
  password: z.string().max(1024).optional(),
  database: z.string().trim().max(128).refine((v) => !v || noLeadingDash(v), "is invalid").optional().default(""),
  ssl: z.boolean().optional().default(false),
});

// Accepts either discrete fields or a single connection URI
// (postgres://user:pass@host:5432/db?sslmode=require, mysql://...).
const connectionInput = z
  .union([z.object({ uri: z.string().trim().min(1) }), connectionFields])
  .transform((value, ctx) => {
    if (!("uri" in value)) return value;
    let url;
    try {
      url = new URL(value.uri);
    } catch {
      ctx.addIssue({ code: "custom", message: "Connection URI is not valid" });
      return z.NEVER;
    }
    const ssl =
      ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode")) ||
      url.searchParams.get("ssl") === "true" ||
      url.searchParams.has("ssl-mode");
    const parsed = connectionFields.safeParse({
      host: url.hostname,
      port: url.port || undefined,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
      ssl,
    });
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `Connection URI ${parsed.error.issues[0].path.join(".")} ${parsed.error.issues[0].message}` });
      return z.NEVER;
    }
    return parsed.data;
  });

const dbType = z.enum(["postgres", "mysql"]);

const schedule = z.object({
  type: z.enum(["manual", "once", "daily", "weekly", "cron"]),
  runAt: z.coerce.date().optional(),
  time: z.string().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  cron: z.string().max(120).optional(),
  timezone: z
    .string()
    .optional()
    .default(config.timezone)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "is not a valid IANA timezone"),
});

const jobInput = z.object({
  name: z.string().trim().min(1, "is required").max(80),
  dbType,
  connection: connectionInput,
  schedule,
  notifyEmails: z.array(email).max(10).optional().default([]),
  notifyOn: z.enum(["always", "failure", "never"]).optional().default("always"),
  retention: z.coerce.number().int().min(1).max(365).optional().default(config.dump.defaultRetention),
  enabled: z.boolean().optional().default(true),
  runNow: z.boolean().optional().default(false),
});

const testConnectionInput = z.object({
  dbType,
  connection: connectionInput,
  jobId: z.string().optional(),
});

const password = z.string().min(8, "must be at least 8 characters").max(200);

const userInput = z.object({
  email,
  name: z.string().trim().min(1).max(80),
  password,
  role: z.enum(["admin", "user"]).optional().default("user"),
});

module.exports = {
  DEFAULT_PORTS,
  jobInput,
  testConnectionInput,
  userInput,
  loginInput: z.object({ email, password: z.string().min(1) }),
  passwordChangeInput: z.object({ currentPassword: z.string().min(1), newPassword: password }),
  passwordResetInput: z.object({ password }),
};
