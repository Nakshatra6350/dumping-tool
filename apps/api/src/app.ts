import { existsSync } from "node:fs";
import path from "node:path";
import { RATE_LIMIT_KEY_PREFIX, attachmentDisposition, notFound, type Core } from "@dbrb/core";
import express, { type Express } from "express";
import helmet from "helmet";
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from "rate-limiter-flexible";
import {
  errorHandler,
  loadSession,
  notFoundHandler,
  originCheck,
  rateLimit,
  requestContext,
  requireSession,
} from "./http/middleware";
import { authRoutes } from "./routes/auth";
import { platformRoutes } from "./routes/platform";
import { workspaceRoutes } from "./routes/workspace";

export interface Limiters {
  login: RateLimiterAbstract | null;
  signup: RateLimiterAbstract | null;
  storageCheck: RateLimiterAbstract | null;
  download: RateLimiterAbstract | null;
}

export interface AppOptions {
  /** Tests switch rate limiting off; production must leave it on. */
  rateLimits?: boolean;
  /** Namespace for rate-limit counters in Redis. */
  rateLimitPrefix?: string;
}

/**
 * Rate limits are kept in Redis so they hold across several API servers.
 * If Redis is unreachable, an in-memory limiter takes over instead of failing open.
 */
const createLimiters = (core: Core, enabled: boolean, prefix: string): Limiters => {
  if (!enabled) return { login: null, signup: null, storageCheck: null, download: null };
  const limiter = (keyPrefix: string, points: number, duration: number) =>
    new RateLimiterRedis({
      storeClient: core.redis(),
      keyPrefix: `${prefix}:${keyPrefix}`,
      points,
      duration,
      insuranceLimiter: new RateLimiterMemory({ points, duration }),
    });
  return {
    login: limiter("login", 10, 15 * 60),
    signup: limiter("signup", 5, 60 * 60),
    storageCheck: limiter("storage", 20, 10 * 60),
    download: limiter("download", 120, 60),
  };
};

export const createApp = (core: Core, options: AppOptions = {}): Express => {
  const limiters = createLimiters(
    core,
    options.rateLimits ?? true,
    options.rateLimitPrefix ?? RATE_LIMIT_KEY_PREFIX,
  );
  const app = express();

  app.disable("x-powered-by");
  // Behind a load balancer in production; the first proxy hop is trusted for the client IP.
  app.set("trust proxy", core.config.isProduction ? 1 : "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          // Everything, fonts included, is served by DBRB itself: no third party sees a visit.
          "style-src": ["'self'", "'unsafe-inline'"],
          "font-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "upgrade-insecure-requests": core.config.isProduction ? [] : null,
        },
      },
    }),
  );
  app.use(requestContext);

  // -- Health (no auth; used by load balancers) --------------------------------
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/readyz", async (_req, res) => {
    try {
      await core.platform.pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // -- Signed downloads from local-disk storage --------------------------------
  // The signature in the link is the authorisation, exactly like an S3 presigned
  // URL, so this route needs no session.
  app.get(
    "/api/v1/storage/local/:token",
    rateLimit(limiters.download, (req) => req.ip ?? "unknown"),
    async (req, res) => {
      const claims = core.storage.signer.verify(String(req.params.token));
      if (!claims) throw notFound("Download link (it may have expired)");
      let file;
      try {
        file = await core.storage.local.read(claims.key);
      } catch {
        throw notFound("File");
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", attachmentDisposition(claims.fileName));
      res.setHeader("Cache-Control", "private, no-store");
      if (file.size !== null) res.setHeader("Content-Length", String(file.size));
      file.stream.on("error", () => res.destroy());
      file.stream.pipe(res);
    },
  );

  // -- JSON API ----------------------------------------------------------------
  const api = express.Router();
  api.use(express.json({ limit: "100kb" }));
  api.use(originCheck(core));
  api.use(loadSession(core));

  api.use("/auth", authRoutes(core, limiters));
  api.use("/platform", platformRoutes(core, limiters));
  api.use("/", requireSession, workspaceRoutes(core, limiters));
  api.use(notFoundHandler);
  app.use("/api/v1", api);

  // -- The built web app, when it has been built (single-container deployments) --
  const webDist = path.join(core.config.rootDir, "apps", "web", "dist");
  if (existsSync(path.join(webDist, "index.html"))) {
    app.use(express.static(webDist, { maxAge: core.config.isProduction ? "1h" : 0 }));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use(errorHandler(core));
  return app;
};
