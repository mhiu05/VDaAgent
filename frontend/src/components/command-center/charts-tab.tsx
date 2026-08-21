"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  autoPlanChart,
  ensureExplorerSession,
  getProfileReportDraft,
  listForecastAlgorithms,
  pinChartToReport,
  previewExplorer,
  promoteExplorerPreview,
  streamQuestion,
} from "@/lib/api";
import type { AnalysisExecution, AutoChartPlan, ChartRenderer, ChartSpec, ChartType, ForecastAlgorithm, ForecastAlgorithmCapability, QuerySpec } from "@/lib/analysis-types";
import type { Profile } from "@/lib/types";
import { EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { ChartEvidenceView } from "./chart-evidence-view";

type ProblemType = "compare" | "trend" | "ranking" | "summary" | "distribution" | "relationship" | "quality" | "forecast";
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
];
const FORECAST_LABELS: Record<ForecastAlgorithm, string> = {
  naive: "Naive Forecast", seasonal_naive: "Seasonal Naive", drift: "Drift Method", moving_average: "Moving Average", weighted_moving_average: "Weighted Moving Average",
  ses: "Simple Exponential Smoothing (SES)", holt_linear: "Holt’s Linear Trend", holt_winters: "Holt-Winters", ets: "ETS",
  arima: "ARIMA", sarima: "SARIMA", sarimax: "SARIMAX", auto_arima: "Auto-ARIMA", arimax: "ARIMAX",
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
};
const PROBLEM_CHARTS: Record<ProblemType, ChartType[]> = {
  compare: ["bar", "table"], trend: ["line", "table"], ranking: ["bar", "table"], summary: ["kpi", "table"],
  distribution: ["histogram", "box", "violin", "outlier"], relationship: ["scatter", "heatmap", "correlation_heatmap"],
  quality: ["missing_bar", "missing_heatmap", "cardinality", "outlier"],
  forecast: ["line", "table"],
};
const CHART_LABELS: Record<ChartType, string> = { line: "Line · xu hướng", bar: "Bar · so sánh", table: "Table · chi tiết", kpi: "KPI · tổng hợp", histogram: "Histogram · phân phối", scatter: "Scatter · mật độ", box: "Box plot · năm số", heatmap: "Heatmap · hai chiều", missing_bar: "Missing Value Bar", missing_heatmap: "Missing Value Heatmap", correlation_heatmap: "Correlation Heatmap", cardinality: "Cardinality Chart", violin: "Violin Plot", donut: "Pie / Donut", outlier: "Outlier Chart" };
const RENDERER_FOR_CHART: Record<ChartType, ChartRenderer> = { line: "native-svg", bar: "native-css", table: "native-html", kpi: "native-kpi", histogram: "native-svg", scatter: "native-svg", box: "native-svg", heatmap: "native-grid", missing_bar: "native-css", missing_heatmap: "native-grid", correlation_heatmap: "native-grid", cardinality: "native-css", violin: "native-svg", donut: "native-svg", outlier: "native-css" };
const RENDERER_LABELS: Record<ChartRenderer, string> = { "native-svg": "Native SVG", "native-css": "CSS Bars", "native-html": "HTML Table", "native-kpi": "Native KPI", "native-grid": "Native Grid" };

function draftChart(): ChartDraft {
  return {
    id: `chart-${crypto.randomUUID()}`, question: "", problem: "", algorithm: "", x_column: "", y_column: "", second_dimension: "",
    time_grain: "", date_from: "", date_to: "", forecast_horizon: 12, season_length: 12, chart_type: "", renderer: "", title: "", status: "draft", generated: false,
    insight_reviewed: false, pin_idempotency_key: crypto.randomUUID(),
  };
}

function chartFromPlan(plan: AutoChartPlan): ChartDraft {
  return {
    ...draftChart(),
    question: plan.question,
    title: plan.title,
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
    dimensions: [chart.x_column],
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
  if (chart.algorithm === "heatmap") return { analysis_kind: "heatmap", aggregate: "count", dimensions: [chart.x_column, chart.second_dimension], filters: [], limit: 50, sort: "desc" };
  if (["missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "outlier"].includes(chart.algorithm)) return { analysis_kind: chart.algorithm as QuerySpec["analysis_kind"], aggregate: "count", columns: [], dimensions: [], filters: [], bins: 12, limit: 50, sort: "desc" };
  if (chart.algorithm === "violin") return { analysis_kind: "violin", aggregate: "count", column: chart.y_column, dimensions: chart.x_column ? [chart.x_column] : [], filters: [], bins: 16, limit: 8, sort: "desc" };
  if (chart.algorithm === "donut") return { analysis_kind: "donut", aggregate: chart.y_column ? "sum" : "count", column: chart.y_column || undefined, dimensions: [chart.x_column], filters: [], bins: 12, limit: 12, sort: "desc" };
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
  const query = chartQuery(chart);
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
        ? query.dimensions[0] ?? query.column
        : query.dimensions[0];
  const yColumn = analysisKind === "scatter"
    ? query.y_column
    : ["missing_heatmap", "correlation_heatmap"].includes(analysisKind)
      ? "y"
    : analysisKind === "heatmap"
      ? query.dimensions[1]
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
    && chart.insight_agent_run_id
    && chart.insight_evidence_status === "verified"
    && chart.insight_reviewed
    && !chart.pinned
  );
}

function ChartWorkflowCard({ chart, dimensions, measures, forecastAlgorithms, enabled, onChange, onRemove, onGenerate, onExplain }: {
  chart: ChartDraft;
  dimensions: string[];
  measures: string[];
  forecastAlgorithms: ForecastAlgorithmCapability[];
  enabled: boolean;
  onChange: (next: Partial<ChartDraft>) => void;
  onRemove: () => void;
  onGenerate: () => void;
  onExplain: (execution: AnalysisExecution) => void;
}) {
  const validation = analysisError(chart);
  const algorithms = chart.problem ? PROBLEM_ALGORITHMS[chart.problem] : [];
  const chartTypes = chart.algorithm && ["histogram", "box", "scatter", "heatmap"].includes(chart.algorithm)
    ? [chart.algorithm as ChartType]
    : chart.problem ? PROBLEM_CHARTS[chart.problem] : [];
  const official = chart.execution?.execution_kind === "official";
  return <article className="panel chart-builder-card chart-workflow-card">
    <header className="chart-card-header"><div><span className="eyebrow">ANALYSIS {chart.id.slice(-4)}</span><h3>{chart.title || chart.question || "Bài phân tích mới"}</h3></div><div className="inline-actions"><span className={`chip ${chart.status === "official" ? "success" : chart.status === "preview" ? "warning" : chart.status === "failed" ? "danger" : ""}`}>{chart.pinned ? "Đã ghim" : chart.status === "official" ? "Official" : chart.status === "preview" ? "Preview" : chart.status === "failed" ? "Lỗi" : "Nháp"}</span><button type="button" className="button danger chart-remove" onClick={onRemove}>Xóa</button></div></header>
    <fieldset className="chart-workflow-fieldset" disabled={!enabled}>
    {chart.problem && chart.algorithm && chart.chart_type && chart.renderer && <div className="chart-auto-decision"><div className="chart-auto-decision-chips"><span className="chip">{PROBLEMS.find((item) => item.value === chart.problem)?.label}</span><span className="chip">{ALGORITHM_LABELS[chart.algorithm]}</span><span className="chip">{CHART_LABELS[chart.chart_type]}</span><span className="chip">{RENDERER_LABELS[chart.renderer]}</span>{chart.planning_mode && <span className={`chip ${chart.planning_mode === "agent" ? "success" : "warning"}`}>{chart.planning_mode === "agent" ? "Agent đã lập kế hoạch" : "Kế hoạch dự phòng"}</span>}</div>{chart.rationale && <p>{chart.rationale}</p>}</div>}
    <details className="chart-advanced" open={!chart.problem}>
    <summary>Tùy chỉnh nâng cao · xem hoặc thay đổi quyết định kỹ thuật</summary>
    <div className="chart-flow-section"><span className="chart-flow-number">3</span><div><b>Chọn bài toán</b><p>Nhập câu hỏi và xác nhận loại bài toán cần giải quyết.</p></div></div>
    <div className="chart-config-fields chart-step-fields">
      <label>Câu hỏi kinh doanh<input value={chart.question} placeholder="Ví dụ: Doanh số thay đổi thế nào trong 12 tháng?" onChange={(event) => onChange({ question: event.target.value, title: event.target.value, status: "draft", execution: undefined, generated: false, insight: undefined })} /></label>
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
    <div className="chart-flow-section"><span className="chart-flow-number">8–9</span><div><b>Sinh biểu đồ và Agent viết insight</b><p>Chart được render từ aggregate result; Agent chỉ diễn giải Official evidence.</p></div><button type="button" className="button primary" disabled={!official || !chart.chart_type || !chart.renderer || chart.insight_busy} onClick={onGenerate}>{chart.insight_busy ? "Agent đang viết insight…" : "Sinh biểu đồ & viết insight"}</button></div>
    {chart.generated && chart.execution && chart.chart_type && chart.renderer && <div className="chart-generated-grid"><div className="chart-result-canvas"><div className="chart-result-heading"><strong>{chart.title || "Kết quả biểu đồ"}</strong><small>{RENDERER_LABELS[chart.renderer]}</small></div><ChartEvidenceView chartSpec={chartSpec(chart)} result={chart.execution.result} querySpec={chart.execution.query_spec} title={chart.title} /><div className="chart-result-meta">Hash {chart.execution.result_hash.slice(0, 12)} · {chart.execution.duration_ms ?? "-"}ms <button type="button" className="button link-button" onClick={() => onExplain(chart.execution!)}>Phân tích chuyên sâu</button></div></div><section className="chart-insight-panel"><span className="eyebrow">AGENT INSIGHT · CẦN DUYỆT</span>{chart.insight ? <><MarkdownContent text={chart.insight} className="report report-markdown" /><label className="chart-insight-editor">Chỉnh sửa insight trước khi ghim<textarea value={chart.insight} maxLength={20000} rows={7} onChange={(event) => onChange({ insight: event.target.value, insight_reviewed: false })} /></label><label className="chart-insight-review"><input type="checkbox" checked={chart.insight_reviewed} onChange={(event) => onChange({ insight_reviewed: event.target.checked })} /> Tôi đã đối chiếu insight với biểu đồ và Official evidence.</label></> : <p className="muted">Agent chưa tạo được insight.</p>}{chart.insight_evidence_status && <small className="muted">Evidence: {chart.insight_evidence_status}</small>}</section></div>}
    </fieldset>
  </article>;
}

export function ChartsTab({ runId, profile, onExplain }: Props) {
  const explorer = useQuery({ queryKey: ["command-center", runId, "explorer-session"], queryFn: () => ensureExplorerSession(runId) });
  const forecastCatalog = useQuery({ queryKey: ["command-center", runId, "forecast-algorithms"], queryFn: () => listForecastAlgorithms(runId) });
  const [understanding, setUnderstanding] = useState("");
  const [understandingRunId, setUnderstandingRunId] = useState<string | null>(null);
  const [charts, setCharts] = useState<ChartDraft[]>([draftChart()]);
  const [message, setMessage] = useState("");
  const [businessQuestion, setBusinessQuestion] = useState("");
  const [autoStage, setAutoStage] = useState("");
  const context = explorer.data?.context;
  const dimensions = context?.context.dimensions ?? [];
  const measures = context?.context.measures ?? [];

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

  const automate = useMutation({
    mutationFn: async () => {
      const question = businessQuestion.trim();
      if (question.length < 3) throw new Error("Hãy nhập một câu hỏi kinh doanh cụ thể.");
      let chartId: string | null = null;
      try {
        setAutoStage("Agent đang hiểu dữ liệu và chọn kế hoạch phân tích…");
        const plan = await autoPlanChart(runId, question);
        const planned = chartFromPlan(plan);
        chartId = planned.id;
        setUnderstanding(`**Agent đã hiểu yêu cầu:** ${plan.rationale}\n\nKế hoạch: ${PROBLEMS.find((item) => item.value === plan.problem)?.label} → ${ALGORITHM_LABELS[plan.algorithm]} → ${CHART_LABELS[plan.chart_type]} → ${RENDERER_LABELS[plan.renderer]}.`);
        setUnderstandingRunId(plan.agent_run_id ?? null);
        setCharts((current) => current.length === 1 && !current[0].question ? [planned] : [planned, ...current]);

        setAutoStage("Đang chạy Preview bằng bounded analysis engine…");
        const previewResult = await previewExplorer(runId, plan.query);
        setCharts((current) => current.map((item) => item.id === planned.id ? { ...item, execution: previewResult, status: "preview" } : item));

        setAutoStage("Đang kiểm tra quality gate và tạo Official evidence…");
        const officialResult = await promoteExplorerPreview(
          runId,
          previewResult.id,
          previewResult.context_version_id ?? plan.context_version_id ?? context?.id ?? "",
        );
        const officialChart: ChartDraft = { ...planned, execution: officialResult, status: "official", generated: true, insight_busy: true };
        setCharts((current) => current.map((item) => item.id === planned.id ? officialChart : item));

        setAutoStage("Agent đang đọc Official evidence và viết insight…");
        const written = await writeInsightForChart(officialChart);
        return { chart: { ...officialChart, ...written, insight_busy: false }, planningMode: plan.planning_mode };
      } catch (reason) {
        if (chartId) setCharts((current) => current.map((item) => item.id === chartId ? { ...item, status: "failed", insight_busy: false, error: reason instanceof Error ? reason.message : "Không thể hoàn tất phân tích tự động." } : item));
        throw reason;
      }
    },
    onSuccess: ({ chart, planningMode }) => {
      setCharts((current) => current.map((item) => item.id === chart.id ? chart : item));
      setBusinessQuestion("");
      setAutoStage("");
      setMessage(planningMode === "agent" ? "Agent đã tự động tạo biểu đồ và insight từ câu hỏi kinh doanh." : "Đã tạo biểu đồ bằng kế hoạch dự phòng an toàn; LLM planner chưa khả dụng.");
    },
    onError: () => setAutoStage(""),
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
      question: `Hãy viết insight ngắn cho biểu đồ "${chart.title || chart.question}". Bài toán: ${chart.problem}. Thuật toán: ${chart.algorithm}. Chart: ${chart.chart_type}. Nêu xu hướng chính, con số đáng chú ý, giới hạn và khuyến nghị. Chỉ dùng Official execution đã bind.`,
      profile_run_id: runId,
      analysis_execution_id: chart.execution.id,
      workspace_context_version_id: chart.execution.context_version_id,
    }, (event) => {
      if (event.event === "token" && event.data && typeof event.data === "object") insight += String((event.data as { text?: unknown }).text || "");
      if (event.event === "done" && event.data && typeof event.data === "object") { const done = event.data as { agent_run_id?: unknown; evidence_status?: unknown }; agentRunId = String(done.agent_run_id || "") || null; evidenceStatus = String(done.evidence_status || evidenceStatus); }
      if (event.event === "error") throw new Error(String((event.data as { detail?: unknown })?.detail || "Agent không thể viết insight."));
    });
    return { generated: true, insight: insight || "Agent không trả về insight.", insight_agent_run_id: agentRunId, insight_evidence_status: evidenceStatus, insight_reviewed: false };
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
      const results = await Promise.allSettled(ready.map((chart) => pinChartToReport(
        draft.id,
        chart.execution!.id,
        chart.title || chart.question,
        chartSpec(chart),
        { text: chart.insight!, reviewed: chart.insight_reviewed, agentRunId: chart.insight_agent_run_id! },
        chart.pin_idempotency_key,
      )));
      const ids = ready.filter((_, index) => results[index].status === "fulfilled").map((chart) => chart.id);
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "Không thể ghim chart.");
      if (!ids.length) throw new Error(errors[0] || "Không thể ghim chart.");
      return { ids, errors };
    },
    onSuccess: ({ ids, errors }) => { setCharts((current) => current.map((chart) => ids.includes(chart.id) ? { ...chart, pinned: true } : chart)); setMessage(errors.length ? `Đã ghim ${ids.length} chart; ${errors.length} chart lỗi và có thể thử lại.` : `Đã ghim ${ids.length} chart kèm insight đã duyệt vào Report Draft.`); },
  });

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
  if (explorer.isLoading) return <LoadingBlock label="Đang tạo context cho Biểu đồ…" />;
  if (explorer.isError) return <ErrorNotice error={explorer.error} retry={() => explorer.refetch()} />;
  if (!context) return <EmptyState title="Biểu đồ chưa có context" detail="Hãy hoàn tất Profile và review metadata trước khi tạo biểu đồ." />;
  const busy = automate.isPending || understand.isPending || preview.isPending || promote.isPending || pin.isPending;
  const forecastGroups = Object.entries((forecastCatalog.data?.algorithms ?? []).reduce<Record<string, ForecastAlgorithmCapability[]>>((groups, item) => {
    (groups[item.family] ||= []).push(item);
    return groups;
  }, {}));

  return <section className="command-charts">
    <header className="command-charts-header"><div><p className="eyebrow">CÂU HỎI KINH DOANH → BIỂU ĐỒ → INSIGHT</p><h2>Biểu đồ</h2><p className="muted">Bạn chỉ cần đặt câu hỏi. Agent tự chọn bài toán, thuật toán, biểu đồ và tool vẽ; phép tính vẫn chạy qua bounded Preview/Official.</p></div><div className="chart-workspace-count"><strong>{charts.filter((chart) => chart.question).length}/{MAX_CHARTS}</strong><span>bài phân tích</span></div></header>
    <ol className="chart-workflow-map"><li className="done">Profiles</li><li className={understanding ? "done" : "active"}>Agent hiểu dữ liệu</li><li>Agent chọn bài toán</li><li>Agent chọn thuật toán</li><li>Phân tích</li><li>Chọn chart</li><li>Chọn tool</li><li>Sinh chart</li><li>Viết insight</li><li>Report</li></ol>
    {message && <Notice tone="info">{message}</Notice>}
    {[automate, understand, preview, promote, pin].map((mutation, index) => mutation.isError ? <ErrorNotice key={index} error={mutation.error} retry={() => mutation.reset()} /> : null)}
    <section className="panel chart-auto-entry"><div><span className="eyebrow">AGENT TỰ ĐỘNG PHÂN TÍCH</span><h3>Bạn muốn biết điều gì từ dữ liệu?</h3><p className="muted">Viết bằng ngôn ngữ kinh doanh, ví dụ “Doanh số thay đổi thế nào trong 12 tháng?”. Không cần chọn thuật toán.</p></div><label className="chart-business-question"><span>Câu hỏi kinh doanh</span><textarea rows={3} maxLength={2000} value={businessQuestion} onChange={(event) => setBusinessQuestion(event.target.value)} placeholder="Nhập câu hỏi về xu hướng, so sánh, xếp hạng, phân phối hoặc mối quan hệ…" disabled={busy} /></label><button type="button" className="button primary chart-auto-submit" onClick={() => automate.mutate()} disabled={busy || businessQuestion.trim().length < 3 || charts.filter((chart) => chart.question).length >= MAX_CHARTS}>{automate.isPending ? "Agent đang xử lý…" : "Agent tự động tạo biểu đồ"}</button>{autoStage && <div className="chart-auto-stage"><span className="loading-dot" />{autoStage}</div>}<div className="chart-agent-facts"><span><b>{profile.column_count}</b> cột</span><span><b>{dimensions.length}</b> dimensions</span><span><b>{measures.length}</b> measures</span><span><b>{profile.pending_proposals}</b> proposal chờ review</span></div>{understanding && <details className="chart-agent-understanding"><summary>Xem cách Agent hiểu yêu cầu và kế hoạch đã chọn</summary><MarkdownContent text={understanding} className="report report-markdown" /><small>Agent run: {understandingRunId || "không có"}</small></details>}</section>
    <details className="panel chart-model-catalog"><summary>Danh mục thuật toán dự báo · {forecastCatalog.data?.algorithms.filter((item) => item.available).length ?? 0}/{forecastCatalog.data?.algorithms.length ?? FORECAST_IDS.length} khả dụng</summary><p className="muted">Agent chỉ chọn model khả dụng và phù hợp với time column, độ dài lịch sử, mùa vụ và horizon. Model thiếu dependency hoặc cần biến ngoại sinh tương lai sẽ bị chặn.</p><div className="chart-model-groups">{forecastGroups.map(([family, items]) => <section key={family}><h4>{FORECAST_FAMILY_LABELS[family] || family}</h4><div>{(items ?? []).map((item) => <span className={`chart-model-chip ${item.available ? "available" : "unavailable"}`} title={item.unavailable_reason || `Tối thiểu ${item.min_history} kỳ`} key={item.id}>{item.label}<small>{item.available ? `≥ ${item.min_history} kỳ` : "Chưa khả dụng"}</small></span>)}</div></section>)}</div></details>
    <div className="chart-toolbar"><details className="chart-manual-tools"><summary>Tùy chỉnh nâng cao / chạy thủ công</summary><div className="inline-actions"><button type="button" className="button secondary" onClick={() => understand.mutate()} disabled={busy}>{understand.isPending ? "Agent đang đọc Profile…" : "Đọc riêng Profile"}</button><button type="button" className="button secondary" onClick={() => setCharts((current) => current.length >= MAX_CHARTS ? current : [...current, draftChart()])} disabled={charts.length >= MAX_CHARTS || busy}>+ Bài phân tích thủ công</button><button type="button" className="button secondary" onClick={() => preview.mutate()} disabled={busy || !validCharts.length}>{preview.isPending ? "Đang chạy Preview…" : "Chạy Preview"}</button><button type="button" className="button secondary" onClick={() => promote.mutate()} disabled={busy || !charts.some((chart) => chart.execution?.execution_kind === "preview")}>{promote.isPending ? "Đang tạo Official…" : "Tạo Official"}</button></div></details><div className="inline-actions"><button type="button" className="button primary" onClick={() => pin.mutate()} disabled={busy || !charts.some(generatedReady)}>{pin.isPending ? "Đang ghim…" : "Ghim chart + insight đã duyệt"}</button><Link className="button secondary" href={`/profiles/${runId}?tab=report`}>Report Draft / Xuất</Link></div></div>
    <div className="chart-builder-list">{charts.filter((chart) => chart.question).map((chart) => <ChartWorkflowCard key={chart.id} chart={chart} dimensions={dimensions} measures={measures} forecastAlgorithms={forecastCatalog.data?.algorithms ?? []} enabled onChange={(next) => updateChart(chart.id, next)} onRemove={() => setCharts((current) => current.length === 1 ? [draftChart()] : current.filter((item) => item.id !== chart.id))} onGenerate={() => void generateAndWriteInsight(chart)} onExplain={onExplain} />)}</div>
  </section>;
}
