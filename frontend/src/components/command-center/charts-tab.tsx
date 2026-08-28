"use client";

import { MarkdownContent, normalizeMarkdownText } from "@/components/markdown";
import { EmptyState, ErrorNotice, Notice } from "@/components/ui";
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
  pin_busy?: boolean;
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
  naive: "Naive Forecast", seasonal_naive: "Seasonal Naive", drift: "Drift Method", moving_average: "Moving Average", weighted_moving_average: "Weighted Moving Average",
  ses: "Simple Exponential Smoothing (SES)", holt_linear: "Holt’s Linear Trend", holt_winters: "Holt-Winters", ets: "ETS",
  arima: "ARIMA", sarima: "SARIMA", auto_arima: "Auto-ARIMA",
  structural_time_series: "Structural Time Series", local_level: "Local Level Model", local_linear_trend: "Local Linear Trend", kalman_filter: "Kalman Filter", dynamic_linear_model: "Dynamic Linear Model", unobserved_components: "Unobserved Components Model",
  prophet: "Prophet", neuralprophet: "NeuralProphet", linear_regression: "Linear Regression", ridge: "Ridge Regression", lasso: "Lasso", random_forest: "Random Forest", extra_trees: "Extra Trees", xgboost: "XGBoost", lightgbm: "LightGBM", catboost: "CatBoost",
};
const FORECAST_IDS = Object.keys(FORECAST_LABELS) as ForecastAlgorithm[];
const FORECAST_FAMILY_LABELS: Record<string, string> = { baseline: "Baseline / đơn giản", exponential_smoothing: "Exponential Smoothing", arima: "ARIMA family", state_space: "State Space / Statistical", decomposable: "Prophet / decomposable", machine_learning: "Machine Learning" };
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
const CHART_LABELS: Record<ChartType, string> = { line: "Line · xu hướng", bar: "Bar · so sánh", table: "Table · chi tiết", kpi: "KPI · tổng hợp", histogram: "Histogram · phân phối", scatter: "Scatter · mật độ", box: "Box plot · năm số", heatmap: "Heatmap · hai chiều", missing_bar: "Missing Value Bar", missing_heatmap: "Missing Value Heatmap", correlation_heatmap: "Correlation Heatmap", cardinality: "Cardinality Chart", violin: "Violin Plot", donut: "Pie / Donut", outlier: "Outlier Chart", map: "Bản đồ Địa lý" };
const RENDERER_FOR_CHART: Record<ChartType, ChartRenderer> = { line: "native-svg", bar: "native-css", table: "native-html", kpi: "native-kpi", histogram: "native-svg", scatter: "native-svg", box: "native-svg", heatmap: "native-grid", missing_bar: "native-css", missing_heatmap: "native-grid", correlation_heatmap: "native-grid", cardinality: "native-css", violin: "native-svg", donut: "native-svg", outlier: "native-css", map: "native-css" };
const RENDERER_LABELS: Record<ChartRenderer, string> = { "native-svg": "Native SVG", "native-css": "CSS Bars", "native-html": "HTML Table", "native-kpi": "Native KPI", "native-grid": "Native Grid" };

function draftChart(): ChartDraft {
  return {
    id: `chart-${crypto.randomUUID()}`, question: "", problem: "", algorithm: "", x_column: "", y_column: "", second_dimension: "",
    time_grain: "", date_from: "", date_to: "", forecast_horizon: 12, season_length: 12, chart_type: "", renderer: "", title: "", status: "draft", generated: false,
    insight_reviewed: false, pin_idempotency_key: crypto.randomUUID(),
  };
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
    && !chart.pin_busy
    && !chart.pinned
  );
}

function ChartWorkflowCard({ chart, dimensions, measures, forecastAlgorithms, enabled, onChange, onRemove, onGenerate, onExplain, onPin }: {
  chart: ChartDraft;
  dimensions: string[];
  measures: string[];
  forecastAlgorithms: ForecastAlgorithmCapability[];
  enabled: boolean;
  onChange: (next: Partial<ChartDraft>) => void;
  onRemove: () => void;
  onGenerate: () => void;
  onExplain: (execution: AnalysisExecution) => void;
  onPin?: () => void;
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
  return <article id={chart.id} className="panel chart-builder-card chart-workflow-card">
    <header className="chart-card-header">
      <div>
        <span className="eyebrow">ANALYSIS {chart.id.slice(-4)}</span>
        <h3>{displayTitle}</h3>
      </div>
      <div className="inline-actions" style={{ alignItems: "center", gap: "8px" }}>
        {chart.pin_busy || chart.pinned ? (
          <span className={`chip chart-pin-status ${chart.pin_busy ? "pending" : "confirmed"}`} role="status" aria-live="polite">
            {chart.pin_busy ? <><span className="button-spinner small" aria-hidden="true" /> Đang ghim…</> : <><span aria-hidden="true">✓</span> Đã ghim vào Báo cáo</>}
          </span>
        ) : (
          generatedReady(chart) && onPin && (
            <button
              type="button"
              className="button primary chart-pin-button"
              style={{ padding: "4px 10px", fontSize: "0.78rem", fontWeight: 700 }}
              onClick={onPin}
            >
              📌 Ghim vào Báo cáo
            </button>
          )
        )}
        <span className={`chip ${chart.status === "official" ? "success" : chart.status === "preview" ? "warning" : chart.status === "failed" ? "danger" : ""}`}>
          {chart.status === "official" ? "Official" : chart.status === "preview" ? "Preview" : chart.status === "failed" ? "Lỗi" : "Nháp"}
        </span>
        <button type="button" className="button danger chart-remove" onClick={onRemove}>Xóa</button>
      </div>
    </header>
    <fieldset className="chart-workflow-fieldset" disabled={!enabled}>
      {chart.problem && chart.algorithm && chart.chart_type && chart.renderer && <div className="chart-auto-decision"><div className="chart-auto-decision-chips"><span className="chip">{PROBLEMS.find((item) => item.value === chart.problem)?.label}</span><span className="chip">{ALGORITHM_LABELS[chart.algorithm]}</span><span className="chip">{CHART_LABELS[chart.chart_type]}</span><span className="chip">{RENDERER_LABELS[chart.renderer]}</span>{chart.planning_mode && <span className={`chip ${chart.planning_mode === "agent" ? "success" : "warning"}`}>{chart.planning_mode === "agent" ? "Agent đã lập kế hoạch" : "Kế hoạch dự phòng"}</span>}</div>{chart.rationale && <p>{chart.rationale}</p>}{chart.transforms && chart.transforms.length > 0 && <div className="chart-formulation-pipeline" style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "rgba(99, 102, 241, 0.08)", borderRadius: "6px", fontSize: "0.8rem" }}><div style={{ fontWeight: 600, color: "#4338ca", marginBottom: "0.25rem" }}>⚡ Data Formulation Pipeline (AI Wrangling)</div><div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>{chart.transforms.map((t, idx) => <span key={idx} className="chip" style={{ fontSize: "0.75rem", background: "#e0e7ff", color: "#3730a3" }}>{idx + 1}. {t.detail}</span>)}</div></div>}</div>}
      <details className="chart-advanced" open={!chart.problem}>
        <summary>Tùy chỉnh nâng cao · xem hoặc thay đổi quyết định kỹ thuật</summary>
        <div className="chart-flow-section"><span className="chart-flow-number">3</span><div><b>Chọn bài toán</b><p>Nhập câu hỏi và xác nhận loại bài toán cần giải quyết.</p></div></div>
        <div className="chart-config-fields chart-step-fields">
          <label>Câu hỏi<input value={chart.question} placeholder="Ví dụ: Doanh số thay đổi thế nào trong 12 tháng?" onChange={(event) => onChange({ question: event.target.value, title: event.target.value, status: "draft", execution: undefined, generated: false, insight: undefined })} /></label>
          <label>Bài toán<select value={chart.problem} onChange={(event) => onChange({ problem: event.target.value as ProblemType, algorithm: "", chart_type: "", renderer: "", status: "draft", execution: undefined, generated: false, insight: undefined })}><option value="">Chọn bài toán</option>{PROBLEMS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          {chart.problem && <p className="chart-step-hint">{PROBLEMS.find((item) => item.value === chart.problem)?.detail}</p>}
        </div>
        <div className="chart-flow-section"><span className="chart-flow-number">4</span><div><b>Chọn thuật toán</b><p>Chỉ các phép tính nằm trong bounded allow-list được hiển thị.</p></div></div>
        <div className="chart-config-fields chart-step-fields">
          <label>Thuật toán<select value={chart.algorithm} disabled={!chart.problem} onChange={(event) => onChange({ algorithm: event.target.value as AnalysisMethod, x_column: "", y_column: "", second_dimension: "", chart_type: "", renderer: "", status: "draft", execution: undefined, generated: false, insight: undefined })}><option value="">Chọn thuật toán</option>{algorithms.map((item) => { const capability = chart.problem === "forecast" ? forecastAlgorithms.find((entry) => entry.id === item) : undefined; return <option value={item} key={item} disabled={chart.problem === "forecast" ? !capability?.available : false}>{ALGORITHM_LABELS[item]}{chart.problem === "forecast" && capability && !capability.available ? ` · chưa khả dụng (${capability.dependency || "cần dữ liệu ngoại sinh"})` : ""}</option>; })}</select></label>
          <label>{chart.algorithm === "scatter" ? "Measure trục X" : chart.algorithm === "heatmap" ? "Dimension trục X" : "Dimension / nhóm"}<select value={chart.x_column} disabled={!chart.problem || chart.problem === "summary" || chart.algorithm === "histogram"} onChange={(event) => onChange({ x_column: event.target.value, status: "draft", execution: undefined, generated: false, insight: undefined })}><option value="">{chart.algorithm === "box" ? "Không chia nhóm" : "Chọn trường"}</option>{(chart.algorithm === "scatter" ? measures : dimensions).map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          {chart.algorithm === "heatmap" && <label>Dimension trục Y<select value={chart.second_dimension} onChange={(event) => onChange({ second_dimension: event.target.value, status: "draft", execution: undefined, generated: false, insight: undefined })}><option value="">Chọn dimension thứ hai</option>{dimensions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>}
          <label>{chart.algorithm === "scatter" ? "Measure trục Y" : "Measure"}<select value={chart.y_column} disabled={!chart.algorithm || chart.algorithm === "count" || chart.algorithm === "heatmap"} onChange={(event) => onChange({ y_column: event.target.value, status: "draft", execution: undefined, generated: false, insight: undefined })}><option value="">{chart.algorithm === "count" || chart.algorithm === "heatmap" ? "Không cần measure" : "Chọn measure"}</option>{measures.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          {["trend", "forecast"].includes(chart.problem) && <label>Mức thời gian<select value={chart.time_grain} onChange={(event) => onChange({ time_grain: event.target.value as ChartDraft["time_grain"], status: "draft", execution: undefined, generated: false, insight: undefined })}><option value="">Chọn mức thời gian</option><option value="day">Theo ngày</option><option value="week">Theo tuần</option><option value="month">Theo tháng</option><option value="quarter">Theo quý</option><option value="year">Theo năm</option></select></label>}
          {chart.problem === "forecast" && <label>Số kỳ cần dự báo<input type="number" min={1} max={60} value={chart.forecast_horizon} onChange={(event) => onChange({ forecast_horizon: Number(event.target.value), status: "draft", execution: undefined, generated: false, insight: undefined })} /></label>}
          {chart.problem === "forecast" && <label>Độ dài mùa vụ<input type="number" min={2} max={365} value={chart.season_length} onChange={(event) => onChange({ season_length: Number(event.target.value), status: "draft", execution: undefined, generated: false, insight: undefined })} /></label>}
          {chart.problem === "trend" && <label>Từ ngày (không bắt buộc)<input type="date" value={chart.date_from} onChange={(event) => onChange({ date_from: event.target.value, status: "draft", execution: undefined, generated: false, insight: undefined })} /></label>}
          {chart.problem === "trend" && <label>Đến ngày (không bắt buộc)<input type="date" value={chart.date_to} onChange={(event) => onChange({ date_to: event.target.value, status: "draft", execution: undefined, generated: false, insight: undefined })} /></label>}
          {validation && <p className="chart-validation">{validation}</p>}
          {chart.error && <p className="chart-validation">{chart.error}</p>}
        </div>
        <div className="chart-flow-section"><span className="chart-flow-number">5</span><div><b>Phân tích kết quả</b><p>Chạy Preview, kiểm tra kết quả rồi xác nhận Official evidence.</p></div></div>
        {chart.execution ? <div className="chart-analysis-summary"><span className={official ? "chip success" : "chip warning"}>{official ? "Official" : "Preview"}</span><span>{chart.execution.query_summary}</span><code>{chart.execution.result_hash.slice(0, 12)}</code></div> : <div className="chart-empty-stage">Kết quả sẽ xuất hiện sau khi chạy Preview tất cả.</div>}
        <div className="chart-flow-section"><span className="chart-flow-number">6</span><div><b>Chọn loại biểu đồ</b><p>Loại chart chỉ được chọn sau khi có Official result.</p></div></div>
        <div className="chart-config-fields chart-step-fields"><label>Loại biểu đồ<select value={chart.chart_type} disabled={!official} onChange={(event) => { const chartType = event.target.value as ChartType; onChange({ chart_type: chartType, renderer: "", generated: false, insight: undefined }); }}><option value="">Chọn loại biểu đồ</option>{chartTypes.map((item) => <option value={item} key={item}>{CHART_LABELS[item]}</option>)}</select></label></div>
        <div className="chart-flow-section"><span className="chart-flow-number">7</span><div><b>Chọn tool vẽ</b><p>Renderer được giới hạn theo loại biểu đồ để kết quả tái tạo được.</p></div></div>
        <div className="chart-config-fields chart-step-fields"><label>Renderer<select value={chart.renderer} disabled={!chart.chart_type} onChange={(event) => onChange({ renderer: event.target.value as ChartRenderer, generated: false, insight: undefined })}><option value="">Chọn renderer</option>{chart.chart_type && <option value={RENDERER_FOR_CHART[chart.chart_type]}>{RENDERER_LABELS[RENDERER_FOR_CHART[chart.chart_type]]}</option>}</select></label></div>
      </details>
      <div className="chart-flow-section">
        <span className="chart-flow-number chart-flow-icon" aria-hidden="true" title="Biểu đồ & Insight">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </span>
        <div><b>Sinh biểu đồ và Agent viết insight</b><p>Chart được render từ aggregate result; Agent đọc toàn bộ Official evidence để viết phân tích sâu gồm kết luận, bằng chứng, diễn giải, điểm cần chú ý và hành động.</p></div>
        <button type="button" className="button primary" disabled={!official || !chart.chart_type || !chart.renderer || chart.insight_busy} onClick={onGenerate}>{chart.insight_busy ? "Agent đang viết insight…" : "Sinh biểu đồ & viết insight"}</button>
      </div>
      {chart.generated && chart.execution && chart.chart_type && chart.renderer && <div className="chart-generated-grid"><div className="chart-result-canvas"><div className="chart-result-heading"><div className="chart-result-heading-main"><strong>{displayTitle}</strong><div className="chart-selected-meta"><span className={`chart-fit-badge ${selectionExplanation.confidence}`}>{selectionExplanation.confidence === "high" ? "✓ Phù hợp với dữ liệu" : "Cần xem lại"}</span><span className="chart-type-badge">{CHART_LABELS[chart.chart_type]}</span></div></div><small>{RENDERER_LABELS[chart.renderer]}</small></div><div className={`chart-selection-note ${selectionExplanation.confidence}`}><span className="chart-selection-note-icon" aria-hidden="true">i</span><div><b>Recommended: {CHART_LABELS[chart.chart_type]}</b><span>Analysis: {chart.problem}</span></div><details><summary>Why?</summary><ul>{chart.rationale ? <li>{chart.rationale}</li> : selectionExplanation.checks.map((check) => <li key={check}>{check}</li>)}</ul></details></div><ChartEvidenceView chartSpec={chartSpec(chart)} result={chart.execution.result} querySpec={chart.execution.query_spec} title={displayTitle} /></div><section className="chart-insight-panel"><span className="eyebrow">AGENT INSIGHT · CẦN DUYỆT</span>{chart.insight ? <><MarkdownContent text={chart.insight} className="report report-markdown" /><label className="chart-insight-editor">Chỉnh sửa insight trước khi ghim<textarea value={chart.insight} maxLength={20000} rows={7} onChange={(event) => onChange({ insight: event.target.value, insight_reviewed: false })} /></label><label className="chart-insight-review"><input type="checkbox" checked={chart.insight_reviewed} onChange={(event) => onChange({ insight_reviewed: event.target.checked })} /> Tôi đã đối chiếu insight với biểu đồ và Official evidence.</label></> : <p className="muted">Agent chưa tạo được insight.</p>}{chart.insight_evidence_status && <small className="muted">Evidence: {chart.insight_evidence_status}</small>}</section></div>}
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
  const [charts, setCharts] = useState<ChartDraft[]>(() => {
    if (typeof window === "undefined") return [draftChart()];
    try {
      const cached = localStorage.getItem(`p170_charts_state_${runId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item) => ({
            ...item,
            insight: typeof item?.insight === "string" ? normalizeMarkdownText(item.insight) : item?.insight,
          }));
        }
      }
    } catch { }
    return [draftChart()];
  });
  const [message, setMessage] = useState("");
  const [businessQuestion, setBusinessQuestion] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem(`p170_charts_question_${runId}`) || ""; } catch { return ""; }
  });
  const [autoStage, setAutoStage] = useState("");
  const [autoProfileProgress, setAutoProfileProgress] = useState<{ percent: number; step: string; current: number; total: number } | null>(null);
  const [autoQuestionProgress, setAutoQuestionProgress] = useState<{ percent: number; step: string } | null>(null);
  const context = explorer.data?.context;
  const dimensions = context?.context.dimensions ?? [];
  const measures = context?.context.measures ?? [];

  useEffect(() => {
    if (typeof window === "undefined" || !runId) return;
    try {
      // Do not persist the transient optimistic state. A reload during an
      // in-flight request should not leave a chart stuck in "Đang ghim…".
      localStorage.setItem(`p170_charts_state_${runId}`, JSON.stringify(charts.map((chart) => ({
        ...chart,
        pin_busy: undefined,
        ...(chart.pin_busy ? { pinned: false } : {}),
      }))));
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
        if (event.event === "error") throw new Error(String((event.data as { detail?: unknown })?.detail || "Agent không thể đọc Profile."));
      });
      return { answer: answer || "Agent không trả về bản tóm tắt.", agentRunId };
    },
    onSuccess: ({ answer, agentRunId }) => { setUnderstanding(answer); setUnderstandingRunId(agentRunId); setMessage("Agent đã đọc Profile. Bạn có thể bắt đầu chọn bài toán."); },
  });

  const autoProfile = useMutation({
    mutationFn: async () => {
      setAutoProfileProgress({ percent: 5, step: "Đang đọc Profile Context và tạo danh mục Analysis Pack…", current: 0, total: 0 });
      setAutoStage("Đang đọc Profile Context và tạo Analysis Pack…");
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
          const previewStep = `[${index + 1}/${total}] Đang chạy Preview: ${chartTitle}`;
          setAutoStage(previewStep);
          setAutoProfileProgress({ percent: basePercent, step: previewStep, current: index + 1, total });
          const previewResult = await previewExplorer(runId, plan.query);
          setCharts((current) => current.map((item) => item.id === planned.id ? { ...item, execution: previewResult, status: "preview" } : item));

          const officialStep = `[${index + 1}/${total}] Đang tạo Official evidence: ${chartTitle}`;
          setAutoStage(officialStep);
          setAutoProfileProgress({ percent: Math.min(basePercent + Math.round((0.3 / total) * 85), 94), step: officialStep, current: index + 1, total });
          const officialResult = await promoteExplorerPreview(runId, previewResult.id, previewResult.context_version_id ?? plan.context_version_id ?? context?.id ?? "");
          const officialChart: ChartDraft = { ...planned, execution: officialResult, status: "official", generated: true, insight_busy: true };
          setCharts((current) => current.map((item) => item.id === planned.id ? officialChart : item));

          const insightStep = `[${index + 1}/${total}] Agent đang viết AI Insight: ${chartTitle}`;
          setAutoStage(insightStep);
          setAutoProfileProgress({ percent: Math.min(basePercent + Math.round((0.6 / total) * 85), 98), step: insightStep, current: index + 1, total });
          const written = await writeInsightForChart(officialChart);
          const finished = { ...officialChart, ...written, insight_busy: false };
          completed.push(finished);
          setCharts((current) => current.map((item) => item.id === planned.id ? finished : item));
        } catch (reason) {
          setCharts((current) => current.map((item) => item.id === planned.id ? { ...item, status: "failed", insight_busy: false, error: reason instanceof Error ? reason.message : "Phân tích biểu đồ tự động thất bại." } : item));
        }
      }
      setAutoProfileProgress({ percent: 100, step: `Đã hoàn tất phân tích ${completed.length}/${total} biểu đồ thành công!`, current: total, total });
      if (!completed.length) throw new Error("Không có biểu đồ nào hoàn tất thành công.");
      return completed;
    },
    onSuccess: (completed) => {
      setAutoStage("");
      setMessage(`Đã hoàn tất tự động phân tích ${completed.length} biểu đồ kèm Official evidence và AI insight.`);
      setTimeout(() => setAutoProfileProgress(null), 3500);
    },
    onError: () => {
      setAutoStage("");
      setTimeout(() => setAutoProfileProgress(null), 3000);
    },
  });

  const automate = useMutation({
    mutationFn: async () => {
      // Split questions by newline or semicolon, removing bullet points / numbering
      const questions = businessQuestion
        .split(/\n+|;+/)
        .map((q) => q.replace(/^[\d\s.\-•*]+/, "").trim())
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
          setAutoStage(`${stepPrefix}Agent đang phân tích câu hỏi: "${question.slice(0, 45)}…"`);

          const plan = await autoPlanChart(runId, question);
          const planned = chartFromPlan(plan);
          chartId = planned.id;

          if (index === 0 || total === 1) {
            setUnderstanding(`**Agent đã hiểu yêu cầu:** ${plan.rationale}\n\nKế hoạch: ${PROBLEMS.find((item) => item.value === plan.problem)?.label} → ${ALGORITHM_LABELS[plan.algorithm]} → ${CHART_LABELS[plan.chart_type]} → ${RENDERER_LABELS[plan.renderer]}.`);
            setUnderstandingRunId(plan.agent_run_id ?? null);
          }

          setCharts((current) => current.length === 1 && !current[0].question ? [planned] : [planned, ...current]);

          setAutoQuestionProgress({ percent: basePercent + Math.round((0.45 / total) * 100), step: `${stepPrefix}Đang chạy DuckDB Preview: ${planned.title || planned.algorithm}` });
          const previewResult = await previewExplorer(runId, plan.query);
          setCharts((current) => current.map((item) => item.id === planned.id ? { ...item, execution: previewResult, status: "preview" } : item));

          setAutoQuestionProgress({ percent: basePercent + Math.round((0.70 / total) * 100), step: `${stepPrefix}Đang tạo Official evidence: ${planned.title || planned.algorithm}` });
          const officialResult = await promoteExplorerPreview(
            runId,
            previewResult.id,
            previewResult.context_version_id ?? plan.context_version_id ?? context?.id ?? "",
          );
          const officialChart: ChartDraft = { ...planned, execution: officialResult, status: "official", generated: true, insight_busy: true };
          setCharts((current) => current.map((item) => item.id === planned.id ? officialChart : item));

          setAutoQuestionProgress({ percent: basePercent + Math.round((0.90 / total) * 100), step: `${stepPrefix}Agent đang viết AI Insight: ${planned.title || planned.algorithm}` });
          const written = await writeInsightForChart(officialChart);
          const finished = { ...officialChart, ...written, insight_busy: false };
          completed.push(finished);
          setCharts((current) => current.map((item) => item.id === planned.id ? finished : item));
        } catch (reason) {
          if (chartId) {
            setCharts((current) => current.map((item) => item.id === chartId ? { ...item, status: "failed", insight_busy: false, error: reason instanceof Error ? reason.message : "Không thể hoàn tất phân tích tự động." } : item));
          }
        }
      }

      setAutoQuestionProgress({ percent: 100, step: `Đã hoàn tất tự động tạo ${completed.length}/${total} biểu đồ thành công!` });
      if (!completed.length) throw new Error("Không có câu hỏi nào được hoàn tất thành công.");
      return completed;
    },
    onSuccess: (completed) => {
      setBusinessQuestion("");
      setAutoStage("");
      setTimeout(() => setAutoQuestionProgress(null), 3000);
      setMessage(`Agent đã tự động tạo thành công ${completed.length} biểu đồ kèm số liệu và AI insight.`);
    },
    onError: () => {
      setAutoStage("");
      setTimeout(() => setAutoQuestionProgress(null), 3000);
    },
  });

  const validCharts = useMemo(() => charts.filter((chart) => !analysisError(chart)), [charts]);
  const preview = useMutation({
    mutationFn: async () => {
      if (!understanding) throw new Error("Hãy để Agent hiểu dữ liệu trước.");
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
    onSuccess: ({ results, ids }) => { setCharts((current) => current.map((chart) => { const result = results[ids.indexOf(chart.id)]; if (!result) return chart; return result.status === "fulfilled" ? { ...chart, execution: result.value, status: "official", error: undefined } : { ...chart, status: "failed", error: result.reason instanceof Error ? result.reason.message : "Official thất bại." }; })); setMessage("Official evidence đã sẵn sàng. Tiếp tục chọn chart type và renderer."); },
  });

  async function writeInsightForChart(chart: ChartDraft): Promise<Partial<ChartDraft>> {
    if (!chart.execution || chart.execution.execution_kind !== "official" || !chart.chart_type || !chart.renderer) {
      throw new Error("Biểu đồ chưa có Official evidence hợp lệ.");
    }
    let insight = ""; let agentRunId: string | null = null; let evidenceStatus = "unverified";
    await streamQuestion({
      question: `Hãy viết insight chuyên sâu cho biểu đồ "${chartDisplayTitle(chart)}". Bài toán: ${chart.problem}. Thuật toán: ${chart.algorithm}. Chart: ${chart.chart_type}. Phân tích toàn bộ các dòng trong Official evidence, nêu kết luận điều hành, bằng chứng định lượng, diễn giải ý nghĩa kinh doanh, điểm cần chú ý, khuyến nghị hành động và phạm vi/độ tin cậy. Trình bày bằng Markdown, không bịa số hoặc suy đoán ngoài Official execution.`,
      profile_run_id: runId,
      analysis_execution_id: chart.execution.id,
      workspace_context_version_id: chart.execution.context_version_id,
      response_mode: "chart_insight",
    }, (event) => {
      if (event.event === "token" && event.data && typeof event.data === "object") insight += String((event.data as { text?: unknown }).text || "");
      if (event.event === "done" && event.data && typeof event.data === "object") { const done = event.data as { agent_run_id?: unknown; evidence_status?: unknown }; agentRunId = String(done.agent_run_id || "") || null; evidenceStatus = String(done.evidence_status || evidenceStatus); }
      if (event.event === "error") throw new Error(String((event.data as { detail?: unknown })?.detail || "Agent không thể viết insight."));
    });
    return { generated: true, insight: normalizeMarkdownText(insight || "Agent không trả về insight."), insight_agent_run_id: agentRunId, insight_evidence_status: evidenceStatus, insight_reviewed: false };
  }

  async function generateAndWriteInsight(chart: ChartDraft) {
    if (!chart.execution || chart.execution.execution_kind !== "official" || !chart.chart_type || !chart.renderer) return;
    setCharts((current) => current.map((item) => item.id === chart.id ? { ...item, generated: true, insight_busy: true, insight: undefined, insight_reviewed: false, pinned: false, pin_idempotency_key: crypto.randomUUID(), error: undefined } : item));
    try {
      const written = await writeInsightForChart(chart);
      setCharts((current) => current.map((item) => item.id === chart.id ? { ...item, ...written, insight_busy: false } : item));
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
            { text: chart.insight!, reviewed: true, agentRunId: chart.insight_agent_run_id || "" },
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
      setMessage(errors.length ? `Đã ghim ${ids.length} biểu đồ; ${errors.length} biểu đồ lỗi.` : `Đã ghim thành công toàn bộ ${ids.length} biểu đồ kèm insight vào Report Draft.`);
      queryClient.invalidateQueries({ queryKey: ["command-center", runId, "report-draft"] });
      queryClient.invalidateQueries({ queryKey: ["report-draft", runId] });
    },
  });

  async function pinSingleChart(chart: ChartDraft) {
    if (!generatedReady(chart) || chart.pin_busy) return;
    const pinIdempotencyKey = chart.pin_idempotency_key || crypto.randomUUID();
    const title = chartDisplayTitle(chart);
    const previousInsightReviewed = chart.insight_reviewed;

    // Mark the chart as pinned before awaiting either network request so the
    // action feels immediate. The request key lets stale responses avoid
    // overwriting a chart that the user edited while it was being saved.
    setCharts((current) => current.map((item) => item.id === chart.id ? {
      ...item,
      pinned: true,
      pin_busy: true,
      insight_reviewed: true,
      pin_idempotency_key: pinIdempotencyKey,
      error: undefined,
    } : item));
    setMessage(`Đang ghim "${title}" vào Báo cáo…`);

    try {
      const draft = await getProfileReportDraft(runId);
      await pinChartToReport(
        draft.id,
        chart.execution!.id,
        title,
        chartSpec(chart),
        { text: chart.insight!, reviewed: true, agentRunId: chart.insight_agent_run_id || "" },
        pinIdempotencyKey,
      );
      setCharts((current) => current.map((item) => item.id === chart.id && item.pin_idempotency_key === pinIdempotencyKey ? {
        ...item,
        pinned: true,
        pin_busy: false,
        insight_reviewed: true,
      } : item));
      setMessage(`Đã ghim "${title}" vào Báo cáo.`);
      queryClient.invalidateQueries({ queryKey: ["command-center", runId, "report-draft"] });
      queryClient.invalidateQueries({ queryKey: ["report-draft", runId] });
    } catch (reason) {
      setCharts((current) => current.map((item) => item.id === chart.id && item.pin_idempotency_key === pinIdempotencyKey ? {
        ...item,
        pinned: false,
        pin_busy: false,
        insight_reviewed: previousInsightReviewed,
      } : item));
      setMessage(reason instanceof Error ? `Không thể ghim biểu đồ: ${reason.message}` : "Không thể ghim biểu đồ.");
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
        ...(changesQuery ? { planned_query: undefined, planning_mode: undefined, planner_agent_run_id: undefined, rationale: undefined } : {}),
        ...(next.insight === undefined ? { insight_agent_run_id: undefined, insight_evidence_status: undefined } : {}),
      } : {}),
    } : chart));
  }
  if (explorer.isError) return <ErrorNotice error={explorer.error} retry={() => explorer.refetch()} />;
  if (!explorer.isPending && !context) return <EmptyState title="Biểu đồ chưa có context" detail="Hãy hoàn tất Profile và review metadata trước khi tạo biểu đồ." />;
  const contextIsPreparing = explorer.isPending;
  const busy = autoProfile.isPending || automate.isPending || understand.isPending || preview.isPending || promote.isPending || pin.isPending;
  const forecastGroups = Object.entries((forecastCatalog.data?.algorithms ?? []).reduce<Record<string, ForecastAlgorithmCapability[]>>((groups, item) => {
    (groups[item.family] ||= []).push(item);
    return groups;
  }, {}));

  return <section className="command-charts">
    {contextIsPreparing && <Notice tone="info">Đang chuẩn bị metadata biểu đồ trong nền. Bạn có thể đọc và nhập câu hỏi trước; các nút tạo biểu đồ sẽ sẵn sàng ngay khi context hoàn tất.</Notice>}
    {/* Unified Hero Panel: Question Input + 1-Click Auto Analysis Pack */}
    <section className="panel chart-auto-profile-pack">
      <div className="panel-title" style={{ marginBottom: 10 }}>
        <div>
          <span className="eyebrow" style={{ color: "#315efb", fontWeight: 800 }}>VDaAgent · PHÂN TÍCH CHUYÊN SÂU THÔNG QUA BIỂU ĐỒ</span>
          <h3 style={{ margin: "4px 0 0", fontSize: "1.1rem", color: "#0c1a3a" }}>Bạn muốn phân tích câu hỏi gì từ dữ liệu?</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>
            Nhập câu hỏi bằng ngôn ngữ tự nhiên hoặc nhấn nút phân tích trọn gói. Agent sẽ tự động tính toán qua DuckDB, vẽ biểu đồ và viết AI insight.
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
              {automate.isPending ? `Agent đang xử lý (${autoQuestionProgress?.percent ?? 0}%)` : "✨ Agent tự động tạo biểu đồ"}
            </button>

            <button
              type="button"
              className="button secondary chart-action-button"
              onClick={() => autoProfile.mutate()}
              disabled={contextIsPreparing || busy}
              style={{ fontWeight: 700, border: "1px solid #b2cbfd", background: "#f0f5ff" }}
            >
              {autoProfile.isPending ? `Đang tạo Analysis Pack (${autoProfileProgress?.percent ?? 0}%)` : "⚡ Hoặc Tự động tạo trọn gói 5–8 biểu đồ"}
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
            <span>Quy trình: Ý định → QuerySpec → DuckDB Preview → Official Evidence → AI Insight</span>
            <span className="chart-progress-time-hint">Bảo đảm độ chính xác 100% theo Official evidence</span>
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
            <span>{autoProfileProgress.total > 0 ? `Tiến độ: Biểu đồ ${autoProfileProgress.current}/${autoProfileProgress.total}` : "Đang đọc Profile Context..."}</span>
            <span className="chart-progress-time-hint">Mỗi biểu đồ được tính toán qua DuckDB & Agent viết AI insight</span>
          </div>
        </div>
      )}

      {autoStage && !autoProfileProgress && !autoQuestionProgress && <div className="chart-auto-stage"><span className="loading-dot" />{autoStage}</div>}

      {/* Visual Workflow Steps */}
      <ol className="chart-workflow-map auto-profile-workflow-map" style={{ marginTop: 14 }}>
        <li className="done">Dataset</li>
        <li className="done">Profile Run</li>
        <li className={understanding ? "done" : "active"}>Profile Context</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 10 ? "active" : ""}>Analysis Pack</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 25 ? "active" : ""}>Bounded Preview</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 50 ? "active" : ""}>Official results</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 70 ? "active" : ""}>ChartSpec + renderer</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 85 ? "active" : ""}>Multiple charts</li>
        <li className={autoProfileProgress && autoProfileProgress.percent >= 95 ? "active" : ""}>Evidence insight</li>
        <li className={autoProfileProgress && autoProfileProgress.percent === 100 ? "done" : ""}>Review & Report</li>
      </ol>


    </section>

    {/* Header & Workspace */}
    <header className="command-charts-header">
      <div>
        <p className="eyebrow">CÂU HỎI → BIỂU ĐỒ → INSIGHT</p>
        <h2>Workspace Biểu đồ</h2>
      </div>
      <div className="chart-workspace-count">
        <strong>{charts.filter((chart) => chart.question).length}/{MAX_CHARTS}</strong>
        <span>bài phân tích</span>
      </div>
    </header>
    {message && <Notice tone="info">{message}</Notice>}
    {[autoProfile, automate, understand, preview, promote, pin].map((mutation, index) => mutation.isError ? <ErrorNotice key={index} error={mutation.error} retry={() => mutation.reset()} /> : null)}
    <details className="panel chart-model-catalog"><summary>Danh sách thuật toán được sử dụng · {forecastCatalog.data?.algorithms.filter((item) => item.available).length ?? 0}/{forecastCatalog.data?.algorithms.length ?? FORECAST_IDS.length} khả dụng</summary><p className="muted">Agent chỉ chọn model khả dụng và phù hợp với time column, độ dài lịch sử, mùa vụ và horizon. Model thiếu dependency hoặc cần biến ngoại sinh tương lai sẽ bị chặn.</p><div className="chart-model-groups">{forecastGroups.map(([family, items]) => <section key={family}><h4>{FORECAST_FAMILY_LABELS[family] || family}</h4><div>{(items ?? []).map((item) => <span className={`chart-model-chip ${item.available ? "available" : "unavailable"}`} title={item.unavailable_reason || `Tối thiểu ${item.min_history} kỳ`} key={item.id}>{item.label}<small>{item.available ? `≥ ${item.min_history} kỳ` : "Chưa khả dụng"}</small></span>)}</div></section>)}</div></details>

    <div className="chart-builder-list">{charts.filter((chart) => chart.question).map((chart) => <ChartWorkflowCard key={chart.id} chart={chart} dimensions={dimensions} measures={measures} forecastAlgorithms={forecastCatalog.data?.algorithms ?? []} enabled={!contextIsPreparing} onChange={(next) => updateChart(chart.id, next)} onRemove={() => setCharts((current) => current.length === 1 ? [draftChart()] : current.filter((item) => item.id !== chart.id))} onGenerate={() => void generateAndWriteInsight(chart)} onExplain={onExplain} onPin={() => void pinSingleChart(chart)} />)}</div>
    {charts.filter((chart) => chart.question).length > 0 && (
      <aside className="report-toc-sidebar">
        <div className="report-toc-container">
          <h3 className="report-toc-title">Danh mục biểu đồ</h3>
          <ul className="report-toc-list">
            {charts.filter((chart) => chart.question).map(chart => (
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
