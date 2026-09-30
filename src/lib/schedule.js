const { Cron } = require("croner");

const pad = (n) => String(n).padStart(2, "0");

const parseTime = (time) => {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time || "");
  if (!match) throw new Error("Time must be in HH:MM (24h) format");
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

// Converts a schedule definition into a cron expression (recurring types only).
const toCron = (schedule) => {
  switch (schedule.type) {
    case "daily": {
      const { hour, minute } = parseTime(schedule.time);
      return `${minute} ${hour} * * *`;
    }
    case "weekly": {
      const { hour, minute } = parseTime(schedule.time);
      const days = (schedule.daysOfWeek || []).filter((d) => d >= 0 && d <= 6);
      if (!days.length) throw new Error("Pick at least one day of the week");
      return `${minute} ${hour} * * ${[...new Set(days)].sort().join(",")}`;
    }
    case "cron":
      return String(schedule.cron || "").trim();
    default:
      return null;
  }
};

const validateSchedule = (schedule, now = new Date()) => {
  if (!schedule || !["manual", "once", "daily", "weekly", "cron"].includes(schedule.type)) {
    throw new Error("Unknown schedule type");
  }
  if (schedule.type === "once") {
    const runAt = new Date(schedule.runAt);
    if (Number.isNaN(runAt.getTime())) throw new Error("Pick a valid date and time");
    if (runAt.getTime() <= now.getTime()) throw new Error("The run time must be in the future");
    return;
  }
  const expr = toCron(schedule);
  if (!expr) return;
  let cron;
  try {
    cron = new Cron(expr, { timezone: schedule.timezone, paused: true });
  } catch (err) {
    throw new Error(`Invalid cron expression: ${err.message}`);
  }
  // Refuse schedules more frequent than every 5 minutes to protect the host.
  const [a, b] = cron.nextRuns(2, now);
  if (a && b && b.getTime() - a.getTime() < 5 * 60 * 1000) {
    throw new Error("Schedules must be at least 5 minutes apart");
  }
};

// Returns the next Date the schedule should fire after `from`, or null.
const nextRunAt = (schedule, from = new Date()) => {
  if (!schedule) return null;
  if (schedule.type === "manual") return null;
  if (schedule.type === "once") {
    const runAt = schedule.runAt ? new Date(schedule.runAt) : null;
    return runAt && runAt.getTime() > from.getTime() ? runAt : null;
  }
  const expr = toCron(schedule);
  if (!expr) return null;
  return new Cron(expr, { timezone: schedule.timezone, paused: true }).nextRun(from) || null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const describe = (schedule) => {
  if (!schedule) return "";
  switch (schedule.type) {
    case "manual":
      return "Manual only";
    case "once":
      return `Once at ${new Date(schedule.runAt).toISOString()}`;
    case "daily":
      return `Daily at ${schedule.time}`;
    case "weekly":
      return `Weekly on ${(schedule.daysOfWeek || []).map((d) => DAY_NAMES[d]).join(", ")} at ${schedule.time}`;
    case "cron":
      return `Cron: ${schedule.cron}`;
    default:
      return "";
  }
};

module.exports = { toCron, validateSchedule, nextRunAt, describe, pad };
