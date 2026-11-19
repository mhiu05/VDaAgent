/** HTTP transport for the API adapters (docs 14c, 15). Pages never see DTOs or raw server text. */
export class ApiRequestError extends Error {
  readonly status: number;
  /** Stable application code (the `normalizeServiceError` vocabulary). */
  readonly code: string;
  /** The API's own error code (doc 15), for adapters that map specific cases. */
  readonly serverCode: string | null;
  constructor(status: number, serverCode: string | null) {
    super(`API request failed (${status})`);
    this.name = "ApiRequestError";
    this.status = status;
    this.serverCode = serverCode;
    this.code = codeFor(status);
  }
}

export function codeFor(status: number): string {
  const codes: Record<number, string> = { 400: "validation", 401: "expired", 403: "forbidden",
    404: "notFound", 408: "timeout", 409: "conflict", 422: "validation", 501: "unsupported" };
  return codes[status] ?? "unavailable";
}

export interface ApiClientOptions {
  fetch?: typeof fetch;
  base?: string;
  onUnauthorized?: () => void;
  sessionIdentity?: () => unknown;
}
type Query = Record<string, string | number | undefined | readonly (string | number)[]>;

export interface ApiClient {
  get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  put<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  patch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  delete<T>(path: string, signal?: AbortSignal): Promise<T>;
  form<T>(path: string, body: FormData, signal?: AbortSignal): Promise<T>;
  blob(path: string, signal?: AbortSignal): Promise<{ blob: Blob; type: string }>;
}

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = options.base ?? "";
  async function request(method: string, path: string, body?: unknown, signal?: AbortSignal,
                         form = false): Promise<Response> {
    const identity = options.sessionIdentity?.();
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["X-Contoso-Client"] = "web";
    let payload: BodyInit | undefined;
    if (form) payload = body as FormData;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const response = await doFetch(`${base}${path}`, { method, headers, body: payload,
      credentials: "include", signal });
    if (!response.ok) {
      if (response.status === 401 && identity === options.sessionIdentity?.()
          && !/^\/api\/auth\/(?:login|demo-login|demo\/|logout)/.test(path))
        options.onUnauthorized?.();
      let serverCode: string | null = null;
      try { serverCode = ((await response.json()) as { error?: string }).error ?? null; } catch { /* not JSON */ }
      throw new ApiRequestError(response.status, serverCode);
    }
    return response;
  }
  const parse = async <T,>(response: Response): Promise<T> =>
    (response.status === 204 ? null : await response.json()) as T;
  return {
    get: async (path, query, signal) => parse(await request("GET", withQuery(path, query), undefined, signal)),
    post: async (path, body, signal) => parse(await request("POST", path, body, signal)),
    put: async (path, body, signal) => parse(await request("PUT", path, body, signal)),
    patch: async (path, body, signal) => parse(await request("PATCH", path, body, signal)),
    delete: async (path, signal) => parse(await request("DELETE", path, undefined, signal)),
    form: async (path, body, signal) => parse(await request("POST", path, body, signal, true)),
    async blob(path, signal) {
      const response = await request("GET", path, undefined, signal);
      const blob = await response.blob();
      return { blob, type: response.headers.get("Content-Type") ?? blob.type };
    },
  };
}
