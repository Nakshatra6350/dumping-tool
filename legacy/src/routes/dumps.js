const express = require("express");
const mongoose = require("mongoose");
const Dump = require("../models/Dump");
const HttpError = require("../lib/httpError");
const storage = require("../services/storage");
const bus = require("../lib/events");
const { ownerScope } = require("../middleware/auth");

const router = express.Router();

const findDump = async (req) => {
  const dump = await Dump.findOne({ _id: req.params.id, ...ownerScope(req.user) });
  if (!dump) throw new HttpError(404, "Dump not found");
  return dump;
};

router.get("/", async (req, res) => {
  const filter = { ...ownerScope(req.user) };
  if (req.query.job && mongoose.isValidObjectId(req.query.job)) filter.job = req.query.job;
  if (["queued", "running", "success", "failed"].includes(req.query.status)) filter.status = req.query.status;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const dumps = await Dump.find(filter).sort({ createdAt: -1 }).limit(limit);
  res.json({ dumps: dumps.map((d) => d.toPublic()) });
});

// Server-sent events: live status updates for the signed-in user's dumps.
router.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const isAdmin = req.user.role === "admin";
  const me = req.user._id.toString();
  const send = (event, data) => {
    if (!isAdmin && data.owner !== me) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const onDump = (d) => send("dump", d);
  const onDeleted = (d) => send("dump-deleted", d);
  bus.on("dump", onDump);
  bus.on("dump:deleted", onDeleted);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("dump", onDump);
    bus.off("dump:deleted", onDeleted);
  });
});

router.get("/:id", async (req, res) => {
  res.json({ dump: (await findDump(req)).toPublic() });
});

router.get("/:id/download", async (req, res) => {
  const dump = await findDump(req);
  if (dump.status !== "success" || !dump.storageKey) throw new HttpError(409, "This dump has no file to download");
  let file;
  try {
    file = await storage.get(dump.storageKey);
  } catch {
    throw new HttpError(410, "The dump file is no longer available in storage");
  }
  res.set({
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${dump.fileName}"`,
    "Cache-Control": "private, no-store",
  });
  if (file.size) res.set("Content-Length", String(file.size));
  file.stream.on("error", () => res.destroy());
  file.stream.pipe(res);
});

router.delete("/:id", async (req, res) => {
  const dump = await findDump(req);
  if (["queued", "running"].includes(dump.status)) throw new HttpError(409, "Wait for the dump to finish first");
  if (dump.storageKey) await storage.remove(dump.storageKey).catch(() => {});
  await dump.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
