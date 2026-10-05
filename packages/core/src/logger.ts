import { pino, type Logger } from "pino";
import type { AppConfig } from "./config";

export type { Logger };

/** Keys that must never reach the logs, wherever they appear in a logged object. */
const REDACT = [
  "password",
  "*.password",
  "secretAccessKey",
  "*.secretAccessKey",
  "accessKeyId",
  "*.accessKeyId",
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
];

export const createLogger = (config: Pick<AppConfig, "env" | "logLevel">): Logger =>
  pino({
    level: config.logLevel,
    redact: { paths: REDACT, censor: "[redacted]" },
    base: undefined,
    transport:
      config.env === "development"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          }
        : undefined,
  });
