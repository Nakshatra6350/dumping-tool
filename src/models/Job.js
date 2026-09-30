const mongoose = require("mongoose");
const { describe } = require("../lib/schedule");

const connectionSchema = new mongoose.Schema(
  {
    host: { type: String, required: true },
    port: { type: Number, required: true },
    username: { type: String, required: true },
    passwordEnc: { type: String, default: "" },
    database: { type: String, required: true },
    ssl: { type: Boolean, default: false },
  },
  { _id: false }
);

const scheduleSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["manual", "once", "daily", "weekly", "cron"], required: true },
    runAt: Date,
    time: String,
    daysOfWeek: [Number],
    cron: String,
    timezone: { type: String, required: true },
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    dbType: { type: String, enum: ["postgres", "mysql"], required: true },
    connection: { type: connectionSchema, required: true },
    schedule: { type: scheduleSchema, required: true },
    notifyEmails: { type: [String], default: [] },
    notifyOn: { type: String, enum: ["always", "failure", "never"], default: "always" },
    retention: { type: Number, default: 7, min: 1, max: 365 },
    enabled: { type: Boolean, default: true },
    nextRunAt: { type: Date, default: null, index: true },
    lastRunAt: Date,
    lastStatus: { type: String, enum: ["success", "failed", null], default: null },
  },
  { timestamps: true }
);

jobSchema.methods.toPublic = function toPublic() {
  const { passwordEnc, ...connection } = this.connection.toObject();
  return {
    id: this._id.toString(),
    owner: this.owner?._id ? this.owner._id.toString() : this.owner?.toString(),
    ownerName: this.owner?.name,
    name: this.name,
    dbType: this.dbType,
    connection: { ...connection, hasPassword: Boolean(passwordEnc) },
    schedule: this.schedule.toObject(),
    scheduleText: describe(this.schedule),
    notifyEmails: this.notifyEmails,
    notifyOn: this.notifyOn,
    retention: this.retention,
    enabled: this.enabled,
    nextRunAt: this.nextRunAt,
    lastRunAt: this.lastRunAt,
    lastStatus: this.lastStatus,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("Job", jobSchema);
