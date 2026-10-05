const config = require("../config");
const Job = require("../models/Job");
const runner = require("./runner");
const { nextRunAt } = require("../lib/schedule");

let timer = null;
let ticking = false;

// Schedules live in MongoDB (job.nextRunAt), so they survive restarts and
// sleeping free-tier instances: anything overdue runs once on the next tick.
const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const due = await Job.find({ enabled: true, nextRunAt: { $ne: null, $lte: now } })
      .sort({ nextRunAt: 1 })
      .limit(50);

    for (const job of due) {
      const next = nextRunAt(job.schedule, now);
      // Optimistic claim: only one instance wins if several are running.
      const claimed = await Job.findOneAndUpdate(
        { _id: job._id, nextRunAt: job.nextRunAt },
        { $set: { nextRunAt: next } },
        { returnDocument: "after" }
      );
      if (!claimed) continue;
      if (await runner.isBusy(job._id)) {
        console.log(`[scheduler] skipping "${job.name}", previous run still in progress`);
        continue;
      }
      console.log(`[scheduler] starting "${job.name}"`);
      await runner.enqueue(claimed, "schedule");
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err.message);
  } finally {
    ticking = false;
  }
};

const start = () => {
  if (timer) return;
  timer = setInterval(tick, config.schedulerIntervalMs);
  timer.unref();
  tick();
};

const stop = () => {
  clearInterval(timer);
  timer = null;
};

module.exports = { start, stop, tick };
