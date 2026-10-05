const express = require("express");
const rateLimit = require("express-rate-limit");
const Job = require("../models/Job");
const Dump = require("../models/Dump");
const HttpError = require("../lib/httpError");
const storage = require("../services/storage");
const runner = require("../services/runner");
const { encrypt, decrypt } = require("../lib/crypto");
const { validateSchedule, nextRunAt } = require("../lib/schedule");
const { jobInput, testConnectionInput, DEFAULT_PORTS } = require("../lib/validation");
const { testConnection } = require("../services/dumper/probe");
const { ownerScope } = require("../middleware/auth");

const router = express.Router();

const findJob = async (req) => {
  const job = await Job.findOne({ _id: req.params.id, ...ownerScope(req.user) }).populate("owner", "name");
  if (!job) throw new HttpError(404, "Job not found");
  return job;
};

const checkSchedule = (schedule) => {
  try {
    validateSchedule(schedule);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
};

const withDefaults = (dbType, conn) => ({ ...conn, port: conn.port || DEFAULT_PORTS[dbType] });

router.get("/", async (req, res) => {
  const jobs = await Job.find(ownerScope(req.user)).sort({ createdAt: -1 }).populate("owner", "name");
  res.json({ jobs: jobs.map((j) => j.toPublic()) });
});

router.get("/:id", async (req, res) => {
  res.json({ job: (await findJob(req)).toPublic() });
});

router.post("/", async (req, res) => {
  const input = jobInput.parse(req.body);
  checkSchedule(input.schedule);
  const { password, ...conn } = withDefaults(input.dbType, input.connection);
  if (!conn.database) throw new HttpError(400, "connection.database: pick a database to back up");

  const job = new Job({
    ...input,
    owner: req.user._id,
    connection: { ...conn, passwordEnc: encrypt(password) },
  });
  job.nextRunAt = job.enabled ? nextRunAt(job.schedule) : null;
  await job.save();
  if (input.runNow) await runner.enqueue(job, "manual");
  res.status(201).json({ job: job.toPublic() });
});

router.put("/:id", async (req, res) => {
  const job = await findJob(req);
  const input = jobInput.parse(req.body);
  checkSchedule(input.schedule);
  const { password, ...conn } = withDefaults(input.dbType, input.connection);
  if (!conn.database) throw new HttpError(400, "connection.database: pick a database to back up");

  // An empty password field while editing means "keep the saved password".
  const passwordEnc = password ? encrypt(password) : job.connection.passwordEnc;
  job.set({
    name: input.name,
    dbType: input.dbType,
    connection: { ...conn, passwordEnc },
    schedule: input.schedule,
    notifyEmails: input.notifyEmails,
    notifyOn: input.notifyOn,
    retention: input.retention,
    enabled: input.enabled,
  });
  job.nextRunAt = job.enabled ? nextRunAt(job.schedule) : null;
  await job.save();
  if (input.runNow && !(await runner.isBusy(job._id))) await runner.enqueue(job, "manual");
  res.json({ job: job.toPublic() });
});

router.post("/:id/toggle", async (req, res) => {
  const job = await findJob(req);
  job.enabled = !job.enabled;
  job.nextRunAt = job.enabled ? nextRunAt(job.schedule) : null;
  await job.save();
  res.json({ job: job.toPublic() });
});

router.post("/:id/run", async (req, res) => {
  const job = await findJob(req);
  if (await runner.isBusy(job._id)) throw new HttpError(409, "This job is already running");
  const dump = await runner.enqueue(job, "manual");
  res.status(202).json({ dump: dump.toPublic() });
});

router.delete("/:id", async (req, res) => {
  const job = await findJob(req);
  const dumps = await Dump.find({ job: job._id });
  for (const d of dumps) {
    if (d.storageKey) await storage.remove(d.storageKey).catch(() => {});
  }
  await Dump.deleteMany({ job: job._id });
  await job.deleteOne();
  res.json({ ok: true, deletedDumps: dumps.length });
});

const probeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many connection tests, slow down a little." },
});

router.post("/test-connection", probeLimiter, async (req, res) => {
  const input = testConnectionInput.parse(req.body);
  const conn = withDefaults(input.dbType, input.connection);
  // When editing, allow testing without re-typing the saved password.
  if (!conn.password && input.jobId) {
    const job = await Job.findOne({ _id: input.jobId, ...ownerScope(req.user) });
    if (job) conn.password = decrypt(job.connection.passwordEnc);
  }
  try {
    const result = await testConnection(input.dbType, conn);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message || String(err.code || err) });
  }
});

module.exports = router;
