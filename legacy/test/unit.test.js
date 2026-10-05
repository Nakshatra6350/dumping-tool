const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ENCRYPTION_KEY ||= "unit-test-key";
process.env.JWT_SECRET ||= "unit-test-secret";

const { encrypt, decrypt } = require("../src/lib/crypto");
const { nextRunAt, validateSchedule, toCron } = require("../src/lib/schedule");
const { jobInput } = require("../src/lib/validation");

test("encrypt/decrypt round-trips and is randomized", () => {
  const secret = `p@ss "word" $1 ✓`;
  const a = encrypt(secret);
  const b = encrypt(secret);
  assert.notEqual(a, b);
  assert.equal(decrypt(a), secret);
  assert.equal(encrypt(""), "");
});

test("tampered ciphertext is rejected", () => {
  const parts = encrypt("hello").split(":");
  parts[3] = Buffer.from("evil").toString("base64");
  assert.throws(() => decrypt(parts.join(":")));
});

test("daily schedule respects timezone", () => {
  const from = new Date("2026-01-10T00:00:00Z");
  const next = nextRunAt({ type: "daily", time: "02:30", timezone: "Asia/Kolkata" }, from);
  // 02:30 IST = 21:00 UTC the previous day, so the next one is Jan 10 21:00 UTC.
  assert.equal(next.toISOString(), "2026-01-10T21:00:00.000Z");
});

test("weekly schedule builds a cron expression", () => {
  assert.equal(toCron({ type: "weekly", time: "09:05", daysOfWeek: [5, 1, 1] }), "5 9 * * 1,5");
});

test("once schedule only fires in the future", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(nextRunAt({ type: "once", runAt: "2025-12-31T00:00:00Z" }, now), null);
  assert.equal(nextRunAt({ type: "once", runAt: "2026-01-02T00:00:00Z" }, now).toISOString(), "2026-01-02T00:00:00.000Z");
  assert.throws(() => validateSchedule({ type: "once", runAt: "2025-01-01T00:00:00Z" }, now), /future/);
});

test("too-frequent and invalid cron schedules are rejected", () => {
  assert.throws(() => validateSchedule({ type: "cron", cron: "* * * * *", timezone: "UTC" }), /5 minutes/);
  assert.throws(() => validateSchedule({ type: "cron", cron: "not a cron", timezone: "UTC" }), /Invalid cron/);
  assert.doesNotThrow(() => validateSchedule({ type: "cron", cron: "*/15 * * * *", timezone: "UTC" }));
});

test("connection URI is parsed into fields", () => {
  const job = jobInput.parse({
    name: "x",
    dbType: "postgres",
    connection: { uri: "postgresql://u%40x:p%3Aw@db.example.com:6543/app?sslmode=require" },
    schedule: { type: "manual" },
  });
  assert.deepEqual(job.connection, {
    host: "db.example.com",
    port: 6543,
    username: "u@x",
    password: "p:w",
    database: "app",
    ssl: true,
  });
});

test("values that look like CLI options are rejected", () => {
  const base = { name: "x", dbType: "mysql", schedule: { type: "manual" } };
  const bad = [
    { host: "-oProxyCommand=x", username: "u", database: "d" },
    { host: "h", username: "--help", database: "d" },
    { host: "h", username: "u", database: "--all-databases" },
  ];
  for (const connection of bad) assert.throws(() => jobInput.parse({ ...base, connection }));
});
