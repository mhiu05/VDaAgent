export type AnalysisMode = "quick" | "deep";
export type AnalysisStatus = "needs_context" | "quality_review" | "quality_blocked" | "plan_review" | "running" | "insight_review" | "completed" | "failed" | "cancelled" | string;

export interface AnalysisContext {
  id: string;
  version: number;
  status: "draft" | "approved" | string;
  context: {
    row_grain?: string | null;
    entity?: string | null;
    keys: string[];
    time_column?: string | null;
    timezone?: string | null;
    dimensions: string[];
    measures: string[];
    ignored_columns: string[];
    limitations: string[];
  };
}

export interface QualityIssue { id: string; severity: "critical" | "warning" | "info" | string; message: string; rule: string; status: string; evidence?: Record<string, unknown>; resolution_note?: string | null; }
export interface QualityGate { id: string; decision: "passed" | "warning" | "blocked" | string; issues: QualityIssue[]; }
export interface AnalysisSession {
  id: string; mode: AnalysisMode; status: AnalysisStatus; goal: string; decision?: string | null; audience?: string | null; output?: string | null;
  source?: { profile_run_id: string; dataset_id: string; alias: string }; context?: AnalysisContext; quality_gate?: QualityGate; created_at?: string;
}
export interface QuerySpec { aggregate: "count" | "count_distinct" | "sum" | "mean" | "median"; column?: string; dimensions: string[]; filters: Array<{ column: string; operator: string; value?: unknown }>; limit: number; }
export interface AnalysisExecution { id: string; query_spec: QuerySpec; result: { data: Array<Record<string, unknown>>; columns: string[]; row_count: number }; result_hash: string; limitations: string[]; is_approximate: boolean; duration_ms?: number; created_at?: string; }
