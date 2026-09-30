const { ZodError } = require("zod");
const HttpError = require("../lib/httpError");

const notFound = (req, res, next) => next(new HttpError(404, "Not found"));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue.path.join(".");
    return res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue.message });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.name === "CastError") return res.status(404).json({ error: "Not found" });
  if (err.code === 11000) return res.status(409).json({ error: "That record already exists" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });

  console.error("[http]", err);
  res.status(500).json({ error: "Something went wrong on the server" });
};

module.exports = { notFound, errorHandler };
