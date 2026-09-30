const crypto = require("crypto");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const config = require("./config");
const User = require("./models/User");
const runner = require("./services/runner");
const scheduler = require("./services/scheduler");
const { requireAuth, requireAdmin } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/errors");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "upgrade-insecure-requests": config.isProd ? [] : null,
      },
    },
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Liveness probe (also a cheap keep-awake target for free hosting tiers).
app.get("/healthz", (req, res) => {
  const db = mongoose.connection.readyState === 1;
  res.status(db ? 200 : 503).json({ ok: db, uptime: Math.round(process.uptime()) });
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/jobs", requireAuth, require("./routes/jobs"));
app.use("/api/dumps", requireAuth, require("./routes/dumps"));
app.use("/api/users", requireAuth, requireAdmin, require("./routes/users"));
app.use("/api", requireAuth, require("./routes/stats"));
app.use("/api", notFound);

app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: config.isProd ? "1h" : 0 }));
app.get("/{*splat}", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.use(errorHandler);

// Creates the first admin account when the database has no users yet.
const bootstrapAdmin = async () => {
  if (await User.exists({})) return;
  const email = config.admin.email || "admin@example.com";
  const generated = !config.admin.password;
  const password = config.admin.password || crypto.randomBytes(9).toString("base64url");
  const admin = new User({ email, name: config.admin.name, role: "admin" });
  await admin.setPassword(password);
  await admin.save();
  console.log(`[bootstrap] created admin account ${email}`);
  if (generated) {
    console.log(`[bootstrap] generated password: ${password}  (set ADMIN_PASSWORD to choose your own)`);
  }
};

const main = async () => {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log("[db] connected to MongoDB");
  await bootstrapAdmin();
  await runner.recoverInterrupted();

  const server = app.listen(config.port, () => {
    console.log(`[http] listening on ${config.appUrl} (port ${config.port}, ${config.env})`);
  });
  scheduler.start();

  const shutdown = (signal) => {
    console.log(`[app] ${signal} received, shutting down`);
    scheduler.stop();
    server.closeAllConnections?.();
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

if (require.main === module) {
  main().catch((err) => {
    console.error("[app] failed to start:", err.message);
    process.exit(1);
  });
}

module.exports = { app, main };
