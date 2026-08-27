"use client";

import { MarkdownContent, normalizeMarkdownText } from "@/components/markdown";
import { EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui";
import { sanitizeGeneratedText } from "@/lib/generated-text";
import type { AnalysisExecution, AutoChartPlan, ChartRenderer, ChartSpec, ChartType, ForecastAlgorithm, ForecastAlgorithmCapability, QuerySpec } from "@/lib/analysis-types";
import {
  autoPlanChart,
  autoProfilePack,
  ensureExplorerSession,
  getProfileReportDraft,
  listForecastAlgorithms,
  pinChartToReport,
  previewExplorer,
  promoteExplorerPreview,
  streamQuestion,
} from "@/lib/api";
import type { Profile } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChartEvidenceView } from "./chart-evidence-view";

type ProblemType = "compare" | "trend" | "ranking" | "summary" | "distribution" | "relationship" | "quality" | "forecast" | "composition" | "geographic" | "multi_dimensional";
type AnalysisMethod = QuerySpec["aggregate"] | "histogram" | "box" | "scatter" | "heatmap" | "missing_bar" | "missing_heatmap" | "correlation_heatmap" | "cardinality" | "violin" | "donut" | "outlier" | ForecastAlgorithm;
type ChartStatus = "draft" | "preview" | "official" | "failed";
type ChartDraft = {
  id: string;
  question: string;
  problem: ProblemType | "";
  algorithm: AnalysisMethod | "";
  x_column: string;
  y_column: string;
  second_dimension: string;
  time_grain: NonNullable<QuerySpec["time_grain"]> | "";
  date_from: string;
  date_to: string;
  forecast_horizon: number;
  season_length: number;
  chart_type: ChartType | "";
  renderer: ChartRenderer | "";
  title: string;
  status: ChartStatus;
  generated: boolean;
  execution?: AnalysisExecution;
  insight?: string;
  insight_agent_run_id?: string | null;
  insight_evidence_status?: string;
  insight_reviewed: boolean;
  insight_busy?: boolean;
  pin_idempotency_key: string;
  pinned?: boolean;
  error?: string;
  rationale?: string;
  planning_mode?: AutoChartPlan["planning_mode"];
  planner_agent_run_id?: string | null;
  planned_query?: QuerySpec;
  transforms?: Array<{ step: string; detail: string }>;
  source_columns?: string[];
};

type Props = { runId: string; profile: Profile; onExplain: (execution: AnalysisExecution) => void };

const MAX_CHARTS = 12;
const PROBLEMS: Array<{ value: ProblemType; label: string; detail: string }> = [
  { value: "compare", label: "So sánh nhóm", detail: "So sánh một chỉ số giữa các dimension." },
  { value: "trend", label: "Xu hướng thời gian", detail: "Theo dõi chỉ số theo tháng, quý hoặc năm." },
  { value: "ranking", label: "Xếp hạng", detail: "Tìm nhóm cao nhất hoặc thấp nhất." },
  { value: "summary", label: "Chỉ số tổng hợp", detail: "Tạo một KPI cho toàn bộ dữ liệu." },
  { value: "distribution", label: "Phân phối", detail: "Xem hình dạng phân phối hoặc tóm tắt năm số của một measure." },
  { value: "relationship", label: "Mối quan hệ", detail: "Kiểm tra quan hệ giữa hai measure hoặc hai dimension." },
  { value: "forecast", label: "Dự báo chuỗi thời gian", detail: "Dự báo các kỳ tương lai từ lịch sử đã tổng hợp theo thời gian." },
  { value: "quality", label: "Chất lượng dữ liệu", detail: "Kiểm tra missing, cardinality, tương quan và outlier từ Profile evidence." },
  { value: "composition", label: "Tỷ trọng / Thành phần", detail: "Phân tích cơ cấu, thành phần của một dimension." },
  { value: "geographic", label: "Địa lý", detail: "Phân bổ theo vị trí địa lý." },
  { value: "multi_dimensional", label: "Phân tích đa chiều", detail: "Phân tích kết hợp nhiều dimension và measure." },
];
const FORECAST_LABELS: Record<ForecastAlgorithm, string> = {
  naive: "Dự báo ngây thơ", seasonal_naive: "Ngây thơ theo mùa", drift: "Phương pháp xu hướng trôi", moving_average: "Trung bình trượt", weighted_moving_average: "Trung bình trượt có trọng số",
  ses: "San bằng mũ đơn (SES)", holt_linear: "Xu hướng tuyến tính Holt", holt_winters: "Holt-Winters", ets: "ETS",
  arima: "ARIMA", sarima: "SARIMA", auto_arima: "Auto-ARIMA",
  structural_time_series: "Chuỗi thời gian cấu trúc", local_level: "Mô hình mức cục bộ", local_linear_trend: "Xu hướng tuyến tính cục bộ", kalman_filter: "Bộ lọc Kalman", dynamic_linear_model: "Mô hình tuyến tính động", unobserved_components: "Mô hình thành phần ẩn",
  prophet: "Prophet", neuralprophet: "NeuralProphet", linear_regression: "Hồi quy tuyến tính", ridge: "Hồi quy Ridge", lasso: "Lasso", random_forest: "Rừng ngẫu nhiên", extra_trees: "Cây cực ngẫu nhiên", xgboost: "XGBoost", lightgbm: "LightGBM", catboost: "CatBoost",
};
const FORECAST_IDS = Object.keys(FORECAST_LABELS) as ForecastAlgorithm[];
const FORECAST_FAMILY_LABELS: Record<string, string> = { baseline: "Mốc cơ sở / đơn giản", exponential_smoothing: "San bằng mũ", arima: "Nhóm ARIMA", state_space: "Không gian trạng thái / thống kê", decomposable: "Prophet / phân rã", machine_learning: "Học máy" };
const ALGORITHM_LABELS: Record<AnalysisMethod, string> = {
  count: "Đếm số dòng", count_distinct: "Đếm khác biệt", sum: "Tính tổng", mean: "Trung bình", median: "Trung vị",
  histogram: "Chia khoảng tần suất", box: "Tóm tắt năm số", scatter: "Mật độ hai measure", heatmap: "Tổng hợp hai chiều",
  missing_bar: "Tỷ lệ thiếu theo cột", missing_heatmap: "Ma trận đồng thiếu", correlation_heatmap: "Ma trận tương quan", cardinality: "Cardinality theo cột", violin: "Mật độ phân phối theo nhóm", donut: "Tỷ trọng nhóm ít", outlier: "Tỷ lệ outlier theo cột",
  ...FORECAST_LABELS,
};
const PROBLEM_ALGORITHMS: Record<ProblemType, AnalysisMethod[]> = {
  compare: ["count", "sum", "mean", "median", "donut"],
  trend: ["count", "sum", "mean", "median"],
  ranking: ["count", "sum", "mean"],
  summary: ["count", "count_distinct", "sum", "mean", "median"],
  distribution: ["histogram", "box", "violin", "outlier"],
  relationship: ["scatter", "heatmap", "correlation_heatmap"],
  quality: ["missing_bar", "missing_heatmap", "cardinality", "outlier"],
  forecast: FORECAST_IDS,
  composition: ["count", "sum", "donut"],
  geographic: ["count", "sum", "mean"],
  multi_dimensional: ["scatter", "heatmap"],
};
const PROBLEM_CHARTS: Record<ProblemType, ChartType[]> = {
  compare: ["bar", "table"], trend: ["line", "table"], ranking: ["bar", "table"], summary: ["kpi", "table"],
  distribution: ["histogram", "box", "violin", "outlier"], relationship: ["scatter", "heatmap", "correlation_heatmap"],
  quality: ["missing_bar", "missing_heatmap", "cardinality", "outlier"],
  forecast: ["line", "table"],
  composition: ["donut", "bar", "table"],
  geographic: ["bar", "table"],
  multi_dimensional: ["scatter", "heatmap"],
};
const CHART_LABELS: Record<ChartType, string> = { line: "Đường · xu hướng", bar: "Cột · so sánh", table: "Bảng · chi tiết", kpi: "KPI · tổng hợp", histogram: "Histogram · phân phối", scatter: "Scatter · mật độ", box: "Biểu đồ hộp · năm số", heatmap: "Bản đồ nhiệt · hai chiều", missing_bar: "Cột giá trị thiếu", missing_heatmap: "Bản đồ nhiệt giá trị thiếu", correlation_heatmap: "Bản đồ nhiệt tương quan", cardinality: "Biểu đồ lực lượng", violin: "Biểu đồ violin", donut: "Biểu đồ tròn / donut", outlier: "Biểu đồ ngoại lệ", map: "Bản đồ Địa lý" };
const RENDERER_FOR_CHART: Record<ChartType, ChartRenderer> = { line: "native-svg", bar: "native-css", table: "native-html", kpi: "native-kpi", histogram: "native-svg", scatter: "native-svg", box: "native-svg", heatmap: "native-grid", missing_bar: "native-css", missing_heatmap: "native-grid", correlation_heatmap: "native-grid", cardinality: "native-css", violin: "native-svg", donut: "native-svg", outlier: "native-css", map: "native-css" };
const RENDERER_LABELS: Record<ChartRenderer, string> = { "native-svg": "SVG tích hợp", "native-css": "Thanh CSS", "native-html": "Bảng HTML", "native-kpi": "KPI tích hợp", "native-grid": "Lưới tích hợp" };

function draftChart(): ChartDraft {
  return {
    id: `chart-${crypto.randomUUID()}`, question: "", problem: "", algorithm: "", x_column: "", y_column: "", second_dimension: "",
    time_grain: "", date_from: "", date_to: "", forecast_horizon: 12, season_length: 12, chart_type: "", renderer: "", title: "", status: "draft", generated: false,
    insight_reviewed: false, pin_idempotency_key: crypto.randomUUID(),
  };
}

const chartStateMemory = new Map<string, ChartDraft[]>();
type ChartPipelineKind = "questions" | "profile_pack";
type ChartPipelineState = {
  kind: ChartPipelineKind;
  status: "running" | "completed" | "failed";
  percent: number;
  step: string;
  current?: number;
  total?: number;
  updatedAt: number;
};
const chartPipelineMemory = new Map<string, ChartPipelineState>();

function persistChartState(runId: string, value: ChartDraft[]) {
  chartStateMemory.set(runId, value);
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`p170_charts_state_${runId}`, JSON.stringify(value)); } catch { }
}

function loadChartPipeline(runId: string): ChartPipelineState | null {
  const memory = chartPipelineMemory.get(runId);
  if (memory) return memory;
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(`p170_charts_pipeline_${runId}`) || "null") as ChartPipelineState | null;
    if (parsed?.status === "running" && (parsed.kind === "questions" || parsed.kind === "profile_pack")) {
      chartPipelineMemory.set(runId, parsed);
      return parsed;
    }
  } catch { }
  return null;
}

function persistChartPipeline(runId: string, value: ChartPipelineState | null) {
  if (value) chartPipelineMemory.set(runId, value);
  else chartPipelineMemory.delete(runId);
  if (typeof window === "undefined") return;
  try {
    if (value) localStorage.setItem(`p170_charts_pipeline_${runId}`, JSON.stringify(value));
    else localStorage.removeItem(`p170_charts_pipeline_${runId}`);
  } catch { }
}

function chartDisplayTitle(chart: Pick<ChartDraft, "question" | "title">) {
  return chart.question.trim() || chart.title.trim() || "Bài phân tích mới";
}

function chartFromPlan(plan: AutoChartPlan): ChartDraft {
  return {
    ...draftChart(),
    question: plan.question,
    title: plan.question || plan.title,
    problem: plan.problem,
    algorithm: plan.algorithm,
    x_column: plan.x_column ?? "",
    y_column: plan.y_column ?? "",
    second_dimension: plan.second_dimension ?? "",
    time_grain: plan.time_grain ?? "",
    forecast_horizon: plan.forecast_horizon ?? 12,
    season_length: plan.season_length ?? 12,
    chart_type: plan.chart_type,
    renderer: plan.renderer,
    rationale: plan.rationale,
    planning_mode: plan.planning_mode,
    planner_agent_run_id: plan.agent_run_id,
    planned_query: plan.query,
    transforms: plan.transforms,
    source_columns: plan.source_columns,
  };
}

function dayAfter(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function chartQuery(chart: ChartDraft): QuerySpec {
  if (chart.planned_query) return chart.planned_query;
  if (chart.problem === "forecast") return {
    analysis_kind: "forecast",
    aggregate: chart.y_column ? "sum" : "count",
    column: chart.y_column || undefined,
    dimensions: [chart.x_column].filter(Boolean) as string[],
    filters: [],
    time_grain: chart.time_grain || "month",
    forecast_algorithm: chart.algorithm as ForecastAlgorithm,
    forecast_horizon: chart.forecast_horizon,
    season_length: chart.season_length,
    confidence_level: 0.95,
    history_limit: 500,
    bins: 12,
    limit: 50,
    sort: "asc",
  };
  if (chart.algorithm === "histogram") return { analysis_kind: "histogram", aggregate: "count", column: chart.y_column, dimensions: [], filters: [], bins: 12, limit: 50, sort: "asc" };
  if (chart.algorithm === "box") return { analysis_kind: "box", aggregate: "median", column: chart.y_column, dimensions: chart.x_column ? [chart.x_column] : [], filters: [], limit: 50, sort: "desc" };
  if (chart.algorithm === "scatter") return { analysis_kind: "scatter", aggregate: "count", x_column: chart.x_column, y_column: chart.y_column, dimensions: [], filters: [], bins: 12, limit: 50, sort: "desc" };
  if (chart.algorithm === "heatmap") return { analysis_kind: "heatmap", aggregate: "count", dimensions: [chart.x_column, chart.second_dimension].filter(Boolean) as string[], filters: [], limit: 50, sort: "desc" };
  if (["missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "outlier"].includes(chart.algorithm)) return { analysis_kind: chart.algorithm as QuerySpec["analysis_kind"], aggregate: "count", columns: [], dimensions: [], filters: [], bins: 12, limit: 50, sort: "desc" };
  if (chart.algorithm === "violin") return { analysis_kind: "violin", aggregate: "count", column: chart.y_column, dimensions: chart.x_column ? [chart.x_column] : [], filters: [], bins: 16, limit: 8, sort: "desc" };
  if (chart.algorithm === "donut") return { analysis_kind: "donut", aggregate: chart.y_column ? "sum" : "count", column: chart.y_column || undefined, dimensions: [chart.x_column].filter(Boolean) as string[], filters: [], bins: 12, limit: 12, sort: "desc" };
  const grouped = chart.problem !== "summary" && chart.x_column;
  const filters: QuerySpec["filters"] = [];
  if (chart.problem === "trend" && chart.x_column) {
    if (chart.date_from) filters.push({ column: chart.x_column, operator: "gte", value: chart.date_from });
    if (chart.date_to) filters.push({ column: chart.x_column, operator: "lt", value: dayAfter(chart.date_to) });
  }
  return {
    analysis_kind: "aggregate",
    aggregate: (chart.algorithm || "count") as QuerySpec["aggregate"],
    column: chart.algorithm === "count" ? undefined : chart.y_column || undefined,
    dimensions: grouped ? [chart.x_column] : [],
    filters,
    time_grain: chart.problem === "trend" && chart.time_grain ? chart.time_grain : undefined,
    limit: 50,
    sort: chart.problem === "trend" ? "asc" : "desc",
  };
}

function chartSpec(chart: ChartDraft): ChartSpec {
  if (!chart.chart_type || !chart.renderer) throw new Error("Chart type và renderer chưa được chọn.");
  const query = chart.execution?.query_spec ?? chartQuery(chart);
  const analysisKind = query.analysis_kind ?? "aggregate";
  const xColumn = ["missing_bar", "cardinality", "outlier"].includes(analysisKind)
    ? "column"
    : ["missing_heatmap", "correlation_heatmap"].includes(analysisKind)
      ? "x"
      : analysisKind === "histogram"
        ? query.column
        : analysisKind === "scatter"
          ? query.x_column
          : analysisKind === "box"
            ? query.dimensions?.[0] ?? query.column
            : query.dimensions?.[0];
  const yColumn = analysisKind === "scatter"
    ? query.y_column
    : ["missing_heatmap", "correlation_heatmap"].includes(analysisKind)
      ? "y"
      : analysisKind === "heatmap"
        ? query.dimensions?.[1]
        : query.column;
  return {
    chart_type: chart.chart_type,
    renderer: chart.renderer,
    analysis_kind: analysisKind,
    x_column: xColumn ?? null,
    y_column: yColumn ?? null,
    aggregation: query.aggregate,
    time_grain: query.time_grain ?? null,
    bins: query.bins ?? null,
    forecast_algorithm: query.forecast_algorithm ?? null,
    forecast_horizon: query.forecast_horizon ?? null,
    season_length: query.season_length ?? null,
  };
}

type ChartSelectionExplanation = {
  confidence: "high" | "review";
  headline: string;
  checks: string[];
};

function chartSelectionExplanation(chart: ChartDraft): ChartSelectionExplanation {
  const query = chart.execution?.query_spec ?? chart.planned_query;
  const dimensions = query?.dimensions?.filter(Boolean) ?? [];
  const measure = query?.column || chart.y_column || "giá trị";
  const dimension = dimensions[0] || chart.x_column || "nhóm";
  const rowCount = chart.execution?.result.row_count ?? 0;
  const chartType = chart.chart_type;
  const chartLabel = chartType ? CHART_LABELS[chartType] : "biểu đồ";
  const checks = [`Bài toán: ${PROBLEMS.find((item) => item.value === chart.problem)?.label || chart.problem || "chưa xác định"}`];

  if (chartType === "bar") {
    const suitable = Boolean(dimensions.length === 1 && rowCount > 0);
    return {
      confidence: suitable ? "high" : "review",
      headline: suitable ? `Bar phù hợp để so sánh ${query?.aggregate || "giá trị"} theo “${dimension}”.` : "Bar cần một dimension để so sánh các nhóm.",
      checks: [...checks, `Dimension: ${dimension}`, `Phép tính: ${query?.aggregate || "chưa xác định"}`, rowCount ? `${rowCount} nhóm trong Official result` : "Chưa có đủ nhóm trong Official result"],
    };
  }
  if (chartType === "line") {
    const hasTimeAxis = query?.analysis_kind === "forecast" || Boolean(query?.time_grain) || chart.problem === "trend";
    return {
      confidence: hasTimeAxis ? "high" : "review",
      headline: hasTimeAxis ? `Line phù hợp để đọc xu hướng theo thời gian (${query?.time_grain || "time grain"}).` : "Line chỉ phù hợp khi trục X là thời gian có thứ tự.",
      checks: [...checks, `Trục thời gian: ${chart.x_column || "chưa xác định"}`, `Mức thời gian: ${query?.time_grain || "chưa xác định"}`, query?.analysis_kind === "forecast" ? "Có dải dự báo và khoảng tin cậy" : "Dữ liệu được sắp xếp tăng dần theo thời gian"],
    };
  }
  if (chartType === "kpi") {
    const suitable = dimensions.length === 0;
    return {
      confidence: suitable ? "high" : "review",
      headline: suitable ? `KPI phù hợp để tóm tắt một giá trị ${query?.aggregate || "tổng hợp"} cho toàn bộ dữ liệu.` : "KPI phù hợp hơn khi không chia dữ liệu theo nhóm.",
      checks: [...checks, `Phép tính: ${query?.aggregate || "chưa xác định"}`, dimensions.length ? `Đang có ${dimensions.length} dimension` : "Không chia theo dimension"],
    };
  }
  if (chartType === "histogram") {
    return { confidence: chart.y_column ? "high" : "review", headline: `Histogram phù hợp để xem hình dạng phân phối của “${measure}” theo các khoảng giá trị.`, checks: [...checks, `Measure: ${measure}`, `Số khoảng: ${query?.bins || 12}`] };
  }
  if (chartType === "scatter") {
    const suitable = Boolean(query?.x_column && query?.y_column && query.x_column !== query.y_column);
    return { confidence: suitable ? "high" : "review", headline: suitable ? `Scatter phù hợp để kiểm tra mối quan hệ giữa “${query?.x_column}” và “${query?.y_column}”.` : "Scatter cần hai measure khác nhau ở trục X và Y.", checks: [...checks, `Trục X: ${query?.x_column || "chưa xác định"}`, `Trục Y: ${query?.y_column || "chưa xác định"}`] };
  }
  if (chartType === "heatmap" || chartType === "missing_heatmap" || chartType === "correlation_heatmap") {
    const required = chartType === "heatmap" ? dimensions.length >= 2 : (query?.columns?.length ?? 0) >= 2;
    return { confidence: required ? "high" : "review", headline: required ? "Heatmap phù hợp để đọc cường độ hoặc phân bố trong ma trận hai chiều." : "Heatmap cần tối thiểu hai trường để tạo ma trận.", checks: [...checks, chartType === "heatmap" ? `Dimension: ${dimensions.slice(0, 2).join(" × ") || "chưa xác định"}` : `Số cột trong ma trận: ${query?.columns?.length || 0}`] };
  }
  if (chartType === "donut") {
    const suitable = dimensions.length === 1 && rowCount > 0 && rowCount <= 8;
    return { confidence: suitable ? "high" : "review", headline: suitable ? `Donut phù hợp để xem tỷ trọng của tối đa 8 nhóm “${dimension}”.` : "Donut chỉ nên dùng cho ít nhóm; nhiều nhóm nên chuyển sang bar.", checks: [...checks, `Dimension: ${dimension}`, `Số nhóm hiển thị: ${rowCount || "chưa có"}`] };
  }
  if (["box", "violin"].includes(chartType || "")) {
    return { confidence: chart.y_column ? "high" : "review", headline: `${chartLabel} phù hợp để xem phân phối và độ phân tán của “${measure}”.`, checks: [...checks, `Measure: ${measure}`, dimensions.length ? `Nhóm theo: ${dimension}` : "Không chia nhóm"] };
  }
  if (["missing_bar", "cardinality", "outlier"].includes(chartType || "")) {
    return { confidence: "high", headline: `${chartLabel} phù hợp để kiểm tra chất lượng dữ liệu theo từng cột.`, checks: [...checks, `Số cột kiểm tra: ${query?.columns?.length || 0}`] };
  }
  return { confidence: "review", headline: `${chartLabel} đã được tạo theo kế hoạch, hãy đối chiếu với mục tiêu phân tích.`, checks };
}

function analysisError(chart: ChartDraft): string | null {
  if (!chart.question.trim()) return "Hãy mô tả câu hỏi kinh doanh.";
  if (!chart.problem) return "Hãy chọn bài toán.";
  if (!chart.algorithm) return "Hãy chọn thuật toán.";
  if (["compare", "trend", "ranking", "relationship", "forecast"].includes(chart.problem) && chart.algorithm !== "correlation_heatmap" && !chart.x_column) return "Hãy chọn trục X hoặc dimension thứ nhất.";
  if (chart.algorithm === "heatmap" && !chart.second_dimension) return "Heatmap cần dimension thứ hai.";
  if (chart.algorithm === "heatmap" && chart.x_column === chart.second_dimension) return "Heatmap cần hai dimension khác nhau.";
  if (["histogram", "box", "scatter", "violin"].includes(chart.algorithm) && !chart.y_column) return "Thuật toán này cần measure.";
  if (chart.algorithm === "scatter" && chart.x_column === chart.y_column) return "Scatter cần hai measure khác nhau.";
  if (!["count", "histogram", "box", "scatter", "heatmap", "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "violin", "donut", "outlier"].includes(chart.algorithm) && !chart.y_column) return "Thuật toán này cần một measure.";
  if (["trend", "forecast"].includes(chart.problem) && !chart.time_grain) return "Hãy chọn mức thời gian.";
  if (chart.problem === "forecast" && (!chart.forecast_horizon || chart.forecast_horizon > 60)) return "Forecast horizon phải nằm trong khoảng 1–60 kỳ.";
  if (chart.problem === "forecast" && (!chart.season_length || chart.season_length > 365)) return "Season length phải nằm trong khoảng 2–365 kỳ.";
  if (chart.date_from && chart.date_to && chart.date_from > chart.date_to) return "Ngày bắt đầu phải trước ngày kết thúc.";
  return null;
}

function generatedReady(chart: ChartDraft): boolean {
  return Boolean(
    chart.execution?.execution_kind === "official"
    && chart.chart_type
    && chart.renderer
    && chart.generated
    && chart.insight
    && chart.insight_reviewed
    && !chart.pinned
  );
}

/**
 * "Official" only means that the aggregate query was re-run against the
 * current dataset.  Keep that evidence state separate from the user-facing
 * completion state, because the AI explanation is a second asynchronous step.
 */
function chartCompletionState(chart: ChartDraft): { label: string; tone: "" | "success" | "warning" | "danger" } {
  if (chart.pinned) return { label: "Đã ghim báo cáo", tone: "success" };
  if (chart.execution?.execution_kind !== "official") {
    return chart.status === "failed"
      ? { label: "Chưa hoàn tất", tone: "danger" }
      : { label: "Chờ bằng chứng chính thức", tone: "warning" };
  }
  if (!chart.chart_type || !chart.renderer) return { label: "Cần chọn biểu đồ", tone: "warning" };
  if (chart.insight_busy) return { label: "Đang viết insight", tone: "warning" };
  if (chart.insight) return { label: chart.insight_reviewed ? "Sẵn sàng ghim" : "Cần duyệt insight", tone: "warning" };
  if (chart.error) return { label: "Insight lỗi · thử lại", tone: "danger" };
  return { label: "Cần tạo insight", tone: "warning" };
}

function ChartWorkflowCard({ chart, dimensions, measures, forecastAlgorithms, enabled, onChange, onRemove, onGenerate, onRetry, retrying, onExplain, onPin, onSinglePreview, onSinglePromote, previewing, promoting }: {
  chart: ChartDraft;
  dimensions: string[];
  measures: string[];
  forecastAlgorithms: ForecastAlgorithmCapability[];
  enabled: boolean;
  onChange: (next: Partial<ChartDraft>) => void;
  onRemove: () => void;
  onGenerate: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  onExplain: (execution: AnalysisExecution) => void;
  onPin?: () => void;
  onSinglePreview?: () => void;
  onSinglePromote?: () => void;
  previewing?: boolean;
  promoting?: boolean;
}) {
  // Normalize cached/legacy insight content before it reaches the textarea.
  if (typeof chart.insight === "string") {
    const insight = normalizeMarkdownText(chart.insight);
    if (insight !== chart.insight) chart = { ...chart, insight };
  }
  const validation = analysisError(chart);
  const algorithms = chart.problem ? PROBLEM_ALGORITHMS[chart.problem] : [];
  const chartTypes = chart.algorithm && ["histogram", "box", "scatter", "heatmap"].includes(chart.algorithm)
    ? [chart.algorithm as ChartType]
    : chart.problem ? PROBLEM_CHARTS[chart.problem] : [];
  const official = chart.execution?.execution_kind === "official";
  const selectionExplanation = chartSelectionExplanation(chart);
  const displayTitle = chartDisplayTitle(chart);
  const completion = chartCompletionState(chart);
  return <article id={chart.id} className="panel chart-builder-card chart-workflow-card">
    <header className="chart-card-header">
      <div>
        <span className="eyebrow">ANALYSIS {chart.id.slice(-4)}</span>
        <h3>{displayTitle}</h3>
      </div>
      <div className="inline-actions" style={{ alignItems: "center", gap: "8px" }}>
        {chart.pinned ? (
          <span className="chip success" style={{ fontWeight: 700 }}>✓ Đã ghim Báo cáo</span>
        ) : (
          generatedReady(chart) && onPin && (
            <button
              type="button"
              className="button primary"
              style={{ padding: "4px 10px", fontSize: "0.78rem", fontWeight: 700 }}
              onClick={onPin}
            >
              📌 Ghim vào Báo cáo
            </button>
          )
        )}
        <span className={`chip ${completion.tone}`} title="Trạng thái hoàn tất biểu đồ và AI insight">
          {completion.label}
        </span>
        <span className={`chip ${chart.status === "official" ? "success" : chart.status === "preview" ? "warning" : chart.status === "failed" ? "danger" : ""}`} title="Trạng thái evidence">
          {chart.status === "official" ? "Chính thức" : chart.status === "preview" ? "Bản xem trước" : chart.status === "failed" ? "Lỗi" : "Nháp"}
        </span>
        {chart.status === "failed" && onRetry && (
          <button type="button" className="button secondary" disabled={retrying} onClick={onRetry}>
            {retrying ? "Đang chạy lại…" : "Chạy lại biểu đồ"}
          </button>
        )}
        <button type="button" className="button danger chart-remove" onClick={onRemove}>Xóa</button>
      </div>
    </header>
    <fieldset className="chart-workflow-fieldset" disabled={!enabled}>
      {chart.error && <section className="notice error" role="alert"><b>Biểu đồ chưa tạo được.</b><p>{chart.error}</p>{chart.execution?.execution_kind === "preview" && <p>Bản xem trước đã có; hãy chạy lại để xác nhận bằng chứng chính thức.</p>}</section>}
      {chart.problem && chart.algorithm && chart.chart_type && chart.renderer && <div className="chart-auto-decision"><div className="chart-auto-decision-chips"><span className="chip">{PROBLEMS.find((item) => item.value === chart.problem)?.label}</span><span className="chip">{ALGORITHM_LABELS[chart.algorithm]}</span><span className="chip">{CHART_LABELS[chart.chart_type]}</span><span className="chip">{RENDERER_LABELS[chart.renderer]}</span>{chart.planning_mode && <span className={`chip ${chart.planning_mode === "agent" ? "success" : "warning"}`}>{chart.planning_mode === "agent" ? "Trợ lý AI đã lập kế hoạch" : "Kế hoạch dự phòng"}</span>}</div>{chart.rationale && <p>{chart.rationale}</p>}{chart.transforms && chart.transforms.length > 0 && <div className="chart-formulation-pipeline" style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "rgba(99, 102, 241, 0.08)", borderRadius: "6px", fontSize: "0.8rem" }}><div style={{ fontWeight: 600, color: "#4338ca", marginBottom: "0.25rem" }}>⚡ Quy trình định hình dữ liệu (Xử lý dữ liệu bằng AI)</div><div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>{chart.transforms.map((t, idx) => <span key={idx} className="chip" style={{ fontSize: "0.75rem", background: "#e0e7ff", color: "#3730a3" }}>{idx + 1}. {t.detail}</span>)}</div></div>}</div>}
      {chart.generated && chart.execution && chart.chart_type && chart.renderer && <div className="chart-generated-grid"><div className="chart-result-canvas"><div className="chart-result-heading"><div className="chart-result-heading-main"><strong>{displayTitle}</strong><div className="chart-selected-meta"><span className={`chart-fit-badge ${selectionExplanation.confidence}`}>{selectionExplanation.confidence === "high" ? "✓ Phù hợp với dữ liệu" : "Cần xem lại"}</span><span className="chart-type-badge">{CHART_LABELS[chart.chart_type]}</span></div></div><small>{RENDERER_LABELS[chart.renderer]}</small></div><div className={`chart-selection-note ${selectionExplanation.confidence}`}><span className="chart-selection-note-icon" aria-hidden="true">i</span><div><b>Đề xuất: {CHART_LABELS[chart.chart_type]}</b><span>Phân tích: {chart.problem}</span></div><details><summary>Vì sao?</summary><ul>{chart.rationale ? <li>{chart.rationale}</li> : selectionExplanation.checks.map((check) => <li key={check}>{check}</li>)}</ul></details></div><ChartEvidenceView chartSpec={chartSpec(chart)} result={chart.execution.result} querySpec={chart.execution.query_spec} title={displayTitle} /></div><section className="chart-insight-panel" aria-live="polite"><span className="eyebrow">{chart.insight_busy ? "NHẬN ĐỊNH AI · ĐANG SOẠN" : "NHẬN ĐỊNH AI · CẦN DUYỆT"}</span>{chart.insight ? <><MarkdownContent text={chart.insight} className="report report-markdown" />{!chart.insight_busy && <><label className="chart-insight-editor">Chỉnh sửa nhận định trước khi ghim<textarea value={chart.insight} maxLength={20000} rows={7} onChange={(event) => onChange({ insight: event.target.value, insight_reviewed: false })} /></label><label className="chart-insight-review"><input type="checkbox" checked={chart.insight_reviewed} onChange={(event) => onChange({ insight_reviewed: event.target.checked })} /> Tôi đã đối chiếu nhận định với biểu đồ và bằng chứng chính thức.</label></>}</> : <p className="muted">{chart.insight_busy ? "Trợ lý AI đang đọc bằng chứng chính thức và soạn nhận định…" : "Trợ lý AI chưa tạo được nhận định."}</p>}{chart.insight_evidence_status && <small className="muted">Bằng chứng: {chart.insight_evidence_status}</small>}</section></div>}
    </fieldset>
  </article>;
}

export function ChartsTab({ runId, profile, onExplain }: Props) {
  const queryClient = useQueryClient();
  const explorer = useQuery({
    queryKey: ["command-center", runId, "explorer-session"],
    queryFn: () => ensureExplorerSession(runId),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const forecastCatalog = useQuery({
    queryKey: ["command-center", runId, "forecast-algorithms"],
    queryFn: () => listForecastAlgorithms(runId),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const [understanding, setUnderstanding] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem(`p170_charts_understanding_${runId}`) || ""; } catch { return ""; }
  });
  const [understandingRunId, setUnderstandingRunId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem(`p170_charts_understanding_run_${runId}`) || null; } catch { return null; }
  });
  const [charts, rawSetCharts] = useState<ChartDraft[]>(() => {
    if (typeof window === "undefined") return [];
    const memory = chartStateMemory.get(runId);
    if (memory) return memory;
    try {
      const cached = localStorage.getItem(`p170_charts_state_${runId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .filter((item: ChartDraft) => item.question || item.execution || item.status !== "draft" || item.problem)
            .map((item) => ({
              ...item,
              insight: typeof item?.insight === "string" ? normalizeMarkdownText(item.insight) : item?.insight,
            }));
        }
      }
    } catch { }
    return [];
  });
  // Persist synchronously as the pipeline advances. React route changes can
  // unmount this component while preview/promote/insight requests continue.
  function setCharts(updater: React.SetStateAction<ChartDraft[]>) {
    const current = chartStateMemory.get(runId) ?? charts;
    const next = typeof updater === "function" ? updater(current) : updater;
    persistChartState(runId, next);
    rawSetCharts(next);
  }
  const [message, setMessage] = useState("");
  const [businessQuestion, setBusinessQuestion] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem(`p170_charts_question_${runId}`) || ""; } catch { return ""; }
  });
  const [pipeline, setPipeline] = useState<ChartPipelineState | null>(() => loadChartPipeline(runId));
  const [autoStage, rawSetAutoStage] = useState(() => loadChartPipeline(runId)?.step || "");
  const [autoProfileProgress, rawSetAutoProfileProgress] = useState<{ percent: number; step: string; current: number; total: number } | null>(() => {
    const active = loadChartPipeline(runId);
    return active?.kind === "profile_pack" ? { percent: active.percent, step: active.step, current: active.current ?? 0, total: active.total ?? 0 } : null;
  });
  const [autoQuestionProgress, rawSetAutoQuestionProgress] = useState<{ percent: number; step: string } | null>(() => {
    const active = loadChartPipeline(runId);
    return active?.kind === "questions" ? { percent: active.percent, step: active.step } : null;
  });
  const [retryingChartId, setRetryingChartId] = useState<string | null>(null);
  const [previewingChartId, setPreviewingChartId] = useState<string | null>(null);
  const [promotingChartId, setPromotingChartId] = useState<string | null>(null);
  const context = explorer.data?.context;
  const dimensions = context?.context.dimensions ?? [];
  const measures = context?.context.measures ?? [];

  function updatePipeline(kind: ChartPipelineKind, percent: number, step: string, current?: number, total?: number) {
    const next: ChartPipelineState = { kind, status: "running", percent, step, current, total, updatedAt: Date.now() };
    persistChartPipeline(runId, next);
    setPipeline(next);
    rawSetAutoStage(step);
    if (kind === "questions") rawSetAutoQuestionProgress({ percent, step });
    else rawSetAutoProfileProgress({ percent, step, current: current ?? 0, total: total ?? 0 });
  }

  function setAutoQuestionProgress(value: { percent: number; step: string } | null) {
    if (value) updatePipeline("questions", value.percent, value.step);
    else rawSetAutoQuestionProgress(null);
  }

  function setAutoProfileProgress(value: { percent: number; step: string; current: number; total: number } | null) {
    if (value) updatePipeline("profile_pack", value.percent, value.step, value.current, value.total);
    else rawSetAutoProfileProgress(null);
  }

  function setAutoStage(value: string) {
    rawSetAutoStage(value);
    const active = chartPipelineMemory.get(runId);
    if (!active || !value) return;
    const next = { ...active, step: value, updatedAt: Date.now() };
    persistChartPipeline(runId, next);
    setPipeline(next);
  }

  function finishPipeline(kind: ChartPipelineKind) {
    const current = chartPipelineMemory.get(runId);
    if (!current || current.kind !== kind) return;
    persistChartPipeline(runId, null);
    setPipeline(null);
  }

  useEffect(() => {
    if (typeof window === "undefined" || !runId) return;
    try {
      localStorage.setItem(`p170_charts_state_${runId}`, JSON.stringify(charts));
    } catch { }
  }, [charts, runId]);

  // Migrate chart drafts already held in memory (including Fast Refresh
  // sessions) so the edit textarea never receives a serialized content block.
  useEffect(() => {
    setCharts((current) => {
      let changed = false;
      const normalized = current.map((item) => {
        if (typeof item.insight !== "string") return item;
        const insight = normalizeMarkdownText(item.insight);
        if (insight === item.insight) return item;
        changed = true;
        return { ...item, insight };
      });
      return changed ? normalized : current;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !runId) return;
    try {
      localStorage.setItem(`p170_charts_question_${runId}`, businessQuestion);
    } catch { }
  }, [businessQuestion, runId]);

  useEffect(() => {
    if (typeof window === "undefined" || !runId) return;
    try {
      if (understanding) localStorage.setItem(`p170_charts_understanding_${runId}`, understanding);
      if (understandingRunId) localStorage.setItem(`p170_charts_understanding_run_${runId}`, understandingRunId);
    } catch { }
  }, [understanding, understandingRunId, runId]);

  const understand = useMutation({
    mutationFn: async () => {
      let answer = ""; let agentRunId: string | null = null;
      await streamQuestion({ question: "Hãy đọc Profile Run này và tóm tắt grain, dimension, measure, cột thời gian, rủi ro chất lượng và các bài toán biểu đồ phù hợp. Không suy đoán ngoài evidence.", profile_run_id: runId }, (event) => {
        if (event.event === "token" && event.data && typeof event.data === "object") answer += String((event.data as { text?: unknown }).text || "");
        if (event.event === "done" && event.data && typeof event.data === "object") agentRunId = String((event.data as { agent_run_id?: unknown }).agent_run_id || "") || null;
        if (event.event === "error") throw new Error(String((event.data as { detail?: unknown })?.detail || "Trợ lý AI không thể đọc hồ sơ."));
      });
      return { answer: answer || "Trợ lý AI không trả về bản tóm tắt.", agentRunId };
    },
    onSuccess: ({ answer, agentRunId }) => { setUnderstanding(answer); setUnderstandingRunId(agentRunId); setMessage("Trợ lý AI đã đọc hồ sơ. Bạn có thể bắt đầu chọn bài toán."); },
  });

  const autoProfile = useMutation({
    mutationFn: async () => {
      setAutoProfileProgress({ percent: 5, step: "Đang đọc ngữ cảnh hồ sơ và tạo danh mục gói phân tích…", current: 0, total: 0 });
      setAutoStage("Đang đọc ngữ cảnh hồ sơ và tạo gói phân tích…");
      const pack = await autoProfilePack(runId);
      const plans = pack.plans.slice(0, MAX_CHARTS);
      if (!plans.length) throw new Error("Profile Run không có trường tương thích để tạo gói phân tích tự động.");
      const plannedCharts = plans.map(chartFromPlan);
      const total = plans.length;
      setUnderstanding(`Gói phân tích tự động: ${pack.objectives.join(", ")}\n\nKế hoạch phân tích dựa trên Profile metadata đã duyệt.`);
      setUnderstandingRunId(pack.agent_run_id ?? null);
      setCharts((current) => [...plannedCharts, ...current.filter((item) => item.question)].slice(0, MAX_CHARTS));

      const completed: ChartDraft[] = [];
      for (let index = 0; index < total; index += 1) {
        const plan = plans[index];
        const planned = plannedCharts[index];
        const chartTitle = planned.title || planned.algorithm || `Biểu đồ ${index + 1}`;
        const basePercent = 10 + Math.round((index / total) * 85);
        try {
          const previewStep = `[${index + 1}/${total}] Đang chạy bản xem trước: ${chartTitle}`;
          setAutoStage(previewStep);
          setAutoProfileProgress({ percent: basePercent, step: previewStep, current: index + 1, total });
          const previewResult = await previewExplorer(runId, plan.query);
          setCharts((current) => current.map((item) => item.id === planned.id ? { ...item, execution: previewResult, status: "preview" } : item));

          const officialStep = `[${index + 1}/${total}] Đang tạo bằng chứng chính thức: ${chartTitle}`;
          setAutoStage(officialStep);
          setAutoProfileProgress({ percent: Math.min(basePercent + Math.round((0.3 / total) * 85), 94), step: officialStep, current: index + 1, total });
          const officialResult = await promoteExplorerPreview(runId, previewResult.id, previewResult.context_version_id ?? plan.context_version_id ?? context?.id ?? "");
          const officialChart: ChartDraft = { ...planned, execution: officialResult, status: "official", generated: true, insight_busy: true };
          setCharts((current) => current.map((item) => item.id === planned.id ? officialChart : item));

          const insightStep = `[${index + 1}/${total}] Trợ lý AI đang viết nhận định: ${chartTitle}`;
          setAutoStage(insightStep);
          setAutoProfileProgress({ percent: Math.min(basePercent + Math.round((0.6 / total) * 85), 98), step: insightStep, current: index + 1, total });
          const written = await writeInsightForChart(officialChart, (partialInsight) => {
            setCharts((current) => current.map((item) => item.id === planned.id ? {
              ...item, insight: partialInsight, insight_busy: true,
            } : item));
          });
          const finished = { ...officialChart, ...written, insight_busy: false, error: undefined };
          completed.push(finished);
          setCharts((current) => current.map((item) => item.id === planned.id ? finished : item));
        } catch (reason) {
          setCharts((current) => current.map((item) => item.id === planned.id ? {
            ...item,
            // A failed explanation must not erase a successfully re-run Official query.
            status: item.execution?.execution_kind === "official" ? "official" : "failed",
            insight_busy: false,
            error: reason instanceof Error ? reason.message : "Phân tích biểu đồ tự động thất bại.",
          } : item));
        }
      }
      setAutoProfileProgress({ percent: 100, step: `Đã hoàn tất phân tích ${completed.length}/${total} biểu đồ thành công!`, current: total, total });
      if (!completed.length) throw new Error("Không có biểu đồ nào hoàn tất thành công.");
      finishPipeline("profile_pack");
      return completed;
    },
    onSuccess: (completed) => {
      finishPipeline("profile_pack");
      setAutoStage("");
      setMessage(`Đã hoàn tất tự động phân tích ${completed.length} biểu đồ kèm bằng chứng chính thức và nhận định AI.`);
      setTimeout(() => setAutoProfileProgress(null), 400);
    },
    onError: () => {
      finishPipeline("profile_pack");
      setAutoStage("");
      setTimeout(() => setAutoProfileProgress(null), 400);
    },
  });

  const automate = useMutation({
    mutationFn: async () => {
      // Split questions by newline or semicolon, removing bullet points / numbering / question labels
      const questions = businessQuestion
        .split(/\n+|;+/)
        .map((q) => q.replace(/^(?:câu\s*hỏi\s*\d*[:.-]?\s*|câu\s*\d*[:.-]?\s*|\d+[\s.)\-:]\s*|[-*•]\s*)/i, "").trim())
        .filter((q) => q.length >= 3);

      if (!questions.length) throw new Error("Hãy nhập ít nhất một câu hỏi phân tích cụ thể.");
      const total = questions.length;
      const completed: ChartDraft[] = [];

      for (let index = 0; index < total; index += 1) {
        const question = questions[index];
        const basePercent = Math.round((index / total) * 100);
        let chartId: string | null = null;
        try {
          const stepPrefix = total > 1 ? `[${index + 1}/${total}] ` : "";
          setAutoQuestionProgress({ percent: basePercent + Math.round((0.15 / total) * 100), step: `${stepPrefix}Đang lập kế hoạch: "${question.slice(0, 45)}…"` });
          setAutoStage(`${stepPrefix}Trợ lý AI đang phân tích câu hỏi: "${question.slice(0, 45)}…"`);

          // Create a visible card before invoking the planner. If planning fails,
          // the question and its actionable error must remain visible to the user.
          const pending: ChartDraft = { ...draftChart(), question, title: question, status: "draft" };
          chartId = pending.id;
          setCharts((current) => current.length === 1 && !current[0].question ? [pending] : [pending, ...current]);

          const plan = await autoPlanChart(runId, question);
          const planned: ChartDraft = { ...chartFromPlan(plan), id: pending.id };

          if (index === 0 || total === 1) {
            setUnderstanding(`**Trợ lý AI đã hiểu yêu cầu:** ${plan.rationale}\n\nKế hoạch: ${PROBLEMS.find((item) => item.value === plan.problem)?.label} → ${ALGORITHM_LABELS[plan.algorithm]} → ${CHART_LABELS[plan.chart_type]} → ${RENDERER_LABELS[plan.renderer]}.`);
            setUnderstandingRunId(plan.agent_run_id ?? null);
          }

          setCharts((current) => current.map((item) => item.id === pending.id ? planned : item));

          setAutoQuestionProgress({ percent: basePercent + Math.round((0.45 / total) * 100), step: `${stepPrefix}Đang chạy bản xem trước DuckDB: ${planned.title || planned.algorithm}` });
          const previewResult = await previewExplorer(runId, plan.query);
          setCharts((current) => current.map((item) => item.id === planned.id ? { ...item, execution: previewResult, status: "preview" } : item));

          setAutoQuestionProgress({ percent: basePercent + Math.round((0.70 / total) * 100), step: `${stepPrefix}Đang tạo bằng chứng chính thức: ${planned.title || planned.algorithm}` });
          const officialResult = await promoteExplorerPreview(
            runId,
            previewResult.id,
            previewResult.context_version_id ?? plan.context_version_id ?? context?.id ?? "",
          );
          const officialChart: ChartDraft = { ...planned, execution: officialResult, status: "official", generated: true, insight_busy: true };
          setCharts((current) => current.map((item) => item.id === planned.id ? officialChart : item));

          setAutoQuestionProgress({ percent: basePercent + Math.round((0.90 / total) * 100), step: `${stepPrefix}Trợ lý AI đang viết nhận định: ${planned.title || planned.algorithm}` });
          const written = await writeInsightForChart(officialChart, (partialInsight) => {
            setCharts((current) => current.map((item) => item.id === planned.id ? {
              ...item, insight: partialInsight, insight_busy: true,
            } : item));
          });
          const finished = { ...officialChart, ...written, insight_busy: false, error: undefined };
          completed.push(finished);
          setCharts((current) => current.map((item) => item.id === planned.id ? finished : item));
        } catch (reason) {
          if (chartId) {
            setCharts((current) => current.map((item) => item.id === chartId ? {
              ...item,
              // Keep the verified evidence visible when only the insight step failed.
              status: item.execution?.execution_kind === "official" ? "official" : "failed",
              insight_busy: false,
              error: reason instanceof Error ? reason.message : "Không thể hoàn tất phân tích tự động.",
            } : item));
          }
        }
      }

      setAutoQuestionProgress({ percent: 100, step: `Đã hoàn tất tự động tạo ${completed.length}/${total} biểu đồ thành công!` });
      if (!completed.length) throw new Error("Không có câu hỏi nào được hoàn tất thành công.");
      finishPipeline("questions");
      return completed;
    },
    onSuccess: (completed) => {
      finishPipeline("questions");
      setBusinessQuestion("");
      setAutoStage("");
      setTimeout(() => setAutoQuestionProgress(null), 400);
      setMessage(`Trợ lý AI đã tự động tạo thành công ${completed.length} biểu đồ kèm số liệu và nhận định AI.`);
    },
    onError: () => {
      finishPipeline("questions");
      setAutoStage("");
      setTimeout(() => setAutoQuestionProgress(null), 400);
    },
  });

  async function retryChart(chart: ChartDraft) {
    setRetryingChartId(chart.id);
    let planned = chart;
    try {
      // A failure during planning has no executable fields yet, so plan the
      // original business question again. Other failures reuse the persisted,
      // bounded query so the retry is reproducible.
      if (!planned.problem || !planned.algorithm || !planned.chart_type || !planned.renderer) {
        const plan = await autoPlanChart(runId, planned.question);
        planned = { ...chartFromPlan(plan), id: chart.id };
      }

      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...item,
        ...planned,
        status: "draft",
        execution: undefined,
        generated: false,
        insight: undefined,
        insight_busy: false,
        insight_reviewed: false,
        pinned: false,
        error: undefined,
      } : item));

      const previewResult = await previewExplorer(runId, chartQuery(planned));
      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...item, execution: previewResult, status: "preview", error: undefined,
      } : item));

      const officialResult = await promoteExplorerPreview(
        runId,
        previewResult.id,
        previewResult.context_version_id ?? planned.execution?.context_version_id ?? context?.id ?? "",
      );
      const officialChart: ChartDraft = {
        ...planned,
        execution: officialResult,
        status: "official",
        generated: true,
        insight_busy: true,
      };
      setCharts((current) => current.map((item) => item.id === chart.id ? officialChart : item));

      const written = await writeInsightForChart(officialChart, (partialInsight) => {
        setCharts((current) => current.map((item) => item.id === chart.id ? {
          ...item, insight: partialInsight, insight_busy: true,
        } : item));
      });
      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...officialChart, ...written, insight_busy: false, error: undefined,
      } : item));
      setMessage(`Đã tạo lại biểu đồ "${chartDisplayTitle(officialChart)}" thành công.`);
    } catch (reason) {
      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...item,
        status: item.execution?.execution_kind === "official" ? "official" : "failed",
        insight_busy: false,
        error: reason instanceof Error ? reason.message : "Không thể chạy lại biểu đồ.",
      } : item));
    } finally {
      setRetryingChartId(null);
    }
  }

  const validCharts = useMemo(() => charts.filter((chart) => !analysisError(chart)), [charts]);

  async function runSinglePreview(chart: ChartDraft) {
    const error = analysisError(chart);
    if (error) {
      setMessage(error);
      return;
    }
    setPreviewingChartId(chart.id);
    setCharts((current) => current.map((item) => item.id === chart.id ? { ...item, status: "draft", error: undefined } : item));
    try {
      const previewResult = await previewExplorer(runId, chartQuery(chart));
      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...item, execution: previewResult, status: "preview", error: undefined, generated: false, insight: undefined,
      } : item));
      setMessage(`Đã chạy bản xem trước thành công cho "${chartDisplayTitle(chart)}".`);
    } catch (reason) {
      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...item, status: "failed", error: reason instanceof Error ? reason.message : "Bản xem trước thất bại.",
      } : item));
    } finally {
      setPreviewingChartId(null);
    }
  }

  async function runSinglePromote(chart: ChartDraft) {
    if (!chart.execution || chart.execution.execution_kind !== "preview") return;
    setPromotingChartId(chart.id);
    try {
      const officialResult = await promoteExplorerPreview(
        runId,
        chart.execution.id,
        chart.execution.context_version_id ?? context?.id ?? "",
      );
      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...item, execution: officialResult, status: "official", error: undefined,
      } : item));
      setMessage(`Đã xác nhận bằng chứng chính thức cho "${chartDisplayTitle(chart)}". Tiếp tục chọn loại biểu đồ và bộ hiển thị.`);
    } catch (reason) {
      setCharts((current) => current.map((item) => item.id === chart.id ? {
        ...item, status: "failed", error: reason instanceof Error ? reason.message : "Xác nhận chính thức thất bại.",
      } : item));
    } finally {
      setPromotingChartId(null);
    }
  }

  const preview = useMutation({
    mutationFn: async () => {
      if (!understanding && !context) throw new Error("Hãy để Trợ lý AI hiểu dữ liệu trước.");
      if (!validCharts.length) throw new Error("Hãy hoàn tất ít nhất một bài toán và thuật toán.");
      const results = await Promise.allSettled(validCharts.map((chart) => previewExplorer(runId, chartQuery(chart))));
      return { results, ids: validCharts.map((chart) => chart.id) };
    },
    onSuccess: ({ results, ids }) => { setCharts((current) => current.map((chart) => { const result = results[ids.indexOf(chart.id)]; if (!result) return chart; return result.status === "fulfilled" ? { ...chart, execution: result.value, status: "preview", error: undefined, generated: false, insight: undefined } : { ...chart, status: "failed", error: result.reason instanceof Error ? result.reason.message : "Preview thất bại." }; })); setMessage("Preview đã sẵn sàng. Hãy kiểm tra rồi xác nhận Official."); },
  });
  const promote = useMutation({
    mutationFn: async () => {
      const pending = charts.filter((chart) => chart.execution?.execution_kind === "preview");
      if (!pending.length) throw new Error("Chưa có Preview để xác nhận Official.");
      const results = await Promise.allSettled(pending.map((chart) => promoteExplorerPreview(runId, chart.execution!.id, chart.execution!.context_version_id ?? context?.id ?? "")));
      return { results, ids: pending.map((chart) => chart.id) };
    },
      onSuccess: ({ results, ids }) => { setCharts((current) => current.map((chart) => { const result = results[ids.indexOf(chart.id)]; if (!result) return chart; return result.status === "fulfilled" ? { ...chart, execution: result.value, status: "official", error: undefined } : { ...chart, status: "failed", error: result.reason instanceof Error ? result.reason.message : "Xác nhận chính thức thất bại." }; })); setMessage("Bằng chứng chính thức đã sẵn sàng. Tiếp tục chọn loại biểu đồ và bộ hiển thị."); },
  });

  async function writeInsightForChart(
    chart: ChartDraft,
    onProgress?: (partialInsight: string) => void,
  ): Promise<Partial<ChartDraft>> {
    if (!chart.execution || chart.execution.execution_kind !== "official" || !chart.chart_type || !chart.renderer) {
      throw new Error("Biểu đồ chưa có bằng chứng chính thức hợp lệ.");
    }
    let insight = ""; let agentRunId: string | null = null; let evidenceStatus = "unverified";
    await streamQuestion({
      question: `Hãy viết insight ngắn cho biểu đồ "${chartDisplayTitle(chart)}". Bài toán: ${chart.problem}. Thuật toán: ${chart.algorithm}. Chart: ${chart.chart_type}. Trình bày theo format Markdown bắt buộc in đậm các mục sau: **1. Xu hướng chính**, **2. Con số đáng chú ý**, **3. Giới hạn**, **4. Khuyến nghị**. Chỉ dùng Official execution đã bind.`,
      profile_run_id: runId,
      analysis_execution_id: chart.execution.id,
      workspace_context_version_id: chart.execution.context_version_id,
    }, (event) => {
      if (event.event === "token" && event.data && typeof event.data === "object") {
        insight += String((event.data as { text?: unknown }).text || "");
        onProgress?.(sanitizeGeneratedText(insight));
      }
      if (event.event === "done" && event.data && typeof event.data === "object") { const done = event.data as { agent_run_id?: unknown; evidence_status?: unknown }; agentRunId = String(done.agent_run_id || "") || null; evidenceStatus = String(done.evidence_status || evidenceStatus); }
      if (event.event === "error") throw new Error(String((event.data as { detail?: unknown })?.detail || "Agent không thể viết insight."));
    });
    return { generated: true, insight: sanitizeGeneratedText(normalizeMarkdownText(insight || "Agent không trả về insight.")), insight_agent_run_id: agentRunId, insight_evidence_status: evidenceStatus, insight_reviewed: false };
  }

  async function generateAndWriteInsight(chart: ChartDraft) {
    if (!chart.execution || chart.execution.execution_kind !== "official" || !chart.chart_type || !chart.renderer) return;
    setCharts((current) => current.map((item) => item.id === chart.id ? { ...item, generated: true, insight_busy: true, insight: undefined, insight_reviewed: false, pinned: false, pin_idempotency_key: crypto.randomUUID(), error: undefined } : item));
    try {
      const written = await writeInsightForChart(chart, (partialInsight) => {
        setCharts((current) => current.map((item) => item.id === chart.id ? {
          ...item, insight: partialInsight, insight_busy: true,
        } : item));
      });
      setCharts((current) => current.map((item) => item.id === chart.id ? { ...item, ...written, status: "official", insight_busy: false, error: undefined } : item));
    } catch (reason) {
      setCharts((current) => current.map((item) => item.id === chart.id ? { ...item, generated: true, insight_busy: false, error: reason instanceof Error ? reason.message : "Không thể viết insight." } : item));
    }
  }

  const pin = useMutation({
    mutationFn: async () => {
      const ready = charts.filter(generatedReady);
      if (!ready.length) throw new Error("Chưa có chart kèm insight để ghim.");
      const draft = await getProfileReportDraft(runId);
      const successfulIds: string[] = [];
      const errors: string[] = [];

      for (const chart of ready) {
        try {
          await pinChartToReport(
            draft.id,
            chart.execution!.id,
            chartDisplayTitle(chart),
            chartSpec(chart),
            { text: chart.insight!, reviewed: chart.insight_reviewed, agentRunId: chart.insight_agent_run_id || "" },
            chart.pin_idempotency_key || crypto.randomUUID(),
          );
          successfulIds.push(chart.id);
        } catch (reason) {
          errors.push(reason instanceof Error ? reason.message : "Lỗi khi ghim biểu đồ");
        }
      }

      if (!successfulIds.length && errors.length) throw new Error(errors[0]);
      return { ids: successfulIds, errors };
    },
    onSuccess: ({ ids, errors }) => {
      setCharts((current) => current.map((chart) => ids.includes(chart.id) ? { ...chart, pinned: true, insight_reviewed: true } : chart));
      setMessage(errors.length ? `Đã ghim ${ids.length} biểu đồ; ${errors.length} biểu đồ lỗi.` : `Đã ghim thành công toàn bộ ${ids.length} biểu đồ kèm nhận định vào bản nháp báo cáo.`);
      queryClient.invalidateQueries({ queryKey: ["command-center", runId, "report-draft"] });
      queryClient.invalidateQueries({ queryKey: ["report-draft", runId] });
    },
  });

  async function pinSingleChart(chart: ChartDraft) {
    if (!generatedReady(chart)) return;
    try {
      const draft = await getProfileReportDraft(runId);
      await pinChartToReport(
        draft.id,
        chart.execution!.id,
        chartDisplayTitle(chart),
        chartSpec(chart),
        { text: chart.insight!, reviewed: chart.insight_reviewed, agentRunId: chart.insight_agent_run_id || "" },
        chart.pin_idempotency_key || crypto.randomUUID(),
      );
      setCharts((current) => current.map((item) => item.id === chart.id ? { ...item, pinned: true, insight_reviewed: true } : item));
      setMessage(`Đã ghim "${chartDisplayTitle(chart)}" vào Báo cáo thành công!`);
      queryClient.invalidateQueries({ queryKey: ["command-center", runId, "report-draft"] });
      queryClient.invalidateQueries({ queryKey: ["report-draft", runId] });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Không thể ghim biểu đồ.");
    }
  }

  function updateChart(id: string, next: Partial<ChartDraft>) {
    const evidenceFields: Array<keyof ChartDraft> = ["question", "problem", "algorithm", "x_column", "y_column", "second_dimension", "time_grain", "date_from", "date_to", "forecast_horizon", "season_length", "chart_type", "renderer", "insight"];
    const queryFields: Array<keyof ChartDraft> = ["question", "problem", "algorithm", "x_column", "y_column", "second_dimension", "time_grain", "date_from", "date_to", "forecast_horizon", "season_length"];
    const changesEvidence = evidenceFields.some((field) => Object.prototype.hasOwnProperty.call(next, field));
    const changesQuery = queryFields.some((field) => Object.prototype.hasOwnProperty.call(next, field));
    setCharts((current) => current.map((chart) => chart.id === id ? {
      ...chart,
      ...next,
      ...(changesEvidence ? {
        pinned: false,
        pin_idempotency_key: crypto.randomUUID(),
        insight_reviewed: false,
        error: undefined,
        ...(changesQuery ? { planned_query: undefined, planning_mode: undefined, planner_agent_run_id: undefined, rationale: undefined } : {}),
        ...(next.insight === undefined ? { insight_agent_run_id: undefined, insight_evidence_status: undefined } : {}),
      } : {}),
    } : chart));
  }
  if (explorer.isError) return <ErrorNotice error={explorer.error} retry={() => explorer.refetch()} />;
  if (!explorer.isPending && !context) return <EmptyState title="Biểu đồ chưa có context" detail="Hãy hoàn tất Profile và review metadata trước khi tạo biểu đồ." />;
  const contextIsPreparing = explorer.isPending;
  const backgroundPipelineRunning = pipeline?.status === "running";
  const busy = backgroundPipelineRunning || autoProfile.isPending || automate.isPending || understand.isPending || preview.isPending || promote.isPending || pin.isPending;
  const forecastGroups = Object.entries((forecastCatalog.data?.algorithms ?? []).reduce<Record<string, ForecastAlgorithmCapability[]>>((groups, item) => {
    (groups[item.family] ||= []).push(item);
    return groups;
  }, {}));

  return <section className="command-charts">
    {contextIsPreparing && <Notice tone="info">Đang chuẩn bị metadata biểu đồ trong nền. Bạn có thể đọc và nhập câu hỏi trước; các nút tạo biểu đồ sẽ sẵn sàng ngay khi context hoàn tất.</Notice>}
    {profile.pending_proposals > 0 && (
      <Notice tone="warning">
        <b>Cần xem xét đề xuất trước khi tạo bằng chứng chính thức.</b>
        <p>Phiên profiling còn {profile.pending_proposals} đề xuất metadata/PII cần xác nhận. Hãy review để đảm bảo evidence và PII policy chính xác.</p>
        <Link href={`/profiles/${runId}/review?returnTo=${encodeURIComponent(`/charts?runId=${runId}`)}`} className="button primary" style={{ marginTop: "8px", display: "inline-block" }}>
          Xem xét {profile.pending_proposals} đề xuất →
        </Link>
      </Notice>
    )}
    {profile.status !== "completed" && (
      <Notice tone="warning">
        <b>Profile chưa hoàn tất ({profile.status}).</b>
        <p>Bằng chứng chính thức và xuất bản báo cáo chỉ khả dụng khi phiên lập hồ sơ đã ở trạng thái hoàn tất.</p>
      </Notice>
    )}

    {/* Step 2: Agent understanding panel when available */}
    {understanding && (
      <section className="panel chart-agent-understanding-panel" style={{ marginBottom: "1rem", border: "1px solid rgba(49, 94, 251, 0.25)", background: "rgba(49, 94, 251, 0.02)" }}>
        <div className="panel-title" style={{ marginBottom: "0.5rem" }}>
          <div>
            <span className="eyebrow" style={{ color: "#315efb", fontWeight: 700 }}>BƯỚC 2 · AGENT HIỂU DỮ LIỆU & SEMANTIC CONTEXT</span>
            <h3 style={{ margin: "2px 0 0", fontSize: "1.05rem" }}>Tóm tắt bối cảnh phân tích</h3>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => understand.mutate()}
            disabled={busy}
            style={{ fontSize: "0.78rem" }}
          >
            {understand.isPending ? "Đang đọc lại…" : "🔄 Đọc lại Profile"}
          </button>
        </div>
        <MarkdownContent text={understanding} className="report report-markdown" />
      </section>
    )}
    {/* Unified Hero Panel: Question Input + 1-Click Auto Analysis Pack */}
    <section className="panel chart-auto-profile-pack">
      <div className="panel-title" style={{ marginBottom: 10 }}>
        <div>
          <span className="eyebrow" style={{ color: "#315efb", fontWeight: 800 }}>VDaAgent · PHÂN TÍCH CHUYÊN SÂU THÔNG QUA BIỂU ĐỒ</span>
          <h3 style={{ margin: "4px 0 0", fontSize: "1.1rem", color: "#0c1a3a" }}>Bạn muốn phân tích câu hỏi gì từ dữ liệu?</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>
            Nhập câu hỏi bằng ngôn ngữ tự nhiên hoặc nhấn nút phân tích trọn gói. Trợ lý AI sẽ tự động tính toán qua DuckDB, vẽ biểu đồ và viết nhận định.
          </p>
        </div>
      </div>

      {/* Primary Input: Business Question */}
      <div className="chart-business-question-panel">
        <label className="chart-business-question" style={{ margin: 0 }}>
          <div className="chart-business-question-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 800, fontSize: "0.88rem", color: "#14254b" }}>
              💬 Nhập 1 hoặc nhiều câu hỏi phân tích (mỗi dòng 1 câu):
            </span>
            <small style={{ color: "#315efb", fontWeight: 700, fontSize: "0.76rem" }}>
              Hỗ trợ nhập danh sách nhiều câu hỏi cùng lúc
            </small>
          </div>
          <textarea
            className="chart-business-question-input"
            rows={6}
            maxLength={4000}
            value={businessQuestion}
            onChange={(event) => setBusinessQuestion(event.target.value)}
            placeholder={`Bạn có thể dán 1 hoặc nhiều câu hỏi, ví dụ:
1. So sánh số lượng tin tuyển dụng giữa các ngành công nghiệp (Industry) hàng đầu
2. Phân phối điểm đánh giá Rating của các công ty
3. Tỷ trọng phân bổ loại hình công ty Type of ownership`}
            disabled={busy}
          />
        </label>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="chart-action-buttons" style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="button primary chart-auto-submit chart-action-button"
              onClick={() => automate.mutate()}
              disabled={contextIsPreparing || busy || businessQuestion.trim().length < 3 || charts.filter((chart) => chart.question).length >= MAX_CHARTS}
              style={{ fontWeight: 800 }}
            >
              {automate.isPending ? `Trợ lý AI đang xử lý (${autoQuestionProgress?.percent ?? 0}%)` : "✨ Trợ lý AI tự động tạo biểu đồ"}
            </button>

            <button
              type="button"
              className="button secondary chart-action-button"
              onClick={() => autoProfile.mutate()}
              disabled={contextIsPreparing || busy}
              style={{ fontWeight: 700, border: "1px solid #b2cbfd", background: "#f0f5ff" }}
            >
              {autoProfile.isPending ? `Đang tạo gói phân tích (${autoProfileProgress?.percent ?? 0}%)` : "⚡ Hoặc tự động tạo trọn gói 5–8 biểu đồ"}
            </button>

            <button
              type="button"
              className="button secondary chart-action-button"
              onClick={() => understand.mutate()}
              disabled={busy}
              style={{ fontWeight: 600 }}
            >
              {understand.isPending ? "Trợ lý AI đang đọc hồ sơ…" : "🔍 Cho Trợ lý AI hiểu dữ liệu"}
            </button>

            {charts.some((c) => c.question || c.generated || c.status === "failed") && (
              <button
                type="button"
                className="button secondary chart-action-button"
                onClick={() => {
                  setCharts([draftChart()]);
                  setMessage("Đã làm sạch danh sách biểu đồ cũ.");
                }}
                disabled={busy}
                style={{ color: "#dc2626", borderColor: "rgba(239, 68, 68, 0.3)" }}
              >
                🗑️ Xóa danh sách cũ
              </button>
            )}
          </div>

          <div className="chart-agent-facts" style={{ margin: 0 }}>
            <span><b>{profile.column_count}</b> cột</span>
            <span><b>{dimensions.length}</b> dimensions</span>
            <span><b>{measures.length}</b> measures</span>
          </div>
        </div>

        <div style={{ fontSize: "0.78rem", color: "var(--muted)", paddingTop: "4px" }}>
          💡 Gợi ý bấm nhanh:
          <button type="button" className="button link-button" style={{ marginLeft: 6, fontWeight: 600 }} onClick={() => setBusinessQuestion("So sánh số lượng tin tuyển dụng giữa các ngành công nghiệp (Industry) hàng đầu")}>
            "So sánh theo Industry"
          </button> ·
          <button type="button" className="button link-button" style={{ marginLeft: 4, fontWeight: 600 }} onClick={() => setBusinessQuestion("Phân phối điểm đánh giá Rating của các công ty")}>
            "Phân phối Rating"
          </button> ·
          <button type="button" className="button link-button" style={{ marginLeft: 4, fontWeight: 600 }} onClick={() => setBusinessQuestion("Tỷ trọng loại hình công ty Type of ownership")}>
            "Tỷ trọng Type of ownership"
          </button>
        </div>
      </div>

      {/* Progress Bars */}
      {autoQuestionProgress && (
        <div className="chart-progress-card" role="status" aria-live="polite">
          <div className="chart-progress-header">
            <div>
              <span className="eyebrow">TIẾN ĐỘ XỬ LÝ CÂU HỎI</span>
              <h4>{autoQuestionProgress.step}</h4>
            </div>
            <div className="chart-progress-badge">
              {autoQuestionProgress.percent}%
            </div>
          </div>
          <div className="chart-progress-track">
            <div
              className="chart-progress-fill"
              style={{ width: `${autoQuestionProgress.percent}%` }}
            />
          </div>
          <div className="chart-progress-footer">
            <span>Quy trình: Ý định → đặc tả truy vấn → Bản xem trước DuckDB → Bằng chứng chính thức → Nhận định AI</span>
            <span className="chart-progress-time-hint">Bảo đảm độ chính xác 100% theo bằng chứng chính thức</span>
          </div>
        </div>
      )}

      {autoProfileProgress && (
        <div className="chart-progress-card" role="status" aria-live="polite">
          <div className="chart-progress-header">
            <div>
              <span className="eyebrow">TIẾN ĐỘ TẠO GÓI ANALYSIS PACK (5–8 BIỂU ĐỒ)</span>
              <h4>{autoProfileProgress.step}</h4>
            </div>
            <div className="chart-progress-badge">
              {autoProfileProgress.percent}%
            </div>
          </div>
          <div className="chart-progress-track">
            <div
              className="chart-progress-fill"
              style={{ width: `${autoProfileProgress.percent}%` }}
            />
          </div>
          <div className="chart-progress-footer">
            <span>{autoProfileProgress.total > 0 ? `Tiến độ: Biểu đồ ${autoProfileProgress.current}/${autoProfileProgress.total}` : "Đang đọc ngữ cảnh hồ sơ..."}</span>
            <span className="chart-progress-time-hint">Mỗi biểu đồ được tính toán qua DuckDB và Trợ lý AI viết nhận định</span>
          </div>
        </div>
      )}

      {autoStage && !autoProfileProgress && !autoQuestionProgress && <div className="chart-auto-stage"><span className="loading-dot" />{autoStage}</div>}

      {/* Visual Workflow Steps */}
      <ol className="chart-workflow-map auto-profile-workflow-map" style={{ marginTop: 14 }}>
        <li className="done">Dataset</li>
        <li className="done">Phiên lập hồ sơ</li>
        <li className={understanding ? "done" : "active"}>Ngữ cảnh hồ sơ</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 10 ? "active" : ""}>Gói phân tích</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 25 ? "active" : ""}>Bản xem trước giới hạn</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 50 ? "active" : ""}>Kết quả chính thức</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 70 ? "active" : ""}>ChartSpec + renderer</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 85 ? "active" : ""}>Multiple charts</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 95 ? "active" : ""}>Nhận định dựa trên bằng chứng</li>
        <li className={autoProfileProgress && autoProfileProgress.percent === 100 ? "done" : ""}>Xem xét & Báo cáo</li>
      </ol>
    </section>

    {message && <Notice tone="info">{message}</Notice>}
    {[autoProfile, automate, understand, preview, promote, pin].map((mutation, index) => mutation.isError ? <ErrorNotice key={index} error={mutation.error} retry={() => mutation.reset()} /> : null)}

    {charts.length > 0 && (
      <>
        {/* Header & Workspace */}
        <header className="command-charts-header">
          <div>
            <p className="eyebrow">CÂU HỎI → BIỂU ĐỒ → INSIGHT</p>
            <h2>Workspace Biểu đồ</h2>
          </div>
          <div className="chart-workspace-count">
            <strong>{charts.length}/{MAX_CHARTS}</strong>
            <span>bài phân tích</span>
          </div>
        </header>

        <div className="chart-builder-list">
          {charts.map((chart) => (
            <ChartWorkflowCard
              key={chart.id}
              chart={chart}
              dimensions={dimensions}
              measures={measures}
              forecastAlgorithms={forecastCatalog.data?.algorithms ?? []}
              enabled={!busy}
              onChange={(next) => updateChart(chart.id, next)}
              onRemove={() => setCharts((current) => current.filter((item) => item.id !== chart.id))}
              onGenerate={() => void generateAndWriteInsight(chart)}
              onRetry={() => void retryChart(chart)}
              retrying={retryingChartId === chart.id}
              onExplain={onExplain}
              onPin={() => void pinSingleChart(chart)}
              onSinglePreview={() => void runSinglePreview(chart)}
              onSinglePromote={() => void runSinglePromote(chart)}
              previewing={previewingChartId === chart.id}
              promoting={promotingChartId === chart.id}
            />
          ))}
        </div>
      </>
    )}
    {charts.some((chart) => chart.question) && (
      <aside className="report-toc-sidebar">
        <div className="report-toc-container">
          <h3 className="report-toc-title">Danh mục biểu đồ</h3>
          <ul className="report-toc-list">
            {charts.map(chart => (
              <li key={chart.id}>
                <a href={`#${chart.id}`} onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(chart.id)?.scrollIntoView({ behavior: "smooth" });
                }}>
                  <span>{chartDisplayTitle(chart)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    )}
  </section>;
}
