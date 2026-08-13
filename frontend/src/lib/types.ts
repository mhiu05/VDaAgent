export type RunStatus =
  | "created"
  | "queued"
  | "running"
  | "pending_review"
  | "resuming"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export type ProposalKind = "candidate_key" | "semantic_type" | "pii";
export type ProposalDecisionType = "confirm" | "reject" | "edit";

export interface Dataset {
  id: string;
  name: string;
  source_type?: string | null;
  source_ref?: string | null;
  last_profiled_at?: string | null;
}

export interface ProfileRunSummary {
  id: string;
  dataset_id: string;
  version?: number | null;
  status: RunStatus;
  scan_mode?: string | null;
  row_count?: number | null;
  is_approximate?: boolean;
  created_at?: string | null;
}

export interface ColumnStat {
  column_name: string;
  dtype?: string | null;
  row_count?: number | null;
  null_count?: number | null;
  null_pct?: number | null;
  cardinality?: number | null;
  uniqueness_ratio?: number | null;
  min_value?: number | null;
  max_value?: number | null;
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  q1?: number | null;
  q3?: number | null;
  outlier_count?: number | null;
  outlier_method?: string | null;
  min_length?: number | null;
  max_length?: number | null;
  top_k_values?: unknown;
  is_approximate?: boolean;
  margin_of_error?: number | null;
  pii_masked?: boolean;
  [key: string]: unknown;
}

export interface Proposal {
  id: string;
  kind?: ProposalKind | null;
  column_name?: string | null;
  columns?: string[] | null;
  proposed_type?: string | null;
  semantic_description?: string | null;
  final_type?: string | null;
  pii_type?: string | null;
  detection_method?: string | null;
  confidence_score: number;
  evidence: string;
  status: "pending" | "confirmed" | "rejected" | "edited" | "auto_confirmed" | string;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
}

export interface Profile {
  profile_run_id: string;
  dataset_id: string;
  dataset_name?: string | null;
  status: RunStatus;
  graph_thread_id?: string | null;
  initial_question?: string | null;
  version?: number | null;
  row_count?: number | null;
  column_count: number;
  scan_mode?: string | null;
  random_seed?: number | null;
  executed_query?: string | null;
  is_approximate: boolean;
  narrative_report?: string | null;
  risk_warnings: string[];
  quasi_identifiers: string[];
  pending_proposals: number;
  column_stats: Record<string, ColumnStat>;
  correlation_matrix: Record<string, Record<string, number>>;
  proposals: Record<string, Proposal[]>;
  test_results?: TestResult[];
  question_type?: string | null;
  answer?: string | null;
  answer_sources?: AnswerSource[];
  error?: string | null;
}

export interface UploadResult {
  dataset_ref: string;
  dataset_id?: string | null;
  filename: string;
  size_bytes: number;
  suggested_name?: string | null;
}

export interface TestResult {
  test_type: string;
  target_columns: string[];
  test_statistic?: number | null;
  p_value?: number | null;
  p_value_adjusted?: number | null;
  significant_after_correction?: boolean | null;
  conclusion: string;
  interpretation: string;
  alpha?: number | null;
  error?: string | null;
}

export interface TestResponse {
  profile_run_id: string;
  results: TestResult[];
  correction_note?: string | null;
}

export interface DriftFinding {
  column_name?: string | null;
  drift_type: string;
  severity: "major" | "minor";
  metric?: string | null;
  baseline_value?: unknown;
  current_value?: unknown;
  psi?: number | null;
  detail: string;
}

export interface DriftResponse {
  baseline_run_id: string;
  current_run_id: string;
  summary: string;
  findings: DriftFinding[];
}

export type AnswerSource =
  | { type: "profile_report"; citation_id: string; doc_id: string; profile_run_id?: string | null; dataset_name?: string | null; retrieval_channel: string; score: number }
  | { type: "external_knowledge"; citation_id: string; doc_id: string; source_id: string; title?: string | null; canonical_url: string; retrieved_at?: string | null; category?: string | null; retrieval_channel: string; score: number }
  | { type: "tool"; tool: string; args?: Record<string, unknown>; status: string; profile_run_id?: string | null };

export interface QAResponse {
  question: string;
  question_type?: string | null;
  answer: string;
  sources: AnswerSource[];
  is_approximate: boolean;
}
