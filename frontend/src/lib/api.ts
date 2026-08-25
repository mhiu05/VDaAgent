import { parseSseChunk, type SseEvent } from "@/lib/sse";
import type {
  Dataset,
  DriftResponse,
  Profile,
  ProfilingJob,
  ProfileRunSummary,
  ProposalDecisionType,
  QAResponse,
  TestResponse,
  TestResult,
  UploadResult,
} from "@/lib/types";
import type { AnalysisExecution, AnalysisSession, AutoChartPlan, AutoProfilePack, ChartSpec, ForecastAlgorithmCapability, QuerySpec } from "@/lib/analysis-types";

const configuredApiBase = process.env.NEXT_PUBLIC_API_URL;

type AuthTransport = {
  accessToken: () => Promise<string | null>;
  workspaceId: () => string | null;
  refresh: () => Promise<string | null>;
};

let authTransport: AuthTransport | null = null;

/** Installed by AuthProvider; keeping transport here makes every API path use
 * the same token/workspace policy, including SSE, XHR and downloads. */
export function setApiAuthTransport(next: AuthTransport | null) {
  authTransport = next;
}

export type QAHistoryMessage = { role: "user" | "agent"; text: string };

function apiBase(): string {
  if (configuredApiBase) return configuredApiBase.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
  }
  return "http://localhost:8000/api/v1";
}

function apiBaseCandidates(): string[] {
  const candidates = [apiBase()];
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost") candidates.push(`${window.location.protocol}//127.0.0.1:8000/api/v1`);
    if (hostname === "127.0.0.1") candidates.push(`${window.location.protocol}//localhost:8000/api/v1`);
  }
  return [...new Set(candidates)];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly correlationId?: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(response: Response): Promise<ApiError> {
  const correlationId = response.headers.get("x-correlation-id");
  let message = `Yêu cầu không thành công (${response.status}).`;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body && "detail" in body) {
      const detail = (body as { detail?: unknown }).detail;
      message = typeof detail === "string" ? detail : JSON.stringify(detail);
    }
  } catch {
    // The HTTP status is still safe, useful feedback for the analyst.
  }
  return new ApiError(message, response.status, correlationId);
}

async function authHeaders(headers?: HeadersInit): Promise<Headers> {
  const next = new Headers(headers);
  next.set("Accept", next.get("Accept") ?? "application/json");
  const token = await authTransport?.accessToken();
  const workspaceId = authTransport?.workspaceId();
  if (token) next.set("Authorization", `Bearer ${token}`);
  if (workspaceId) next.set("X-Workspace-Id", workspaceId);
  return next;
}

async function fetchWithLocalFallback(path: string, init: RequestInit): Promise<Response> {
  let lastConnectionError: unknown;
  // `localhost` can resolve to a different loopback protocol on Windows.
  // Give every fetch request the same 127.0.0.1 fallback already used by XHR
  // uploads, but never retry an HTTP response (including 4xx/5xx responses).
  for (const baseUrl of apiBaseCandidates()) {
    try {
      return await fetch(`${baseUrl}${path}`, init);
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") throw reason;
      lastConnectionError = reason;
    }
  }
  throw lastConnectionError;
}

/** Fetch an auth-boundary request using the same loopback fallback as API calls. */
export function fetchApiWithLocalFallback(path: string, init: RequestInit): Promise<Response> {
  return fetchWithLocalFallback(path, init);
}

async function apiFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  let response: Response;
  const headers = await authHeaders(init.headers);
  try {
    response = await fetchWithLocalFallback(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (reason) {
    // Preserve cancellations used by page transitions and explicit aborts.
    if (reason instanceof Error && reason.name === "AbortError") throw reason;
    throw new ApiError(
      "Không thể kết nối tới backend. Hãy kiểm tra backend đang chạy và thử lại.",
      0,
    );
  }
  if (response.status === 401 && !retried && authTransport) {
    const previousToken = headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const refreshed = await authTransport.refresh();
    if (refreshed && refreshed !== previousToken) return apiFetch(path, init, true);
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await readError(response);
  return response.json() as Promise<T>;
}

export function listDatasets(signal?: AbortSignal): Promise<Dataset[]> {
  return request<Dataset[]>("/datasets", { signal });
}

export type GoogleDriveStatus = {
  provider: "supabase" | "google_drive" | "local";
  configured: boolean;
  connected: boolean;
  folder_id: string | null;
  can_connect: boolean;
};

export function getGoogleDriveStatus(): Promise<GoogleDriveStatus> {
  return request<GoogleDriveStatus>("/google-drive/status");
}

export function disconnectGoogleDrive(): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>("/google-drive/connection", { method: "DELETE" });
}

export async function connectGoogleDrive(targetWindow?: Window | null): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const authorization = request<{ authorization_url: string }>("/google-drive/connect");
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ApiError("API khÃ´ng tráº£ link Google trong 15 giÃ¢y.", 0)), 15_000);
  });
  let payload: { authorization_url: string };
  try {
    payload = await Promise.race([authorization, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  if (targetWindow && !targetWindow.closed) {
    targetWindow.location.replace(payload.authorization_url);
    return;
  }
  const opened = window.open(payload.authorization_url, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new ApiError("Trình duyệt đã chặn tab Google mới. Hãy cho phép popup rồi thử lại.", 0);
  }
}

export type CalendarStatus = {
  provider: 'google_calendar';
  configured: boolean;
  connected: boolean;
  calendar_id: string | null;
  can_connect: boolean;
};

export type CalendarEvent = {
  id: string;
  status: string | null;
  summary: string;
  description: string;
  location: string;
  html_link: string | null;
  start: string | null;
  end: string | null;
  time_zone: string | null;
  attendees: Array<{ email: string; response_status: string | null }>;
};

export function getCalendarStatus(): Promise<CalendarStatus> {
  return request<CalendarStatus>('/calendar/status');
}

export async function connectGoogleCalendar(targetWindow?: Window | null): Promise<void> {
  const payload = await request<{ authorization_url: string }>('/calendar/connect');
  if (targetWindow && !targetWindow.closed) {
    targetWindow.location.replace(payload.authorization_url);
    return;
  }
  const opened = window.open(payload.authorization_url, '_blank', 'noopener,noreferrer');
  if (!opened) throw new ApiError('Trình duyệt đã chặn tab Google mới.', 0);
}

export function listCalendarEvents(params: { timeMin?: string; timeMax?: string; limit?: number } = {}): Promise<{ events: CalendarEvent[] }> {
  const query = new URLSearchParams();
  if (params.timeMin) query.set('time_min', params.timeMin);
  if (params.timeMax) query.set('time_max', params.timeMax);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? '?' + query.toString() : '';
  return request<{ events: CalendarEvent[] }>('/calendar/events' + suffix);
}

export function createCalendarEvent(payload: {
  summary: string;
  start: string;
  end: string;
  time_zone: string;
  description?: string;
  location?: string;
  attendees?: string[];
}): Promise<{ event: CalendarEvent }> {
  return request<{ event: CalendarEvent }>('/calendar/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteCalendarEvent(eventId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>('/calendar/events/' + encodeURIComponent(eventId), { method: 'DELETE' });
}

export function getDashboard<T>(): Promise<T> {
  return request<T>("/dashboard");
}

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
  status?: string;
  created_by_user_id?: string;
  is_project?: boolean;
};

export function listWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }> {
  return request<{ workspaces: WorkspaceSummary[] }>("/workspaces");
}

export function listArchivedWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }> {
  return request<{ workspaces: WorkspaceSummary[] }>("/workspaces/archived");
}

export type WorkspaceContextInput = { domain?: string; primary_goal?: string; target_audience?: string };
export type WorkspaceThemeInput = { primary_color?: string; secondary_color?: string; tone?: "concise" | "professional" | "friendly"; default_language?: "vi" | "en" };
export type WorkspaceConfiguration = {
  context: (WorkspaceContextInput & { id: string; version: number; status: string }) | null;
  theme: (WorkspaceThemeInput & { id: string; version: number; status: string }) | null;
};

export function createWorkspace(input: string | { name: string; context?: WorkspaceContextInput; theme?: WorkspaceThemeInput }): Promise<WorkspaceSummary> {
  const payload = typeof input === "string" ? { name: input } : input;
  return request<WorkspaceSummary>("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getWorkspaceConfiguration(): Promise<WorkspaceConfiguration> {
  return request<WorkspaceConfiguration>("/workspaces/current/configuration");
}

export function updateWorkspaceConfiguration(payload: {
  context?: WorkspaceContextInput;
  theme?: WorkspaceThemeInput;
  expected_context_version?: number;
  expected_theme_version?: number;
}): Promise<WorkspaceConfiguration> {
  return request<WorkspaceConfiguration>("/workspaces/current/configuration", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}

export function deleteWorkspace(workspaceId: string): Promise<{ deleted: boolean; workspace_id: string }> {
  return request<{ deleted: boolean; workspace_id: string }>(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
  });
}

export function purgeWorkspace(workspaceId: string): Promise<{ deleted: boolean; workspace_id: string }> {
  return request<{ deleted: boolean; workspace_id: string }>(`/workspaces/${encodeURIComponent(workspaceId)}/permanent`, {
    method: "DELETE",
  });
}

export function restoreWorkspace(workspaceId: string): Promise<{ restored: boolean; workspace_id: string }> {
  return request<{ restored: boolean; workspace_id: string }>(`/workspaces/${encodeURIComponent(workspaceId)}/restore`, {
    method: "POST",
  });
}

export type WorkspaceRole = "analyst";
export type WorkspaceMemberStatus = "active" | "suspended" | "removed";

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  role: WorkspaceRole;
  status: WorkspaceMemberStatus;
  created_at: string;
  updated_at: string;
};

export type WorkspaceInvitation = {
  id: string;
  workspace_id?: string;
  email: string;
  role: WorkspaceRole;
  status: "pending" | "accepted" | "cancelled" | string;
  expires_at: string;
  invited_by_user_id?: string;
  accepted_by_user_id?: string | null;
  created_at: string;
};

export function listWorkspaceMembers(): Promise<{ members: WorkspaceMember[] }> {
  return request<{ members: WorkspaceMember[] }>("/workspaces/current/members");
}

export function updateWorkspaceMember(
  userId: string,
  payload: Partial<Pick<WorkspaceMember, "role" | "status">>,
): Promise<WorkspaceMember> {
  return request<WorkspaceMember>(`/workspaces/current/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listWorkspaceInvitations(): Promise<{ invitations: WorkspaceInvitation[] }> {
  return request<{ invitations: WorkspaceInvitation[] }>("/workspaces/current/invitations");
}

export function inviteWorkspaceMember(payload: { email: string; role: WorkspaceRole }): Promise<WorkspaceInvitation> {
  return request<WorkspaceInvitation>("/workspaces/current/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function cancelWorkspaceInvitation(invitationId: string): Promise<{ cancelled: boolean }> {
  return request<{ cancelled: boolean }>(`/workspaces/current/invitations/${encodeURIComponent(invitationId)}`, {
    method: "DELETE",
  });
}

export type ActivityEntry = {
  ts: string;
  event: string;
  workspace_id?: string | null;
  actor_user_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  outcome?: string | null;
  [key: string]: unknown;
};

/** Audit events are already scoped to the workspace selected in the API session. */
export function listWorkspaceActivity(limit = 100): Promise<{ entries: ActivityEntry[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<{ entries: ActivityEntry[] }>(`/audit?${params.toString()}`);
}

export type SelfSignupRole = "analyst";

export async function provisionSelfSignup(role: SelfSignupRole, accessToken: string): Promise<{
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  role: SelfSignupRole;
  created: boolean;
}> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchWithLocalFallback("/onboarding/provision", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ role }),
      signal: controller.signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") {
      throw new ApiError("KhÃ´ng thá»ƒ táº¡o workspace trong 12 giÃ¢y. HÃ£y kiá»ƒm tra backend Ä‘ang cháº¡y.", 0);
    }
    throw reason;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function cleanupGuestSession(accessToken: string): Promise<void> {
  try {
    await fetchWithLocalFallback("/guest/session", {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      credentials: "include",
      keepalive: true,
    });
  } catch {
    // Cleanup is deliberately best-effort. A stale guest session must not
    // prevent the visitor from starting a fresh trial role.
  }
}

export function listPublishedReports<T>(): Promise<T> {
  return request<T>("/reports");
}

export function getPublishedReport<T>(reportId: string): Promise<T> {
  return request<T>(`/reports/${encodeURIComponent(reportId)}`);
}

export function reviewReport<T = unknown>(reportId: string, payload: { decision: "approved" | "changes_requested" | "rejected"; comment?: string }): Promise<T> {
  return request<T>(`/reports/${encodeURIComponent(reportId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function publishReport<T = unknown>(reportId: string, payload: { reason?: string } = {}): Promise<T> {
  return request<T>(`/reports/${encodeURIComponent(reportId)}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function createProfileReport<T = { id: string; status: string }>(runId: string): Promise<T> {
  return request<T>(`/profile/${encodeURIComponent(runId)}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function deleteReport(reportId: string): Promise<{ deleted: boolean; report_id: string }> {
  return request<{ deleted: boolean; report_id: string }>(`/reports/${encodeURIComponent(reportId)}`, {
    method: "DELETE",
  });
}

export function deleteDataset(datasetId: string): Promise<{ dataset_id: string; deleted_runs: number; deleted_file: boolean }> {
  return request<{ dataset_id: string; deleted_runs: number; deleted_file: boolean }>(`/datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE",
  });
}

export function setDatasetCollection(datasetIds: string[], collectionName: string): Promise<Dataset[]> {
  return request<Dataset[]>("/datasets/collection", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_ids: datasetIds, collection_name: collectionName }),
  });
}

export function listRuns(datasetId: string, signal?: AbortSignal): Promise<ProfileRunSummary[]> {
  return request<ProfileRunSummary[]>(`/datasets/${encodeURIComponent(datasetId)}/runs`, { signal });
}

export function getProfile(runId: string, signal?: AbortSignal): Promise<Profile> {
  // Profile state changes immediately after HITL review. Bypass the browser
  // HTTP cache so a reconciliation/refetch cannot resurrect pending proposals.
  return request<Profile>(`/profile/${encodeURIComponent(runId)}`, { signal, cache: "no-store" });
}

export function getProfilingJob(jobId: string, signal?: AbortSignal): Promise<ProfilingJob> {
  return request<ProfilingJob>(`/profiling-jobs/${encodeURIComponent(jobId)}`, { signal, cache: "no-store" });
}

function pollingDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForProfilingJob(
  jobId: string,
  signal?: AbortSignal,
  timeoutMs = 30 * 60_000,
): Promise<ProfilingJob> {
  const deadline = Date.now() + timeoutMs;
  let transientFailures = 0;
  while (Date.now() < deadline) {
    try {
      const job = await getProfilingJob(jobId, signal);
      transientFailures = 0;
      if (job.status === "succeeded") return job;
      if (job.status === "failed") {
        throw new ApiError(job.error?.message || "Profiling không hoàn thành.", 409);
      }
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") throw reason;
      if (!(reason instanceof ApiError) || (reason.status > 0 && reason.status < 500)) throw reason;
      transientFailures += 1;
      if (transientFailures > 5) throw reason;
    }
    await pollingDelay(2_500, signal);
  }
  throw new ApiError("Profiling vẫn đang xử lý. Bạn có thể mở lại profile để tiếp tục theo dõi.", 408);
}

export function createProfile(payload: {
  dataset_id?: string;
  dataset_ref?: string;
  dataset_name?: string;
  run_name?: string;
  scan_mode: "full" | "sample";
  sampling?: { strategy: "reservoir" | "tablesample"; sample_size?: number; random_seed?: number };
}, idempotencyKey = crypto.randomUUID()): Promise<ProfilingJob> {
  return request<ProfilingJob>("/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export function confirmProposals(
  runId: string,
  payload: {
    resume: boolean;
    action?: "confirm" | "edit" | "reject" | "request_test";
    test_requests?: Array<{ test_type: string; columns: string[]; params?: Record<string, unknown> }>;
    decisions?: Array<{
      kind: "candidate_key" | "semantic_type" | "pii";
      proposal_id: string;
      decision: ProposalDecisionType;
      final_type?: string;
      note?: string;
    }>;
  },
  idempotencyKey = crypto.randomUUID(),
): Promise<{ profile_run_id: string; applied: number; pending_proposals: number; status: string; narrative_report?: string | null; answer?: string | null; test_results?: TestResult[]; proposals?: Profile["proposals"] }> {
  return request<{ profile_run_id: string; applied: number; pending_proposals: number; status: string; narrative_report?: string | null; answer?: string | null; test_results?: TestResult[]; proposals?: Profile["proposals"] }>(`/profile/${encodeURIComponent(runId)}/confirm`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export function runTests(
  runId: string,
  payload: {
    tests: Array<{ test_type: string; columns: string[] }>;
    alpha?: number;
    fdr_method?: "benjamini_hochberg" | "bonferroni" | "none";
  },
): Promise<TestResponse> {
  return request<TestResponse>(`/profile/${encodeURIComponent(runId)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function detectDrift(runId: string, baselineRunId: string): Promise<DriftResponse> {
  return request<DriftResponse>(`/profile/${encodeURIComponent(runId)}/drift`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseline_run_id: baselineRunId }),
  });
}

export async function downloadExport(runId: string): Promise<Blob> {
  const response = await apiFetch(`/profile/${encodeURIComponent(runId)}/export`);
  if (!response.ok) throw await readError(response);
  return response.blob();
}

export type CombinedReportSection = "overview" | "technical_profile" | "quality" | "agent_summary" | "drift" | "analysis" | "report_snapshot";
export const ALL_COMBINED_REPORT_SECTIONS: CombinedReportSection[] = ["overview", "technical_profile", "quality", "agent_summary", "drift", "analysis", "report_snapshot"];

function reportSectionQuery(sections?: CombinedReportSection[], reportId?: string): string {
  const params = new URLSearchParams();
  if (sections?.length) params.set("sections", sections.join(","));
  if (reportId) params.set("reportId", reportId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function downloadCombinedReport(runId: string, sections?: CombinedReportSection[], reportId?: string): Promise<Blob> {
  const response = await fetch(`/api/reports/profile/${encodeURIComponent(runId)}${reportSectionQuery(sections, reportId)}`, {
    headers: await authHeaders({ Accept: "application/pdf" }),
    credentials: "include",
  });
  if (!response.ok) throw await readError(response);
  return response.blob();
}

/** Export a report through the bounded profile/report exporter. */
export function downloadPublishedReportPdf(runId: string, reportId: string): Promise<Blob> {
  return downloadCombinedReport(runId, ALL_COMBINED_REPORT_SECTIONS, reportId);
}

export async function downloadCombinedJson(runId: string, sections?: CombinedReportSection[]): Promise<Blob> {
  const response = await apiFetch(`/profile/${encodeURIComponent(runId)}/report${reportSectionQuery(sections)}`);
  if (!response.ok) throw await readError(response);
  return response.blob();
}

export function askQuestion(payload: { question: string; profile_run_id?: string; history?: QAHistoryMessage[] }): Promise<QAResponse> {
  return request<QAResponse>("/qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function streamQuestion(
  payload: {
    question: string;
    profile_run_id?: string;
    history?: QAHistoryMessage[];
    analysis_execution_id?: string;
    workspace_context_version_id?: string;
  },
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await apiFetch("/qa/stream", {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw await readError(response);
  if (!response.body) throw new ApiError("Trình duyệt không hỗ trợ streaming response.", 0);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const parsed = parseSseChunk(decoder.decode(value, { stream: true }), remainder);
      remainder = parsed.remainder;
      parsed.events.forEach(onEvent);
    }
    const final = parseSseChunk(decoder.decode(), remainder);
    final.events.forEach(onEvent);
  } finally {
    reader.releaseLock();
  }
}

function uploadDatasetOnce(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  baseUrl = apiBase(),
): Promise<UploadResult> {
  return (async () => {
    const headers = await authHeaders();
    return new Promise<UploadResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${baseUrl}/datasets/upload`);
    request.responseType = "json";
    request.withCredentials = true;
    headers.forEach((value, key) => request.setRequestHeader(key, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new ApiError("Không thể kết nối tới API.", 0));
    request.onabort = () => reject(new DOMException("Upload đã bị hủy.", "AbortError"));
    request.onload = () => {
      const body = request.response as { detail?: unknown } | UploadResult | null;
      if (request.status >= 200 && request.status < 300 && body) return resolve(body as UploadResult);
      const detail = body && "detail" in body ? body.detail : undefined;
      reject(new ApiError(typeof detail === "string" ? detail : `Upload thất bại (${request.status}).`, request.status));
    };
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    const formData = new FormData();
    formData.append("file", file);
    request.send(formData);
    });
  })();
}

export async function uploadDataset(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  try {
    return await uploadDatasetOnce(file, onProgress, signal);
  } catch (reason) {
    // XHR does not use apiFetch, so retry once after refreshing an expired
    // Supabase session just like the other API calls do.
    if (reason instanceof ApiError && reason.status === 401 && authTransport) {
      const previousToken = await authTransport.accessToken();
      const refreshed = await authTransport.refresh();
      if (refreshed && refreshed !== previousToken) return uploadDatasetOnce(file, onProgress, signal, apiBase());
      throw new ApiError("PhiÃªn Ä‘Äƒng nháº­p Ä‘Ã£ háº¿t háº¡n. HÃ£y Ä‘Äƒng nháº­p láº¡i.", 401);
    }
    if (reason instanceof ApiError && reason.status === 0) {
      for (const baseUrl of apiBaseCandidates().slice(1)) {
        try {
          return await uploadDatasetOnce(file, onProgress, signal, baseUrl);
        } catch (fallbackReason) {
          if (!(fallbackReason instanceof ApiError) || fallbackReason.status !== 0) throw fallbackReason;
        }
      }
    }
    throw reason;
  }
}

export function ensureExplorerSession(runId: string): Promise<AnalysisSession> {
  return request<AnalysisSession>(`/profile/${encodeURIComponent(runId)}/explorer/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
}

export function autoPlanChart(runId: string, question: string): Promise<AutoChartPlan> {
  return request<AutoChartPlan>(`/profile/${encodeURIComponent(runId)}/charts/auto-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
}

export function autoProfilePack(runId: string): Promise<AutoProfilePack> {
  return request<AutoProfilePack>(`/profile/${encodeURIComponent(runId)}/charts/auto-profile-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function getReportExportSource(reportId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/reports/${encodeURIComponent(reportId)}/export-source`);
}

export function listForecastAlgorithms(runId: string): Promise<{ algorithms: ForecastAlgorithmCapability[] }> {
  return request<{ algorithms: ForecastAlgorithmCapability[] }>(`/profile/${encodeURIComponent(runId)}/charts/algorithms`);
}

export function previewExplorer(runId: string, query: QuerySpec, signal?: AbortSignal): Promise<AnalysisExecution> {
  return request<AnalysisExecution>(`/profile/${encodeURIComponent(runId)}/explorer/previews`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ query }),
  });
}

export function promoteExplorerPreview(runId: string, previewId: string, contextId: string, signal?: AbortSignal): Promise<AnalysisExecution> {
  return request<AnalysisExecution>(`/profile/${encodeURIComponent(runId)}/explorer/previews/${encodeURIComponent(previewId)}/promote`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ expected_context_version_id: contextId }),
  });
}

export type ReportDraftItem = {
  id: string; item_type: "chart" | "note" | string; position: number; title?: string | null; note?: string | null;
  query_execution_id?: string | null; query_spec?: QuerySpec | null; result_hash?: string | null;
  content_json?: { result?: AnalysisExecution["result"]; chart_spec?: ChartSpec; answer?: string; insight?: string; insight_reviewed?: boolean } | null; limitations?: string[] | null;
};
export type ReportDraft = { id: string; title: string; profile_run_id: string; status: "empty" | "draft" | "stale" | "snapshot" | string; draft_version: number; version_id: string; items: ReportDraftItem[]; stale_reasons: string[]; snapshot_hash?: string | null };

export function getProfileReportDraft(runId: string): Promise<ReportDraft> {
  return request<ReportDraft>(`/profile/${encodeURIComponent(runId)}/report-draft`);
}

export function pinChartToReport(
  reportId: string,
  executionId: string,
  title?: string,
  chartSpec?: ChartSpec,
  insight?: { text: string; reviewed: boolean; agentRunId: string },
  idempotencyKey = crypto.randomUUID(),
): Promise<ReportDraft> {
  return request<ReportDraft>(`/reports/${encodeURIComponent(reportId)}/items`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      item_type: "chart",
      query_execution_id: executionId,
      title,
      chart_spec: chartSpec,
      agent_run_id: insight?.agentRunId,
      content: insight ? { insight: insight.text, insight_reviewed: insight.reviewed } : undefined,
    }),
  });
}

export function pinAgentAnswerToReport(
  reportId: string,
  agentRunId: string,
  title: string,
  content: string,
): Promise<ReportDraft> {
  return request<ReportDraft>('/reports/' + encodeURIComponent(reportId) + '/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ item_type: 'agent_answer', agent_run_id: agentRunId, title, content: { answer: content } }),
  });
}

export function reorderReportDraft(reportId: string, itemIds: string[], expectedDraftVersion: number): Promise<ReportDraft> {
  return request<ReportDraft>(`/reports/${encodeURIComponent(reportId)}/items/reorder`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, expected_draft_version: expectedDraftVersion }),
  });
}

export function updateReportDraftItem(reportId: string, itemId: string, payload: { title?: string; note?: string }): Promise<ReportDraft> {
  return request<ReportDraft>(`/reports/${encodeURIComponent(reportId)}/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}

export function unpinReportDraftItem(reportId: string, itemId: string): Promise<ReportDraft> {
  return request<ReportDraft>(`/reports/${encodeURIComponent(reportId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

export function snapshotReportDraft(reportId: string): Promise<ReportDraft> {
  return request<ReportDraft>(`/reports/${encodeURIComponent(reportId)}/snapshots`, { method: "POST" });
}

export type AdminUser = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: "admin" | "analyst";
  status: "active" | "locked";
  locked_reason: string | null;
  locked_at: string | null;
  locked_by_user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminUserStats = {
  total_users: number;
  active_users: number;
  locked_users: number;
  admin_users: number;
  analyst_users: number;
};

export type AdminUsersResponse = {
  stats: AdminUserStats;
  users: AdminUser[];
};

export function listAdminUsers(params?: {
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminUsersResponse> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.role && params.role !== "all") query.set("role", params.role);
  if (params?.status && params.status !== "all") query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<AdminUsersResponse>(`/admin/users${qs ? `?${qs}` : ""}`);
}

export function updateAdminUserStatus(
  userId: string,
  payload: { status: "active" | "locked"; reason?: string },
): Promise<AdminUser> {
  return request<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateAdminUserRole(
  userId: string,
  payload: { role: "admin" | "analyst" },
): Promise<AdminUser> {
  return request<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteAdminUser(userId: string): Promise<{ user_id: string; deleted: boolean }> {
  return request<{ user_id: string; deleted: boolean }>(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}
