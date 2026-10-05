const mongoose = require("mongoose");

const dumpSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jobName: String,
    dbType: { type: String, enum: ["postgres", "mysql"], required: true },
    host: String,
    database: String,
    trigger: { type: String, enum: ["schedule", "manual"], default: "manual" },
    status: {
      type: String,
      enum: ["queued", "running", "success", "failed"],
      default: "queued",
      index: true,
    },
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
    sizeBytes: Number,
    sha256: String,
    storageKey: String,
    fileName: String,
    tool: String,
    error: String,
  },
  { timestamps: true }
);

dumpSchema.index({ owner: 1, createdAt: -1 });

dumpSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    job: this.job?.toString() || null,
    owner: this.owner?.toString(),
    jobName: this.jobName,
    dbType: this.dbType,
    host: this.host,
    database: this.database,
    trigger: this.trigger,
    status: this.status,
    startedAt: this.startedAt,
    finishedAt: this.finishedAt,
    durationMs: this.durationMs,
    sizeBytes: this.sizeBytes,
    sha256: this.sha256,
    fileName: this.fileName,
    tool: this.tool,
    error: this.error,
    downloadable: this.status === "success" && Boolean(this.storageKey),
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("Dump", dumpSchema);
