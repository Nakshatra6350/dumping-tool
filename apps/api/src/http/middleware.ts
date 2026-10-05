import { randomUUID } from "node:crypto";
import {
  AppError,
  forbidden,
  tooManyRequests,
  unauthorized,
  type Core,
  type RequestMeta,
  type SessionContext,
} from "@dbrb/core";
import { roleHas, type ApiErrorBody, type Permission } from "@dbrb/shared";
import { parseCookie } from "cookie";
import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { RateLimiterRes, type RateLimiterAbstract } from "rate-limiter-flexible";
import type { z } from "zod";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Unique per request; returned as X-Request-Id and copied onto audit entries. */
      id: string;
      meta: RequestMeta;
      /** Set when the request carries a valid session cookie. */
      session?: SessionContext;
    }
  }
}

export const SESSION_COOKIE = "dbrb_session";

/** Tags every request with an id and where it came from. */
export const requestContext: RequestHandler = (req, res, next) => {
  req.id = randomUUID();
  req.meta = { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null, requestId: req.id };
  res.setHeader("X-Request-Id", req.id);
  next();
};

/**
 * Cross-site request forgery defence. Browsers attach an Origin header to
 * state-changing requests; one coming from any other site is refused. Requests
 * with no Origin (scripts, tests) carry no ambient cookies from a victim's
 * browser, so they are not a forgery risk.
 */
export const originCheck = (core: Core): RequestHandler => {
  const allowed = new Set([new URL(core.config.appUrl).origin, new URL(core.config.apiUrl).origin]);
  const isLocal = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (!origin || allowed.has(origin) || (!core.config.isProduction && isLocal(origin))) return next();
    next(forbidden("bad_origin", "This request did not come from the DBRB app"));
  };
};

/** Resolves the session cookie, if any. Never fails the request by itself. */
export const loadSession =
  (core: Core): RequestHandler =>
  async (req, _res, next) => {
    const token = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
    if (token) req.session = (await core.auth.resolve(token)) ?? undefined;
    next();
  };

export const setSessionCookie = (core: Core, res: Response, token: string): void => {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: core.config.appUrl.startsWith("https://"),
    maxAge: core.config.sessionTtlDays * 86_400_000,
    path: "/",
  });
};

export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
};

export const sessionToken = (req: Request): string | undefined =>
  parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];

/** The authenticated session, for handlers behind `requireSession`. */
export const sessionOf = (req: Request): SessionContext => {
  if (!req.session) throw unauthorized();
  return req.session;
};

export const requireSession: RequestHandler = (req, _res, next) => {
  next(req.session ? undefined : unauthorized());
};

/** Checks a permission on the server. The web app hiding a button is never the protection. */
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.session) return next(unauthorized());
    if (!roleHas(req.session.role, permission)) return next(forbidden());
    next();
  };

export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.session) return next(unauthorized());
  if (!req.session.user.isPlatformAdmin)
    return next(forbidden("platform_only", "This area is for the platform owner"));
  next();
};

/** Changes are refused while a workspace is suspended; reading still works. */
export const requireActiveTenant: RequestHandler = (req, _res, next) => {
  if (!req.session) return next(unauthorized());
  if (req.session.tenant.status !== "active") {
    return next(forbidden("workspace_suspended", "This workspace is suspended, so changes are paused"));
  }
  next();
};

export const rateLimit =
  (limiter: RateLimiterAbstract | null, key: (req: Request) => string): RequestHandler =>
  async (req, res, next) => {
    if (!limiter) return next();
    try {
      await limiter.consume(key(req));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        res.setHeader("Retry-After", String(Math.ceil(err.msBeforeNext / 1000)));
        return next(tooManyRequests());
      }
      // If the limiter itself is unavailable, do not take the API down with it.
      next();
    }
  };

/** Validates input with a zod schema and reports problems per field. */
export const parse = <T>(schema: z.ZodType<T>, data: unknown): T => {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    if (path && !fields[path]) fields[path] = issue.message;
  }
  throw new AppError(400, "validation_failed", result.error.issues[0]?.message ?? "Invalid input", {
    fields,
  });
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "not_found", "Not found"));
};

export const errorHandler =
  (core: Core): ErrorRequestHandler =>
  (err, req, res, _next) => {
    let status = 500;
    let body: ApiErrorBody = {
      error: { code: "internal_error", message: "Something went wrong on our side" },
    };

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, fields: err.fields } };
      if (err.details !== undefined) (body.error as Record<string, unknown>).details = err.details;
    } else if ((err as { type?: string }).type === "entity.parse.failed") {
      status = 400;
      body = { error: { code: "invalid_json", message: "The request body is not valid JSON" } };
    } else if ((err as { type?: string }).type === "entity.too.large") {
      status = 413;
      body = { error: { code: "too_large", message: "The request is too large" } };
    }

    if (status >= 500) core.log.error({ err, requestId: req.id, path: req.path }, "request failed");
    res.status(status).json(body);
  };
