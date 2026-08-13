import { parseSseChunk, type SseEvent } from "@/lib/sse";
import type {
  Dataset,
  DriftResponse,
  Profile,
  ProfileRunSummary,
  ProposalDecisionType,
  QAResponse,
  TestResponse,
  TestResult,
  UploadResult,
} from "@/lib/types";
import type { AnalysisExecution, AnalysisSession, QuerySpec } from "@/lib/analysis-types";

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

async function apiFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: await authHeaders(init.headers),
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
    const refreshed = await authTransport.refresh();
    if (refreshed) return apiFetch(path, init, true);
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

export function getDashboard<T>(): Promise<T> {
  return request<T>("/dashboard");
}

export type SelfSignupRole = "viewer" | "analyst" | "admin";

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
    const response = await fetch(`${apiBase()}/onboarding/provision`, {
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
    await fetch(`${apiBase()}/guest/session`, {
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

export function listRuns(datasetId: string, signal?: AbortSignal): Promise<ProfileRunSummary[]> {
  return request<ProfileRunSummary[]>(`/datasets/${encodeURIComponent(datasetId)}/runs`, { signal });
}

export function getProfile(runId: string, signal?: AbortSignal): Promise<Profile> {
  return request<Profile>(`/profile/${encodeURIComponent(runId)}`, { signal });
}

export function createProfile(payload: {
  dataset_id?: string;
  dataset_ref?: string;
  dataset_name?: string;
  scan_mode: "full" | "sample";
  sampling?: { strategy: "reservoir" | "tablesample"; sample_size?: number; random_seed?: number };
}): Promise<Profile> {
  return request<Profile>("/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
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
): Promise<{ profile_run_id: string; applied: number; pending_proposals: number; status: string; narrative_report?: string | null; answer?: string | null; test_results?: TestResult[] }> {
  return request<{ profile_run_id: string; applied: number; pending_proposals: number; status: string; narrative_report?: string | null; answer?: string | null; test_results?: TestResult[] }>(`/profile/${encodeURIComponent(runId)}/confirm`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
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

export type CombinedReportSection = "overview" | "technical_profile" | "quality" | "tests" | "drift" | "agent_summary" | "analysis";
export const ALL_COMBINED_REPORT_SECTIONS: CombinedReportSection[] = ["overview", "technical_profile", "quality", "tests", "drift", "agent_summary", "analysis"];

function reportSectionQuery(sections?: CombinedReportSection[]): string {
  return sections?.length ? `?sections=${encodeURIComponent(sections.join(","))}` : "";
}

export async function downloadCombinedReport(runId: string, sections?: CombinedReportSection[]): Promise<Blob> {
  const response = await fetch(`/api/reports/profile/${encodeURIComponent(runId)}${reportSectionQuery(sections)}`, {
    headers: await authHeaders({ Accept: "application/pdf" }),
    credentials: "include",
  });
  if (!response.ok) throw await readError(response);
  return response.blob();
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
  payload: { question: string; profile_run_id?: string; history?: QAHistoryMessage[] },
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
      const refreshed = await authTransport.refresh();
      if (refreshed) return uploadDatasetOnce(file, onProgress, signal, apiBase());
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

export function listAnalyses(signal?: AbortSignal, profileRunId?: string): Promise<AnalysisSession[]> {
  const query = profileRunId ? `?profile_run_id=${encodeURIComponent(profileRunId)}` : "";
  return request<AnalysisSession[]>(`/analysis-sessions${query}`, { signal });
}

export function getAnalysis(sessionId: string, signal?: AbortSignal): Promise<AnalysisSession> {
  return request<AnalysisSession>(`/analysis-sessions/${encodeURIComponent(sessionId)}`, { signal });
}

export function createAnalysis(payload: { profile_run_id: string; mode: "quick" | "deep"; goal: string; decision?: string; audience?: string; output?: "answer" | "report" | "chart" }): Promise<AnalysisSession> {
  return request<AnalysisSession>("/analysis-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

export function createAnalysisContext(sessionId: string, payload: { row_grain?: string; entity?: string; keys: string[]; time_column?: string; timezone?: string; dimensions: string[]; measures: string[]; ignored_columns: string[]; limitations: string[] }): Promise<AnalysisSession["context"]> {
  return request<AnalysisSession["context"]>(`/analysis-sessions/${encodeURIComponent(sessionId)}/context-versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

export function approveAnalysisContext(sessionId: string, contextId: string): Promise<AnalysisSession["context"]> {
  return request<AnalysisSession["context"]>(`/analysis-sessions/${encodeURIComponent(sessionId)}/context-versions/${encodeURIComponent(contextId)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

export function runAnalysisQualityGate(sessionId: string): Promise<AnalysisSession["quality_gate"]> {
  return request<AnalysisSession["quality_gate"]>(`/analysis-sessions/${encodeURIComponent(sessionId)}/quality-gate`, { method: "POST" });
}

export function executeAnalysis(sessionId: string, contextId: string, query: QuerySpec): Promise<AnalysisExecution> {
  return request<AnalysisExecution>(`/analysis-sessions/${encodeURIComponent(sessionId)}/executions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_context_version_id: contextId, query }) });
}
