export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type RequestOpts = Omit<RequestInit, "body"> & {
  body?: unknown;
};

async function request<T>(url: string, opts: RequestOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, {
    ...opts,
    headers,
    body,
    credentials: "include",
  });

  if (res.status === 401 && !url.endsWith("/api/auth/me")) {
    // Bounce to login on any auth failure outside the auth check itself
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: "GET" }),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "PUT", body }),
  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "PATCH", body }),
  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
