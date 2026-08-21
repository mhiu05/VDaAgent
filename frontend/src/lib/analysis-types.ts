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
export type AnalysisKind = "aggregate" | "histogram" | "scatter" | "box" | "heatmap" | "forecast" | "missing_bar" | "missing_heatmap" | "correlation_heatmap" | "cardinality" | "violin" | "donut" | "outlier";
export type ForecastAlgorithm = "naive" | "seasonal_naive" | "drift" | "moving_average" | "weighted_moving_average" | "ses" | "holt_linear" | "holt_winters" | "ets" | "arima" | "sarima" | "sarimax" | "auto_arima" | "arimax" | "structural_time_series" | "local_level" | "local_linear_trend" | "kalman_filter" | "dynamic_linear_model" | "unobserved_components" | "prophet" | "neuralprophet" | "linear_regression" | "ridge" | "lasso" | "random_forest" | "extra_trees" | "xgboost" | "lightgbm" | "catboost";
export interface QuerySpec { analysis_kind?: AnalysisKind; aggregate: "count" | "count_distinct" | "sum" | "mean" | "median"; column?: string; x_column?: string; y_column?: string; columns?: string[]; dimensions: string[]; filters: Array<{ column: string; operator: string; value?: unknown }>; time_grain?: "day" | "week" | "month" | "quarter" | "year"; bins?: number; forecast_algorithm?: ForecastAlgorithm; forecast_horizon?: number; season_length?: number; confidence_level?: number; history_limit?: number; limit: number; sort?: "asc" | "desc"; }
export type ChartType = "line" | "bar" | "table" | "kpi" | "histogram" | "scatter" | "box" | "heatmap" | "missing_bar" | "missing_heatmap" | "correlation_heatmap" | "cardinality" | "violin" | "donut" | "outlier";
export type ChartRenderer = "native-svg" | "native-css" | "native-html" | "native-kpi" | "native-grid";
export interface AutoChartPlan {
  question: string;
  title: string;
  problem: "compare" | "trend" | "ranking" | "summary" | "distribution" | "relationship" | "quality" | "forecast";
  algorithm: QuerySpec["aggregate"] | "histogram" | "box" | "scatter" | "heatmap" | "missing_bar" | "missing_heatmap" | "correlation_heatmap" | "cardinality" | "violin" | "donut" | "outlier" | ForecastAlgorithm;
  x_column?: string | null;
  y_column?: string | null;
  second_dimension?: string | null;
  time_grain?: QuerySpec["time_grain"] | null;
  forecast_horizon?: number | null;
  season_length?: number | null;
  chart_type: ChartType;
  renderer: ChartRenderer;
  query: QuerySpec;
  rationale: string;
  planning_mode: "agent" | "rules_fallback";
  agent_run_id?: string | null;
  context_version_id?: string | null;
}
export interface ChartSpec { chart_type: ChartType; renderer: ChartRenderer; analysis_kind?: AnalysisKind; x_column?: string | null; y_column?: string | null; aggregation: QuerySpec["aggregate"]; time_grain?: QuerySpec["time_grain"] | null; bins?: number | null; forecast_algorithm?: ForecastAlgorithm | null; forecast_horizon?: number | null; season_length?: number | null; }
export interface ForecastAlgorithmCapability { id: ForecastAlgorithm; label: string; family: "baseline" | "exponential_smoothing" | "arima" | "state_space" | "decomposable" | "machine_learning" | string; dependency?: string | null; min_history: number; seasonal: boolean; requires_future_exogenous: boolean; available: boolean; unavailable_reason?: string | null; }
export interface AnalysisExecution { id: string; context_version_id?: string; query_spec: QuerySpec; result: { data: Array<Record<string, unknown>>; columns: string[]; row_count: number }; result_hash: string; limitations: string[]; is_approximate: boolean; execution_kind?: 'preview' | 'official'; status?: string; query_summary?: string; duration_ms?: number; created_at?: string; expires_at?: string | null; }
