export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export const api = async (path, { method = "GET", body } = {}) => {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data);
  }
  return data;
};

api.get = (p) => api(p);
api.post = (p, body = {}) => api(p, { method: "POST", body });
api.put = (p, body) => api(p, { method: "PUT", body });
api.del = (p) => api(p, { method: "DELETE" });
