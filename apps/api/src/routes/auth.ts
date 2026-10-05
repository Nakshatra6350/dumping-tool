import { toSessionView, type Core } from "@dbrb/core";
import { changePasswordSchema, loginSchema, profileSchema, signupSchema } from "@dbrb/shared";
import { Router } from "express";
import type { Limiters } from "../app";
import {
  clearSessionCookie,
  parse,
  rateLimit,
  requireSession,
  sessionOf,
  sessionToken,
  setSessionCookie,
} from "../http/middleware";

export const authRoutes = (core: Core, limiters: Limiters): Router => {
  const router = Router();
  const byIp = (req: { ip?: string }) => req.ip ?? "unknown";

  router.post("/signup", rateLimit(limiters.signup, byIp), async (req, res) => {
    const input = parse(signupSchema, req.body);
    const { token, session } = await core.auth.signup(input, req.meta);
    setSessionCookie(core, res, token);
    res.status(201).json(toSessionView(session));
  });

  router.post("/login", rateLimit(limiters.login, byIp), async (req, res) => {
    const input = parse(loginSchema, req.body);
    const { token, session } = await core.auth.login(input, req.meta);
    setSessionCookie(core, res, token);
    res.json(toSessionView(session));
  });

  router.post("/logout", async (req, res) => {
    const token = sessionToken(req);
    if (token) await core.auth.logout(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get("/me", requireSession, (req, res) => {
    res.json(toSessionView(sessionOf(req)));
  });

  router.put("/profile", requireSession, async (req, res) => {
    const session = sessionOf(req);
    const user = await core.auth.updateProfile(session, parse(profileSchema, req.body));
    res.json(toSessionView({ ...session, user }));
  });

  router.post("/password", requireSession, rateLimit(limiters.login, byIp), async (req, res) => {
    await core.auth.changePassword(sessionOf(req), parse(changePasswordSchema, req.body), req.meta);
    res.json({ ok: true });
  });

  return router;
};
