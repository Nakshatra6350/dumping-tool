const express = require("express");
const Job = require("../models/Job");
const Dump = require("../models/Dump");
const config = require("../config");
const storage = require("../services/storage");
const mailer = require("../services/mailer");
const runner = require("../services/runner");
const { toolStatus } = require("../services/dumper/binaries");
const { ownerScope, requireAdmin } = require("../middleware/auth");

const router = express.Router();
const DAYS = 14;

router.get("/stats", async (req, res) => {
  const scope = ownerScope(req.user);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (DAYS - 1));

  const [jobs, totals, daily, upcoming, recent] = await Promise.all([
    Job.find(scope, { enabled: 1 }),
    Dump.aggregate([
      { $match: scope },
      { $group: { _id: "$status", n: { $sum: 1 }, bytes: { $sum: { $ifNull: ["$sizeBytes", 0] } } } },
    ]),
    Dump.aggregate([
      { $match: { ...scope, createdAt: { $gte: since }, status: { $in: ["success", "failed"] } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, status: "$status" },
          n: { $sum: 1 },
        },
      },
    ]),
    Job.find({ ...scope, enabled: true, nextRunAt: { $ne: null } }).sort({ nextRunAt: 1 }).limit(5).populate("owner", "name"),
    Dump.find(scope).sort({ createdAt: -1 }).limit(8),
  ]);

  const byStatus = Object.fromEntries(totals.map((t) => [t._id, t]));
  const series = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const pick = (s) => daily.find((x) => x._id.day === key && x._id.status === s)?.n || 0;
    series.push({ day: key, success: pick("success"), failed: pick("failed") });
  }
  const success = byStatus.success?.n || 0;
  const failed = byStatus.failed?.n || 0;

  res.json({
    jobs: { total: jobs.length, active: jobs.filter((j) => j.enabled).length },
    dumps: {
      success,
      failed,
      running: (byStatus.running?.n || 0) + (byStatus.queued?.n || 0),
      successRate: success + failed ? success / (success + failed) : null,
      storedBytes: byStatus.success?.bytes || 0,
    },
    series,
    upcoming: upcoming.map((j) => j.toPublic()),
    recent: recent.map((d) => d.toPublic()),
  });
});

router.get("/system", requireAdmin, async (req, res) => {
  let storageInfo;
  try {
    storageInfo = { ok: true, detail: await storage.check() };
  } catch (err) {
    storageInfo = { ok: false, detail: err.message };
  }
  res.json({
    version: require("../../package.json").version,
    env: config.env,
    appUrl: config.appUrl,
    timezone: config.timezone,
    tools: await toolStatus(),
    storage: { driver: storage.name, ...storageInfo },
    email: mailer.status(),
    runner: { ...runner.stats(), maxConcurrent: config.dump.maxConcurrent },
  });
});

router.post("/system/test-email", requireAdmin, async (req, res) => {
  await mailer.send({
    to: [req.user.email],
    subject: "Dumping Tool: test email",
    text: "Email notifications are configured correctly.",
    html: "<p>Email notifications are configured correctly. &#10004;</p>",
  });
  res.json({ ok: true, to: req.user.email });
});

module.exports = router;
