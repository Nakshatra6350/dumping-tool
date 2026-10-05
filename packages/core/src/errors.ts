/** An error that is safe to show to the caller, with an HTTP status and a stable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level messages for forms: { email: "Enter a valid email address" } */
  readonly fields?: Record<string, string>;
  /** Extra machine-readable details (never secrets). */
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { fields?: Record<string, string>; details?: unknown } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.details = extra.details;
  }
}

export const badRequest = (code: string, message: string, fields?: Record<string, string>) =>
  new AppError(400, code, message, { fields });

export const unauthorized = (message = "Please sign in to continue") =>
  new AppError(401, "unauthorized", message);

export const forbidden = (code = "forbidden", message = "You don't have permission to do that") =>
  new AppError(403, code, message);

export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, { details });

export const tooManyRequests = (message = "Too many attempts. Please wait a moment and try again.") =>
  new AppError(429, "rate_limited", message);
