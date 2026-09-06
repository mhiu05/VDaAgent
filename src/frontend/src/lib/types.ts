import type { components } from "./schema";

type Schemas = components["schemas"];

export type RunStatus = "created" | "queued" | "running" | "pending_review" | "resuming" | "completed" | "failed" | "cancelled" | string;
export type ProposalKind = "candidate_key" | "semantic_type" | "pii";
export type ProposalDecisionType = "confirm" | "reject" | "edit";

export type Dataset = Schemas["DatasetOut"];
export type ProfileRunSummary = Schemas["ProfileRunSummary"];
export type ColumnStat = Schemas["ColumnStatOut"];
export type Proposal = Schemas["ProposalOut"] & {
  semantic_description?: string | null;
};
export type Profile = Omit<Schemas["ProfileResponse"], "column_stats" | "correlation_matrix" | "proposals" | "risk_warnings" | "quasi_identifiers" | "pending_proposals"> & {
  column_stats: Record<string, ColumnStat>;
  correlation_matrix: Record<string, Record<string, number>>;
  proposals: Record<string, Proposal[]>;
  risk_warnings: string[];
  quasi_identifiers: string[];
  pending_proposals: number;
};
export type ProfileSummary = {
  profile_run_id: string;
  dataset_id: string;
  dataset_name?: string | null;
  status: string;
  job_status?: string | null;
  scan_mode?: string | null;
  row_count?: number | null;
  column_count?: number | null;
  warning_count: number;
  pending_proposals: number;
  context_version_id?: string | null;
  next_action: string;
};
export type ProfilingJob = Schemas["ProfileJobResponse"];
export type DatasetProfileResult = { dataset_id: string; run_id: string; job_id: string; status: "queued" | "running" | "succeeded" | "failed"; next_action: string; duplicate?: boolean; error?: { code: string; message: string } | null };
export type UploadResult = Schemas["UploadResponse"];
export type DatasourceKind = "mysql" | "mongodb" | "duckdb";
export type DatasourceConfig = Record<string, string | number | Record<string, unknown>>;
export type DatasourceTestResult = { ok: boolean; kind: DatasourceKind; objects: string[]; detail: string };
export type DatasourceConnectResult = { dataset_id: string; name: string; source_type: DatasourceKind; object_name: string | null };
export type TestResult = Schemas["TestResultOut"];
export type TestResponse = Omit<Schemas["TestResponse"], "results"> & {
  results: TestResult[];
};
export type DriftFinding = Schemas["DriftFinding"];
export type DriftResponse = Omit<Schemas["DriftResponse"], "findings"> & {
  findings: DriftFinding[];
};
export type AnswerSource = NonNullable<Schemas["QAResponse"]["sources"]>[number];
export type QAResponse = Omit<Schemas["QAResponse"], "sources"> & {
  sources: AnswerSource[];
};
