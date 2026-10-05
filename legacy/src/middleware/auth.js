const jwt = require("jsonwebtoken");
const config = require("../config");
const User = require("../models/User");
const HttpError = require("../lib/httpError");

const COOKIE = "dt_session";

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: config.isProd && config.appUrl.startsWith("https://"),
  maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  path: "/",
});

const issueSession = (res, user) => {
  const token = jwt.sign({ sub: user._id.toString(), v: user.tokenVersion }, config.jwtSecret, {
    expiresIn: `${config.sessionDays}d`,
  });
  res.cookie(COOKIE, token, cookieOptions());
};

const clearSession = (res) => res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });

const loadUser = async (req) => {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.v) return null;
    return user;
  } catch {
    return null;
  }
};

const requireAuth = async (req, res, next) => {
  const user = await loadUser(req);
  if (!user) return next(new HttpError(401, "Please sign in"));
  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") return next(new HttpError(403, "Admins only"));
  next();
};

// Mongo filter restricting non-admins to their own documents.
const ownerScope = (user) => (user.role === "admin" ? {} : { owner: user._id });

module.exports = { issueSession, clearSession, requireAuth, requireAdmin, ownerScope };
