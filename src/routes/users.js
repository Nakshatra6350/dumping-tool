const express = require("express");
const User = require("../models/User");
const Job = require("../models/Job");
const HttpError = require("../lib/httpError");
const { userInput, passwordResetInput } = require("../lib/validation");

const router = express.Router();

router.get("/", async (req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  const counts = await Job.aggregate([{ $group: { _id: "$owner", n: { $sum: 1 } } }]);
  const byOwner = Object.fromEntries(counts.map((c) => [c._id.toString(), c.n]));
  res.json({ users: users.map((u) => ({ ...u.toPublic(), jobs: byOwner[u._id.toString()] || 0 })) });
});

router.post("/", async (req, res) => {
  const { password, ...data } = userInput.parse(req.body);
  if (await User.exists({ email: data.email })) throw new HttpError(409, "A user with that email already exists");
  const user = new User(data);
  await user.setPassword(password);
  await user.save();
  res.status(201).json({ user: user.toPublic() });
});

router.post("/:id/password", async (req, res) => {
  const { password } = passwordResetInput.parse(req.body);
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, "User not found");
  await user.setPassword(password);
  await user.save();
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  if (req.params.id === req.user._id.toString()) throw new HttpError(400, "You cannot delete your own account");
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, "User not found");
  if (await Job.exists({ owner: user._id })) {
    throw new HttpError(409, "Delete or reassign this user's backup jobs first");
  }
  await user.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
