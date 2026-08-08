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

const configuredApiBase = process.env.NEXT_PUBLIC_API_URL;

function apiBase(): string {
  if (configuredApiBase) return configuredApiBase.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
  }
  return "http://localhost:8000/api/v1";
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init.headers },
    credentials: "include",
  });
  if (!response.ok) throw await readError(response);
  return response.json() as Promise<T>;
}

export function listDatasets(signal?: AbortSignal): Promise<Dataset[]> {
  return request<Dataset[]>("/datasets", { signal });
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
  dataset_ref: string;
  dataset_name?: string;
  scan_mode: "full" | "sample";
  sampling?: { strategy: "reservoir" | "tablesample"; sample_size: number; random_seed: number };
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
    confirmed_by: string;
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
    requested_by: string;
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
  const response = await fetch(`${apiBase()}/profile/${encodeURIComponent(runId)}/export`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) throw await readError(response);
  return response.blob();
}

export function askQuestion(payload: { question: string; profile_run_id?: string }): Promise<QAResponse> {
  return request<QAResponse>("/qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function streamQuestion(
  payload: { question: string; profile_run_id?: string },
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiBase()}/qa/stream`, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    credentials: "include",
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

export function uploadDataset(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${apiBase()}/datasets/upload`);
    request.responseType = "json";
    request.withCredentials = true;
    request.setRequestHeader("Accept", "application/json");
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
}
