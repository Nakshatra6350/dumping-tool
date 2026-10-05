const express = require("express");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const HttpError = require("../lib/httpError");
const { loginInput, passwordChangeInput } = require("../lib/validation");
const { issueSession, clearSession, requireAuth } = require("../middleware/auth");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many sign-in attempts. Try again in a few minutes." },
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = loginInput.parse(req.body);
  const user = await User.findOne({ email });
  if (!user || !(await user.checkPassword(password))) {
    throw new HttpError(401, "Incorrect email or password");
  }
  user.lastLoginAt = new Date();
  await user.save();
  issueSession(res, user);
  res.json({ user: user.toPublic() });
});

router.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

router.post("/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = passwordChangeInput.parse(req.body);
  if (!(await req.user.checkPassword(currentPassword))) {
    throw new HttpError(400, "Current password is incorrect");
  }
  await req.user.setPassword(newPassword);
  await req.user.save();
  issueSession(res, req.user);
  res.json({ ok: true });
});

module.exports = router;
