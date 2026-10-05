import type { ApiErrorBody } from "@dbrb/shared";

/** An error returned by the API, with a stable code the UI can translate. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> = {},
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

let onUnauthorized: () => void = () => {};

/** Called when a request finds the session is no longer valid. */
export const setUnauthorizedHandler = (handler: () => void): void => {
  onUnauthorized = handler;
};

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the server. Check your connection.");
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as (ApiErrorBody & { error: { details?: unknown } }) | null)?.error;
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized();
    throw new ApiError(
      res.status,
      error?.code ?? "generic",
      error?.message ?? `Request failed (${res.status})`,
      error?.fields ?? {},
      error?.details,
    );
  }
  return data as T;
};

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
