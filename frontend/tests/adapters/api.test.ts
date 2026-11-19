// API adapters (docs 14c, 15): the frontend ports mapped onto the real backend routes.
import { describe, expect, it, vi } from "vitest";
import { createApiClient, ApiRequestError } from "../../src/adapters/api/http";
import { createApiAuth } from "../../src/adapters/api/auth";
import { createApiPreferences } from "../../src/adapters/api/preferences";
import { createApiNotifications } from "../../src/adapters/api/notifications";
import { createApiReports, createReportTargets } from "../../src/adapters/api/reports";
import { createApiDashboard } from "../../src/adapters/api/dashboard";
import { createApiAdminUsers } from "../../src/adapters/api/admin-users";
import { createRealtime, type EventSourceLike } from "../../src/adapters/api/realtime";
import { createSessionStore } from "../../src/adapters/api/session";
import { createApiHybridServices } from "../../src/adapters/api/create-api-services";
import { createServices } from "../../src/app/services/create-services";
import type { Principal } from "../../src/shared/contracts/auth";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body: unknown = init.body;
    if (typeof body === "string") body = JSON.parse(body);
    const call = { url, method, headers, body };
    calls.push(call);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const key = `${method} ${path.split("?")[0]}`;
    const handler = routes[key] ?? routes[`${method} *`];
    if (!handler) return json({ error: "not_found", message: "x" }, 404);
    return handler(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

const ME = {
  id: "u1", username: "alice", display_name: "", role: "user",
  domain: { id: "fabrikam", name: "Fabrikam", status: "available" },
  status: "active",
};
const PRINCIPAL: Principal = { id: "u1", displayName: "alice", email: "alice", role: "USER" };

describe("http client", () => {
  it("sends credentials, the client header on writes, and maps errors", async () => {
    const f = fakeFetch({
      "POST /api/x": () => json({ ok: true }),
      "GET /api/missing": () => json({ error: "not_found", message: "Không tìm thấy." }, 404),
    });
    const client = createApiClient({ fetch: f.fn, base: "" });
    expect(await client.post("/api/x", { a: 1 })).toEqual({ ok: true });
    expect(f.calls[0].headers["x-contoso-client"]).toBe("web");
    expect(f.calls[0].body).toEqual({ a: 1 });
    await expect(client.get("/api/missing")).rejects.toMatchObject({ status: 404, code: "notFound" });
    const err = (await client.get("/api/missing").catch((e: unknown) => e)) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(String(err.message)).not.toContain("Không tìm thấy");
  });
});

describe("auth", () => {
  it("keeps a newer login when an earlier restore response arrives late", async () => {
    let finish!: (response: Response) => void;
    const f = fakeFetch({
      "GET /api/auth/me": () => new Promise<Response>((resolve) => { finish = resolve; }),
      "POST /api/auth/login": () => json({ ...ME, id: "bob", username: "bob" }),
      "GET /api/me/preferences": () => json({}),
    });
    const session = createSessionStore();
    const auth = createApiAuth(createApiClient({ fetch: f.fn }), session, () => new Date());
    const restoring = auth.restore();
    await auth.login("bob", "pw");
    finish(json(ME));
    await restoring;
    expect(session.principal?.id).toBe("bob");
  });

  it("does not expire a new login for a previous account's delayed 401", async () => {
    let finish!: (response: Response) => void;
    const f = fakeFetch({
      "POST /api/auth/login": (c) => json({ ...ME, id: (c.body as { username: string }).username }),
      "GET /api/me/preferences": () => json({}),
      "GET /api/notifications": () => new Promise<Response>((resolve) => { finish = resolve; }),
    });
    const services = createApiHybridServices({ fetch: f.fn, eventSource: (url) => new FakeEventSource(url) });
    await services.auth!.login("alice", "pw");
    const expired = vi.fn();
    services.auth!.onExpired!(expired);
    const old = services.notifications!.list("alice");
    await services.auth!.login("bob", "pw");
    finish(json({ error: "unauthenticated" }, 401));
    await old;
    expect(expired).not.toHaveBeenCalled();
  });

  it("rejects adoption when its preference request reveals an expired cookie", async () => {
    const f = fakeFetch({
      "POST /api/auth/login": () => json(ME),
      "GET /api/me/preferences": () => json({ error: "unauthenticated" }, 401),
    });
    const services = createApiHybridServices({ fetch: f.fn, eventSource: (url) => new FakeEventSource(url) });
    expect((await services.auth!.login("alice", "pw")).data).toBeUndefined();
  });

  it("ends the adopted session when an authenticated feature receives 401", async () => {
    const f = fakeFetch({
      "POST /api/auth/login": () => json(ME),
      "GET /api/me/preferences": () => json({}),
      "GET /api/notifications": () => json({ error: "unauthenticated" }, 401),
    });
    const services = createApiHybridServices({ fetch: f.fn, eventSource: (url) => new FakeEventSource(url) });
    await services.auth!.login("alice", "pw");
    const expired = vi.fn();
    const auth = services.auth as typeof services.auth & { onExpired?: (fn: () => void) => () => void };
    const stop = auth!.onExpired?.(expired);
    await services.notifications!.list("u1");
    expect(expired).toHaveBeenCalledOnce();
    stop?.();
  });

  it("loads demo options and adopts the backend admin session", async () => {
    const f = fakeFetch({
      "GET /api/auth/demo/options": () => json({ available: ["admin", "alice"] }),
      "POST /api/auth/demo/admin": () => json({ ...ME, username: "admin-demo", role: "admin", domain: null }),
      "POST /api/auth/demo-login": (call) => json({ ...ME, username: (call.body as { profile: string }).profile }),
    });
    const session = createSessionStore();
    const realtime = { restart: vi.fn() };
    const auth = createApiAuth(createApiClient({ fetch: f.fn }), session, () => new Date(), realtime);
    expect((await auth.demoOptions()).data).toEqual({ available: ["admin", "alice"] });
    const quick = await auth.loginDemo("alice");
    expect(quick.data?.principal.email).toBe("alice");
    expect(f.calls.find((call) => call.url === "/api/auth/demo-login")?.body).toEqual({ profile: "alice" });
    const result = await auth.loginAdminDemo();
    expect(result.data?.principal.role).toBe("ADMIN");
    expect(session.principal?.email).toBe("admin-demo");
    expect(realtime.restart).toHaveBeenCalledTimes(2);
    expect(f.calls.at(-1)?.headers["x-contoso-client"]).toBe("web");
  });

  it("maps Me onto the frontend session and caches preferences", async () => {
    const f = fakeFetch({
      "POST /api/auth/login": (c) => (c.body as { username: string }).username === "alice"
        ? json(ME) : json({ error: "invalid_credentials", message: "x" }, 401),
      "GET /api/auth/me": () => json(ME),
      "POST /api/auth/logout": () => new Response(null, { status: 204 }),
      "GET /api/me/preferences": () => json({ displayName: "", locale: "en", theme: "dark",
        timezone: "Asia/Ho_Chi_Minh", motion: "system", density: "compact",
        notifications: { reports: true, tasks: true, system: false },
        semanticExplanation: false }),
    });
    const client = createApiClient({ fetch: f.fn, base: "" });
    const session = createSessionStore();
    const auth = createApiAuth(client, session, () => new Date("2026-10-17T00:00:00Z"));
    const bad = await auth.login("bob", "x");
    expect(bad.error?.code).toBe("credentials");
    const ok = await auth.login("  Alice ", "pw");
    expect(f.calls.filter((c) => c.url.endsWith("/api/auth/login")).at(-1)?.body)
      .toEqual({ username: "alice", password: "pw" });
    expect(ok.data?.principal).toEqual(PRINCIPAL); // empty display name shows the username
    expect(Date.parse(ok.data!.expiresAt)).toBeGreaterThan(Date.parse("2026-10-17T00:00:00Z"));
    expect(session.domain).toEqual(ME.domain);
    expect(session.preferences?.theme).toBe("dark");
    expect((await auth.restore()).data?.principal.id).toBe("u1");
    auth.logout();
    await Promise.resolve();
    expect(f.calls.some((c) => c.method === "POST" && c.url.endsWith("/api/auth/logout"))).toBe(true);
    expect(session.preferences).toBeNull();
    expect(auth.demoAccounts).toEqual([]);
  });

  it("restarts the stream after a login and after the logout request finished", async () => {
    let finishLogout: (r: Response) => void = () => undefined;
    const f = fakeFetch({
      "POST /api/auth/login": () => json(ME),
      "POST /api/auth/logout": () => new Promise<Response>((r) => { finishLogout = r; }),
      "GET /api/me/preferences": () => json({ error: "not_found" }, 404),
    });
    const realtime = { restart: vi.fn() };
    const auth = createApiAuth(createApiClient({ fetch: f.fn, base: "" }), createSessionStore(),
      () => new Date(), realtime);
    await auth.login("alice", "pw");
    expect(realtime.restart).toHaveBeenCalledTimes(1);
    auth.logout();
    await Promise.resolve();
    // still the old session server-side: reopening now would bind the stream to it again
    expect(realtime.restart).toHaveBeenCalledTimes(1);
    finishLogout(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(realtime.restart).toHaveBeenCalledTimes(2));
  });

  it("restore without a session is anonymous, an admin maps to ADMIN", async () => {
    const anon = fakeFetch({ "GET /api/auth/me": () => json({ error: "unauthenticated" }, 401) });
    const a = createApiAuth(createApiClient({ fetch: anon.fn, base: "" }), createSessionStore(),
      () => new Date());
    expect(await a.restore()).toEqual({ data: null });
    const admin = fakeFetch({ "GET /api/auth/me": () => json({ ...ME, role: "admin",
      display_name: "Quản trị", domain: null }) });
    const b = createApiAuth(createApiClient({ fetch: admin.fn, base: "" }), createSessionStore(),
      () => new Date());
    expect((await b.restore()).data?.principal).toEqual({ id: "u1", displayName: "Quản trị",
      email: "alice", role: "ADMIN" });
  });
});

describe("preferences", () => {
  it("loads from the session cache and saves through the API", async () => {
    const f = fakeFetch({ "PUT /api/me/preferences": (c) => json(c.body) });
    const session = createSessionStore();
    const prefs = createApiPreferences(createApiClient({ fetch: f.fn, base: "" }), session);
    const fallback = prefs.load("u1", "alice");
    expect(fallback.displayName).toBe("alice");
    const saved = await prefs.save("u1", { ...fallback, theme: "dark" });
    expect(saved.data?.theme).toBe("dark");
    expect(prefs.load("u1", "alice").theme).toBe("dark");
    expect((await prefs.save("u1", { ...fallback, theme: "neon" as never })).error?.code).toBe("invalid");
    expect(prefs.degraded).toBe(false);
  });
});

class FakeEventSource implements EventSourceLike {
  static last: FakeEventSource;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  closed = false;
  readyState = 0;
  constructor(public url: string) { FakeEventSource.last = this; }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() { this.closed = true; this.readyState = 2; }
  fail() {
    // a non-200 (the401 before login): the browser closes the connection for good
    this.readyState = 2;
    for (const fn of this.listeners.get("error") ?? []) fn(new MessageEvent("error"));
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
const quietStream = () => createRealtime("/api/stream", (url) => new FakeEventSource(url));

describe("realtime", () => {
  it("recreates the source after a fatal close (the pre-login 401) and keeps delivering", () => {
    vi.useFakeTimers();
    try {
      const sources: FakeEventSource[] = [];
      const realtime = createRealtime("/api/stream", (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      }, 5);
      const seen: unknown[] = [];
      realtime.on("message.created", (d) => seen.push(d));
      expect(sources).toHaveLength(1);
      sources[0].fail();
      expect(sources).toHaveLength(1);
      vi.advanceTimersByTime(10);
      expect(sources).toHaveLength(2);
      sources[1].emit("message.created", { id: 1 });
      expect(seen).toEqual([{ id: 1 }]);
      realtime.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restart drops the old user's stream and reopens one, keeping listeners and counting a reconnect", () => {
    const sources: FakeEventSource[] = [];
    const realtime = createRealtime("/api/stream", (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    });
    const seen: unknown[] = [];
    const opens: unknown[] = [];
    realtime.on("message.created", (d) => seen.push(d));
    realtime.on("open", (n) => opens.push(n));
    sources[0].emit("open", {});
    realtime.restart(); // logout → login as another user in the same tab
    expect(sources).toHaveLength(2);
    expect(sources[0].closed).toBe(true);
    sources[0].emit("message.created", { id: "old" }); // a late frame from the closed stream
    sources[1].emit("open", {});
    sources[1].emit("message.created", { id: 2 });
    expect(seen).toEqual([{ id: 2 }]);
    expect(opens).toEqual([1, 2]); // > 1: subscribers re-read their data
    realtime.stop();
  });
});

const NOTE = {
  id: "n1", kind: "report-ready", title: { vi: "Báo cáo", en: "Report" },
  summary: { vi: "R1", en: "R1" }, occurredAt: "2026-10-17T01:00:00+00:00", readAt: null,
  target: { kind: "report", reportId: "R1", versionId: "R1-v1" }, access: "available",
};

describe("notifications", () => {
  it("keeps realtime notifications in the current account only", async () => {
    const f = fakeFetch({ "GET /api/notifications": () => json([NOTE]) });
    const realtime = quietStream();
    const n = createApiNotifications(createApiClient({ fetch: f.fn }), realtime, () => new Date());
    const stop = n.subscribe(() => undefined);
    await n.list("alice");
    await n.list("bob");
    FakeEventSource.last.emit("notification.created", { ...NOTE, id: "bob-private" });
    expect(n.snapshot("alice").some((item) => item.id === "bob-private")).toBe(false);
    expect(n.snapshot("bob").some((item) => item.id === "bob-private")).toBe(true);
    stop();
    realtime.stop();
  });

  it("discards an old account's response after the active scope changes", async () => {
    let resolveAlice!: (response: Response) => void;
    let reads = 0;
    const f = fakeFetch({ "GET /api/notifications": () => ++reads === 1
      ? new Promise<Response>((resolve) => { resolveAlice = resolve; }) : json([]) });
    const realtime = quietStream();
    const n = createApiNotifications(createApiClient({ fetch: f.fn }), realtime, () => new Date());
    const alice = n.list("alice");
    await n.list("bob");
    resolveAlice(json([{ ...NOTE, id: "alice-private" }]));
    await alice;
    expect(n.snapshot("alice")).toHaveLength(0);
    expect(n.snapshot("bob")).toHaveLength(0);
    realtime.stop();
  });

  it("returns a stable snapshot (useSyncExternalStore re-renders forever otherwise)", () => {
    const realtime = createRealtime("/api/stream", (url) => new FakeEventSource(url));
    const n = createApiNotifications(createApiClient({ fetch: fakeFetch({}).fn, base: "" }),
      realtime, () => new Date());
    expect(n.snapshot("u1")).toBe(n.snapshot("u1"));
  });

  it("lists, marks read optimistically, rolls back and follows SSE", async () => {
    let failRead = false;
    const f = fakeFetch({
      "GET /api/notifications": () => json([NOTE]),
      "POST /api/notifications/read": () => failRead
        ? json({ error: "x" }, 500) : json([{ ...NOTE, readAt: "2026-10-17T02:00:00+00:00" }]),
    });
    const realtime = createRealtime("/api/stream", (url) => new FakeEventSource(url));
    const n = createApiNotifications(createApiClient({ fetch: f.fn, base: "" }), realtime,
      () => new Date("2026-10-17T02:00:00Z"));
    const changes = vi.fn();
    const unsubscribe = n.subscribe(changes);
    expect((await n.list("u1")).data).toHaveLength(1);
    failRead = true;
    const failed = await n.markRead("u1", "n1");
    expect(failed.error).toBeDefined();
    expect(n.snapshot("u1")[0].readAt).toBeNull(); // rolled back
    failRead = false;
    expect((await n.markRead("u1")).data?.[0].readAt).toBeTruthy();
    expect(f.calls.at(-1)?.body).toEqual({});
    FakeEventSource.last.emit("notification.created", { ...NOTE, id: "n2" });
    expect(n.snapshot("u1").map((x) => x.id)).toEqual(["n2", "n1"]);
    FakeEventSource.last.emit("notification.read", { ids: ["n2"] });
    expect(n.snapshot("u1")[0].readAt).toBeTruthy();
    expect(changes).toHaveBeenCalled();
    unsubscribe();
  });
});

const VERSION = {
  schema: { schemaVersion: 1, reportId: "R1", versionId: "R1-v1", reportTypeId: "unit-analysis",
    title: "Phân tích", limitations: [], dashboard: [], sections: [], diagnostics: [] },
  id: "R1-v1", reportId: "R1", sequence: 1, completedAt: "2026-09-05T03:00:00+00:00",
  source: { id: "warehouse", mode: "api", label: "Kho", dataThrough: "2026-06-30T00:00:00+00:00",
    updatedAt: "2026-09-05T03:00:00+00:00", completeness: "full" },
  policyVersion: "p1", contentRevision: "c1", sections: [], evidenceIds: [], artifactIds: ["a1"],
};
const RECORD = { id: "R1", code: "R1", title: "Phân tích", type: "unit-analysis",
  projectIds: ["MAS"], marketIds: [], author: { id: "u1", name: "alice" }, agent: "report",
  createdAt: "2026-09-01T03:00:00+00:00", versionIds: ["R1-v1"], latestAttemptId: null };
const SUMMARY = { record: RECORD, status: "completed", latestVersion: VERSION,
  matchedVersion: VERSION, latestAttempt: null };

describe("reports", () => {
  const routes = {
    "GET /api/reports": () => json({ rows: [SUMMARY], totalRows: 1, page: 1, pageSize: 25, pageCount: 1 }),
    "GET /api/reports/R1": () => json({ summary: SUMMARY, version: VERSION, versions: [VERSION],
      evidence: [], artifacts: [{ id: "a1", versionId: "R1-v1", filename: "r.pdf",
        mediaType: "application/pdf" }] }),
    "GET /api/reports/R1/versions/R1-v1/artifacts/a1": () => new Response(new Blob(["%PDF"]), {
      status: 200, headers: { "Content-Type": "application/pdf" } }),
    "GET /api/reports/summary": () => json({ distinctReports: 1, completedVersions: 1,
      source: VERSION.source }),
    "GET /api/reports/recent": () => json([SUMMARY]),
    "GET /api/reports/catalog": () => json({ reportTypes: [], projects: [], authors: [],
      agents: [], defaultScope: { from: "2026-09-01", to: "2026-10-01", timezone: "Asia/Ho_Chi_Minh" } }),
  };

  it("hands report.updated from the stream to re-readers", async () => {
    const f = fakeFetch(routes);
    const realtime = createRealtime("/api/stream", (url) => new FakeEventSource(url));
    const reports = createApiReports(createApiClient({ fetch: f.fn, base: "" }), createReportTargets(), realtime);
    const seen: string[] = [];
    const stop = reports.onChanged((id) => seen.push(id));
    FakeEventSource.last.emit("report.updated", { report_id: "R7", status: "ready", version_id: "R7-v1" });
    expect(seen).toEqual(["R7"]);
    stop();
    FakeEventSource.last.emit("report.updated", { report_id: "R8", status: "ready" });
    expect(seen).toEqual(["R7"]);
  });

  it("passes queries through and decodes versions", async () => {
    const f = fakeFetch(routes);
    const targets = createReportTargets();
    const reports = createApiReports(createApiClient({ fetch: f.fn, base: "" }), targets, quietStream());
    const page = await reports.list(PRINCIPAL, { q: "phân", types: ["a", "b"], statuses: [],
      markets: [], projects: ["MAS"], authors: [], agents: [], dateField: "completedAt",
      from: "2026-09-01", to: "2026-10-01", timezone: "Asia/Ho_Chi_Minh", sort: "title",
      direction: "asc", page: 1, pageSize: 25 });
    expect(page.data?.rows[0].record.id).toBe("R1");
    const url = new URL(f.calls[0].url, "http://x");
    expect(url.searchParams.getAll("type")).toEqual(["a", "b"]);
    expect(url.searchParams.get("dateField")).toBe("completedAt");
    expect(url.searchParams.get("project")).toBe("MAS");
    expect(targets.hasReport("R1")).toBe(true); // learnt from the list
    expect(targets.hasReport("R2")).toBe(false);
    const detail = await reports.detail(PRINCIPAL, "R1");
    expect(detail.data?.version?.schema?.versionId).toBe("R1-v1");
    const download = await reports.download(PRINCIPAL, "R1", "R1-v1", "a1");
    expect(download.data?.filename).toBe("r.pdf");
    expect(download.data?.mediaType).toBe("application/pdf");
    expect(download.data?.content).toBeInstanceOf(Blob);
    expect(download.data?.sourceMode).toBe("api");
    expect((await reports.summarize(PRINCIPAL, { from: "2026-09-01", to: "2026-10-01",
      timezone: "Asia/Ho_Chi_Minh" })).data?.completedVersions).toBe(1);
    expect((await reports.recent(PRINCIPAL, { from: "2026-09-01", to: "2026-10-01",
      timezone: "Asia/Ho_Chi_Minh" }, 5)).data).toHaveLength(1);
    expect((await reports.catalog(PRINCIPAL)).data?.defaultScope.timezone).toBe("Asia/Ho_Chi_Minh");
  });

  it("rejects a version with the wrong identity", async () => {
    const f = fakeFetch({ ...routes, "GET /api/reports/R1": () => json({ summary: SUMMARY,
      version: { ...VERSION, schema: { ...VERSION.schema, versionId: "R1-v9" } }, versions: [],
      evidence: [], artifacts: [] }) });
    const reports = createApiReports(createApiClient({ fetch: f.fn, base: "" }), createReportTargets(), quietStream());
    expect((await reports.detail(PRINCIPAL, "R1")).error?.code).toBe("validation");
  });

  it("keeps the list readable when one stored version fails to decode", async () => {
    // Observed live: `source.dataThrough` landed after `completedAt` for an agent-published
    // version, `decodeReportVersion` rejected it, and because `list` decodes every row at once
    // the whole library rendered "Chưa đọc được báo cáo". One bad row must degrade alone.
    const stale = { ...VERSION, source: { ...VERSION.source, dataThrough: "2026-09-06T00:00:00+00:00" } };
    const good = { ...VERSION, id: "R2-v1", reportId: "R2",
      schema: { ...VERSION.schema, reportId: "R2", versionId: "R2-v1" } };
    const f = fakeFetch({ ...routes, "GET /api/reports": () => json({ rows: [
      { record: { ...RECORD, id: "R1" }, status: "completed", latestVersion: stale,
        matchedVersion: null, latestAttempt: null },
      { record: { ...RECORD, id: "R2", code: "R2", versionIds: ["R2-v1"] }, status: "completed",
        latestVersion: good, matchedVersion: null, latestAttempt: null },
    ], totalRows: 2, page: 1, pageSize: 25, pageCount: 1 }) });
    const reports = createApiReports(createApiClient({ fetch: f.fn, base: "" }), createReportTargets(),
      quietStream());
    const page = await reports.list(PRINCIPAL, { q: "", types: [], statuses: [], markets: [],
      projects: [], authors: [], agents: [], dateField: "createdAt", from: "2026-09-01",
      to: "2026-10-01", timezone: "Asia/Ho_Chi_Minh", sort: "createdAt", direction: "desc",
      page: 1, pageSize: 25 });
    expect(page.error).toBeUndefined();
    expect(page.data?.rows).toHaveLength(2);
    const [bad, ok] = page.data!.rows;
    expect(bad.record.id).toBe("R1");
    expect(bad.latestVersion?.schemaIssue).toBeTruthy();
    expect(bad.latestVersion?.schema).toBeUndefined();
    expect(ok.latestVersion?.schemaIssue).toBeUndefined();
    expect(ok.latestVersion?.schema?.versionId).toBe("R2-v1");
  });

  it("admins are refused locally", async () => {
    const reports = createApiReports(createApiClient({ fetch: fakeFetch({}).fn, base: "" }),
      createReportTargets(), quietStream());
    const admin = { ...PRINCIPAL, role: "ADMIN" as const };
    expect((await reports.catalog(admin)).error?.code).toBe("forbidden");
  });
});

const DATASET = {
  businessTimezone: "Asia/Ho_Chi_Minh",
  projects: [{ id: "MAS", name: "Riverstone", marketId: "hn", marketLabel: "Hà Nội", sourceId: "w" }],
  snapshots: [], transactions: [], tasks: [],
  transactionSource: VERSION.source, taskSource: VERSION.source, coveredDates: [],
};

describe("dashboard", () => {
  it("computes the overview in the browser from the dataset", async () => {
    const f = fakeFetch({
      "GET /api/dashboard/dataset": () => json({ dataset: DATASET, publishedAt: "2026-10-17T00:00:00Z" }),
      "GET /api/reports/summary": () => json({ distinctReports: 0, completedVersions: 0, source: VERSION.source }),
      "GET /api/reports/recent": () => json([]),
      "GET /api/reports/catalog": () => json({ reportTypes: [], projects: DATASET.projects,
        authors: [], agents: [], defaultScope: { from: "2026-09-01", to: "2026-10-01", timezone: "Asia/Ho_Chi_Minh" } }),
    });
    const client = createApiClient({ fetch: f.fn, base: "" });
    const reports = createApiReports(client, createReportTargets(), quietStream());
    const dashboard = createApiDashboard(client, reports, () => new Date("2026-10-17T00:00:00Z"));
    const scope = { from: "2026-09-01", to: "2026-10-01", timezone: "Asia/Ho_Chi_Minh" };
    const overview = await dashboard.overview(PRINCIPAL, scope);
    expect(overview.data?.reports.state).toBe("ready");
    expect(overview.data?.tasks.state).toBe("ready");
    const page = await dashboard.breakdown(PRINCIPAL, "tasks", scope, { page: 1, pageSize: 25, taskState: "all" });
    expect(page.data?.totalRows).toBe(0);
    expect(f.calls.filter((c) => c.url.includes("/api/dashboard/dataset"))).toHaveLength(1); // cached per scope
  });

  it("an empty dataset still gives a valid overview", async () => {
    const f = fakeFetch({
      "GET /api/dashboard/dataset": () => json({ dataset: null, publishedAt: null }),
      "GET /api/reports/summary": () => json({ distinctReports: 0, completedVersions: 0, source: VERSION.source }),
      "GET /api/reports/recent": () => json([]),
    });
    const client = createApiClient({ fetch: f.fn, base: "" });
    const dashboard = createApiDashboard(client, createApiReports(client, createReportTargets(), quietStream()), () => new Date());
    const overview = await dashboard.overview(PRINCIPAL, { from: "2026-09-01", to: "2026-10-01", timezone: "Asia/Ho_Chi_Minh" });
    expect(overview.data).toBeDefined();
  });
});

describe("admin users", () => {
  const ADMIN: Principal = { id: "a1", displayName: "Admin", email: "admin", role: "ADMIN" };
  const USERS = [
    { id: "u1", username: "alice", display_name: "Alice", role: "user", status: "active",
      status_detail: null, created_at: "2026-10-01T00:00:00+00:00", domain: null },
    { id: "u2", username: "bob", display_name: "", role: "user", status: "disabled",
      status_detail: null, created_at: "2026-10-02T00:00:00+00:00", domain: null },
  ];

  it("maps users, pages locally and patches the status", async () => {
    const f = fakeFetch({
      "GET /api/admin/users": () => json(USERS),
      "PATCH /api/admin/users/u1": () => json({ ...USERS[0], status: "disabled" }),
    });
    const admin = createApiAdminUsers(createApiClient({ fetch: f.fn, base: "" }));
    const page = await admin.list(ADMIN, { q: "", statuses: ["disabled"], sort: "name",
      direction: "asc", page: 1, pageSize: 25 });
    expect(page.data?.rows).toEqual([{ id: "u2", name: "bob", email: "bob", role: "USER",
      status: "disabled", createdAt: "2026-10-02T00:00:00+00:00", lastActiveAt: null, revision: 1 }]);
    const detail = await admin.detail(ADMIN, "u1");
    expect(detail.data?.user.name).toBe("Alice");
    const result = await admin.changeStatus(ADMIN, { userId: "u1", targetStatus: "disabled",
      expectedRevision: 1, operationId: "op1" });
    expect(f.calls.at(-1)?.body).toEqual({ disabled: true });
    expect(result.data?.user.status).toBe("disabled");
    expect(result.data?.sourceMode).toBe("api");
    expect((await admin.reset(ADMIN)).error?.code).toBe("unsupported");
    const user = { ...ADMIN, role: "USER" as const };
    expect((await admin.list(user, { q: "", statuses: [], sort: "name", direction: "asc",
      page: 1, pageSize: 25 })).error?.code).toBe("forbidden");
  });
});

describe("composition", () => {
  it("hybrid mode replaces auth, preferences, notifications and workspace services", () => {
    const f = fakeFetch({});
    const services = createServices("hybrid", {
      hybrid: () => createApiHybridServices({ fetch: f.fn, base: "",
        eventSource: (url) => new FakeEventSource(url) }),
    });
    expect(services.auth.demoAccounts).toEqual([]);
    expect(services.reportTargets.hasReport("R1")).toBe(false);
    expect(typeof (services.workspace.reports as { list: unknown }).list).toBe("function");
  });
});
