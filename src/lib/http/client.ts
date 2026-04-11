type QueryValue = string | number | boolean | null | undefined;

type ApiFetchOptions = Omit<RequestInit, "body"> & {
  params?: Record<string, QueryValue>;
  body?: BodyInit | Record<string, unknown> | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `请求失败，状态码 ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}) {
  const { params, body, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  const requestBody = normalizeBody(body, requestHeaders);
  const response = await fetch(buildProxyUrl(path, params), {
    ...init,
    headers: requestHeaders,
    body: requestBody,
    cache: "no-store",
  });
  const payload = await parseResponseBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, payload, resolveErrorMessage(payload, response.status));
  }

  return payload as T;
}

function buildProxyUrl(path: string, params?: Record<string, QueryValue>) {
  const query = new URLSearchParams();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      query.set(key, String(value));
    }
  }

  const queryString = query.toString();
  return `/api/proxy${path}${queryString ? `?${queryString}` : ""}`;
}

function normalizeBody(
  body: ApiFetchOptions["body"],
  headers: Headers,
): BodyInit | undefined {
  if (body === null || body === undefined) {
    return undefined;
  }

  if (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  ) {
    return body;
  }

  headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  if (!response.body) {
    return null;
  }

  return response.text();
}

function resolveErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = Reflect.get(payload, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return `请求失败，状态码 ${status}`;
}
