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
export type ProfilingJob = Schemas["ProfileJobResponse"];
export type UploadResult = Schemas["UploadResponse"];
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
