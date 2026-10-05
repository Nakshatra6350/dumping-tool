const fs = require("fs");
const path = require("path");
const config = require("../config");
const Dump = require("../models/Dump");
const Job = require("../models/Job");
const storage = require("./storage");
const mailer = require("./mailer");
const bus = require("../lib/events");
const { decrypt } = require("../lib/crypto");
const { runDump } = require("./dumper");

const queue = [];
let active = 0;

const emit = (dump) => bus.emit("dump", dump.toPublic());

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "db";

const stamp = (d) => d.toISOString().replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z");

const isBusy = (jobId) => Dump.exists({ job: jobId, status: { $in: ["queued", "running"] } });

// Creates a dump record for the job and queues it. Returns the Dump document.
const enqueue = async (job, trigger) => {
  const dump = await Dump.create({
    job: job._id,
    owner: job.owner,
    jobName: job.name,
    dbType: job.dbType,
    host: job.connection.host,
    database: job.connection.database,
    trigger,
    status: "queued",
  });
  emit(dump);
  queue.push(dump._id);
  drain();
  return dump;
};

const drain = () => {
  while (active < config.dump.maxConcurrent && queue.length) {
    const id = queue.shift();
    active += 1;
    execute(id)
      .catch((err) => console.error("[runner] unexpected error", err))
      .finally(() => {
        active -= 1;
        drain();
      });
  }
};

const execute = async (dumpId) => {
  const dump = await Dump.findById(dumpId);
  if (!dump) return;
  const job = await Job.findById(dump.job);
  if (!job) {
    dump.set({ status: "failed", error: "Job was deleted before it ran", finishedAt: new Date() });
    await dump.save();
    emit(dump);
    return;
  }

  dump.set({ status: "running", startedAt: new Date() });
  await dump.save();
  emit(dump);

  const fileName = `${job.dbType}_${slug(job.connection.database)}_${stamp(dump.startedAt)}.sql.gz`;
  const tmpFile = path.join(config.dump.tmpDir, `${dump._id}.sql.gz`);

  try {
    const connection = { ...job.connection.toObject(), password: decrypt(job.connection.passwordEnc) };
    const result = await runDump({ dbType: job.dbType, connection, outFile: tmpFile });
    const storageKey = `${job.owner}/${job._id}/${fileName}`;
    await storage.put(tmpFile, storageKey);
    dump.set({ status: "success", storageKey, fileName, ...result });
  } catch (err) {
    await fs.promises.rm(tmpFile, { force: true }).catch(() => {});
    dump.set({ status: "failed", error: err.message });
    console.error(`[runner] dump ${dump._id} (${job.name}) failed: ${err.message}`);
  }

  dump.finishedAt = new Date();
  dump.durationMs = dump.finishedAt - dump.startedAt;
  await dump.save();
  await Job.updateOne({ _id: job._id }, { lastRunAt: dump.finishedAt, lastStatus: dump.status });
  emit(dump);

  if (dump.status === "success") await applyRetention(job).catch((e) => console.error("[retention]", e.message));
  await notify(job, dump);
};

// Keeps only the newest `job.retention` successful dumps for the job.
const applyRetention = async (job) => {
  const old = await Dump.find({ job: job._id, status: "success" })
    .sort({ createdAt: -1 })
    .skip(job.retention);
  for (const d of old) {
    if (d.storageKey) await storage.remove(d.storageKey).catch(() => {});
    await d.deleteOne();
    bus.emit("dump:deleted", { id: d._id.toString(), owner: d.owner.toString() });
  }
};

const notify = async (job, dump) => {
  if (job.notifyOn === "never" || !job.notifyEmails.length) return;
  if (job.notifyOn === "failure" && dump.status === "success") return;
  try {
    await mailer.send({ to: job.notifyEmails, ...mailer.dumpNotification(dump) });
  } catch (err) {
    console.error(`[mail] could not send notification for dump ${dump._id}: ${err.message}`);
  }
};

// Dumps that were queued/running when the process stopped can never finish.
const recoverInterrupted = async () => {
  const { modifiedCount } = await Dump.updateMany(
    { status: { $in: ["queued", "running"] } },
    { status: "failed", error: "Interrupted by a server restart", finishedAt: new Date() }
  );
  if (modifiedCount) console.log(`[runner] marked ${modifiedCount} interrupted dump(s) as failed`);
  await fs.promises.mkdir(config.dump.tmpDir, { recursive: true });
};

module.exports = { enqueue, isBusy, recoverInterrupted, stats: () => ({ active, queued: queue.length }) };
