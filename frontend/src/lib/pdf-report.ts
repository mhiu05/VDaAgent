import { existsSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";

import { formatNumber } from "@/lib/format";
import type { AnalysisExecution, AnalysisKind, ChartRenderer, ChartSpec, ChartType, QuerySpec } from "@/lib/analysis-types";
import { DRIFT_PART_TITLE, driftDetailText, driftDisplayValue, driftEvidenceLabel, driftSeverityLabel, driftSeverityLabels, driftSignalLabel, driftTypeLabel, flattenDriftFindings, groupDriftFindings } from "@/lib/drift-evidence";

type DataRecord = Record<string, unknown>;
type ReportSource = {
  profile?: { dataset?: { name?: unknown }; run?: DataRecord; column_stats?: DataRecord[]; drift_reports?: DataRecord[]; correlation_matrix?: Record<string, Record<string, unknown>> };
  report_snapshot?: { title?: unknown; items?: DataRecord[] } | null;
};
type Section = { title: string; body: string; children?: Section[]; number?: string; isPart?: boolean; wrapBodyAndChildren?: string; skipToc?: boolean };

const MAX_CONCURRENT_EXPORTS = 2;
let activeExports = 0;

export class PdfExportError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function text(value: unknown, fallback = "-"): string {
  const normalized = typeof value === "string" ? value.trim() : value;
  return normalized === null || normalized === undefined || normalized === "" ? fallback : String(normalized);
}
function date(value: unknown): string {
  if (!value) return "-";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? text(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeStyle: "short" }).format(parsed);
}
function number(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(parsed) : text(value);
}
function percentage(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 1 }).format(parsed > 1 ? parsed / 100 : parsed);
}
function table(headers: string[], rows: Array<Array<unknown>>, className = ""): string {
  if (!rows.length) return "";
  return `<div class="table-wrap ${className}"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${typeof value === 'object' && value !== null && '__html' in value ? String((value as any).__html) : escapeHtml(text(value))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function driftEvidenceHtml(reports: DataRecord[]): string {
  const findings = flattenDriftFindings(reports);
  const columns = groupDriftFindings(reports);
  const major = findings.filter((finding) => finding.severity === "major").length;
  const minor = findings.filter((finding) => finding.severity === "minor").length;
  const summary = `<div class="drift-summary-grid"><div><span>${escapeHtml(driftSeverityLabels.major)}</span><strong>${major}</strong><small>Signal major</small></div><div><span>${escapeHtml(driftSeverityLabels.minor)}</span><strong>${minor}</strong><small>Signal minor</small></div><div><span>Cột có evidence</span><strong>${columns.length}</strong><small>${escapeHtml(driftSignalLabel(findings.length))}</small></div></div>`;
  const overview = table(["Cột", "Severity", "Evidence", "Signal"], columns.map((column) => [column.name, driftSeverityLabels[column.severity], driftEvidenceLabel(column.findings[0]), driftSignalLabel(column.findings.length)]));
  const details = columns.map((column) => `<article class="drift-detail"><div class="drift-detail-heading"><div><p class="drift-eyebrow">EVIDENCE CỘT</p><h4>${escapeHtml(column.name)}</h4><p>${escapeHtml(driftSignalLabel(column.findings.length))} từ backend</p></div><span class="drift-severity">${escapeHtml(driftSeverityLabels[column.severity])}</span></div>${column.findings.map((finding) => `<div class="drift-finding"><strong>${escapeHtml(driftTypeLabel(finding.drift_type))}</strong><span class="drift-severity">${escapeHtml(driftSeverityLabel(finding.severity))}</span><p>${escapeHtml(driftDetailText(finding.detail))}</p><table class="drift-values"><tbody><tr><th>Evidence</th><td>${escapeHtml(driftEvidenceLabel(finding))}</td></tr>${finding.baseline_value !== undefined || finding.current_value !== undefined ? `<tr><th>Baseline</th><td>${escapeHtml(driftDisplayValue(finding.baseline_value))}</td></tr><tr><th>Current</th><td>${escapeHtml(driftDisplayValue(finding.current_value))}</td></tr>` : ""}</tbody></table></div>`).join("")}</article>`).join("");
  return `${summary}${overview}${details}`;
}
function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}
function markdown(value: unknown): string {
  const content: string[] = [];
  let list: Array<{ level: number; text: string }> = [];
  const flush = () => {
    if (!list.length) return;
    let html = "";
    let currentLevel = -1;
    for (const item of list) {
      if (item.level > currentLevel) {
        html += "<ul>".repeat(item.level - currentLevel);
      } else if (item.level < currentLevel) {
        html += "</ul>".repeat(currentLevel - item.level);
      }
      currentLevel = item.level;
      html += `<li>${item.text}</li>`;
    }
    html += "</ul>".repeat(currentLevel + 1);
    content.push(html);
    list = [];
  };
  for (const raw of text(value, "").split(/\r?\n/)) {
    const listMatch = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (listMatch) {
      const level = Math.floor(listMatch[1].length / 2);
      list.push({ level, text: inlineMarkdown(listMatch[2]) });
      continue;
    }
    const line = raw.trim();
    if (!line || line === "---") { flush(); continue; }
    if (/^#{1,6}\s+/.test(line)) { flush(); content.push(`<h4>${inlineMarkdown(line.replace(/^#{1,6}\s+/, ""))}</h4>`); }
    else { flush(); content.push(`<p>${inlineMarkdown(line)}</p>`); }
  }
  flush();
  return content.join("") || "<p>Không có nội dung diễn giải được lưu.</p>";
}
function barChart(title: string, rows: DataRecord[], metric: string = "null_pct", fill: string = "#2563eb"): string {
  const values = rows.slice(0, 10).map((row) => ({ label: text(row.column_name ?? row.label ?? row.name, "Khác"), value: Number(row[metric] ?? row.null_pct ?? row.value ?? row.count ?? 0) })).filter((item) => Number.isFinite(item.value));
  if (!values.length) return "";
  const max = Math.max(...values.map((item) => item.value), 1);
  const height = Math.max(80, values.length * 26 + 46);
  const bars = values.map((item, index) => { 
    const y = 28 + index * 26; 
    const width = (item.value / max) * 200; 
    const labelStr = escapeHtml(item.label);
    const shortLabel = labelStr.length > 22 ? labelStr.slice(0, 22) + "..." : labelStr;
    return `<text x="0" y="${y + 11}" class="chart-label">${shortLabel}</text><rect x="125" y="${y}" width="200" height="10" rx="3" fill="#f1f5f9"/>${width > 0 ? `<rect x="125" y="${y}" width="${width}" height="10" rx="3" fill="${fill}"/>` : ""}<text x="335" y="${y + 11}" class="chart-value" font-weight="bold">${escapeHtml(percentage(item.value))}</text>`; 
  }).join("");
  return `<figure class="chart" style="flex: 1; min-width: 300px; margin: 0; box-sizing: border-box; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4mm; background: #ffffff;"><figcaption style="margin-top: 0; margin-bottom: 2mm; font-size: 10.5pt; font-weight: 700; color: #0f172a;">${escapeHtml(title)}</figcaption><svg viewBox="0 0 430 ${height}" role="img" aria-label="${escapeHtml(title)}" style="display: block; width: 100%; max-width: 430px;">${bars}</svg></figure>`;
}
function distributionChart(stat: DataRecord, totalRows: number): string {
  const topK = stat.top_values ?? stat.top_k_values;
  let entries: {label: string, count: number}[] = [];
  if (Array.isArray(topK)) {
    entries = topK.map(v => typeof v === 'object' && v !== null ? { label: String(v.value), count: Number(v.count ?? v.frequency) } : { label: String(v), count: 0 });
  } else if (topK && typeof topK === 'object') {
    entries = Object.entries(topK).map(([k, v]) => ({ label: k, count: Number(v) }));
  }
  entries = entries.slice(0, 10).filter(e => Number.isFinite(e.count));
  if (!entries.length) return "";
  
  const max = Math.max(...entries.map(e => e.count), 1);
  const height = entries.length * 26 + 30;
  
  const bars = entries.map((item, index) => {
    const y = 16 + index * 26;
    const width = (item.count / max) * 200;
    const pctStr = totalRows > 0 ? ` <tspan fill="#64748b" font-weight="normal">(${percentage(item.count / totalRows)})</tspan>` : "";
    const labelStr = escapeHtml(item.label);
    const shortLabel = labelStr.length > 22 ? labelStr.slice(0, 22) + "..." : labelStr;
    return `<text x="0" y="${y + 9}" class="chart-label">${shortLabel}</text><rect x="125" y="${y}" width="200" height="10" rx="3" fill="#f1f5f9"/>${width > 0 ? `<rect x="125" y="${y}" width="${width}" height="10" rx="3" fill="#2563eb"/>` : ""}<text x="335" y="${y + 9}" class="chart-value"><tspan font-weight="bold">${number(item.count)}</tspan>${pctStr}</text>`;
  }).join("");
  
  return `<div style="flex: 1; min-width: 300px; margin-bottom: 6mm; box-sizing: border-box; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4mm; background: #ffffff;"><h4 style="margin: 0 0 2mm 0; color: #0f172a; font-size: 10.5pt; font-weight: 700;">${escapeHtml(String(stat.column_name))}</h4><svg viewBox="0 0 430 ${height}" role="img" style="display:block;width:100%;max-width:430px;">${bars}</svg></div>`;
}
const EXPORT_CHART_TYPES = new Set<ChartType>([
  "line", "bar", "table", "kpi", "histogram", "scatter", "box", "heatmap", "missing_bar", "missing_heatmap",
  "correlation_heatmap", "cardinality", "violin", "donut", "outlier", "map",
]);
const EXPORT_ANALYSIS_KINDS = new Set<AnalysisKind>([
  "aggregate", "histogram", "scatter", "box", "heatmap", "forecast", "forecast_ranking", "missing_bar", "missing_heatmap",
  "correlation_heatmap", "cardinality", "violin", "donut", "outlier",
]);
const EXPORT_RENDERERS = new Set<ChartRenderer>(["native-svg", "native-css", "native-html", "native-kpi", "native-grid"]);
const EXPORT_AGGREGATES = new Set<QuerySpec["aggregate"]>(["count", "count_distinct", "sum", "mean", "median"]);
const EXPORT_TIME_GRAINS = new Set<NonNullable<QuerySpec["time_grain"]>>(["day", "week", "month", "quarter", "year"]);

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}
function finiteNumber(value: unknown): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function isChartType(value: unknown): value is ChartType {
  return typeof value === "string" && EXPORT_CHART_TYPES.has(value as ChartType);
}
function isAnalysisKind(value: unknown): value is AnalysisKind {
  return typeof value === "string" && EXPORT_ANALYSIS_KINDS.has(value as AnalysisKind);
}
function isRenderer(value: unknown): value is ChartRenderer {
  return typeof value === "string" && EXPORT_RENDERERS.has(value as ChartRenderer);
}
function isAggregate(value: unknown): value is QuerySpec["aggregate"] {
  return typeof value === "string" && EXPORT_AGGREGATES.has(value as QuerySpec["aggregate"]);
}
function isTimeGrain(value: unknown): value is NonNullable<QuerySpec["time_grain"]> {
  return typeof value === "string" && EXPORT_TIME_GRAINS.has(value as NonNullable<QuerySpec["time_grain"]>);
}
function inferChartType(rawChartSpec: DataRecord | undefined, rawQuerySpec: DataRecord | undefined): ChartType {
  if (isChartType(rawChartSpec?.chart_type)) return rawChartSpec.chart_type;
  if (rawQuerySpec?.analysis_kind === "forecast") return "line";
  if (isChartType(rawQuerySpec?.analysis_kind)) return rawQuerySpec.analysis_kind;
  return "bar";
}
function rendererForChartType(chartType: ChartType): ChartRenderer {
  if (chartType === "table") return "native-html";
  if (chartType === "kpi") return "native-kpi";
  if (["line", "scatter", "donut"].includes(chartType)) return "native-svg";
  if (["heatmap", "missing_heatmap", "correlation_heatmap"].includes(chartType)) return "native-grid";
  return "native-css";
}
function exportResult(item: DataRecord): AnalysisExecution["result"] {
  const content = isRecord(item.content_json) ? item.content_json : undefined;
  const rawResult = isRecord(content?.result) ? content.result : undefined;
  const data = Array.isArray(rawResult?.data) ? rawResult.data.filter(isRecord) : [];
  const declaredColumns = stringList(rawResult?.columns);
  const columns = declaredColumns.length ? declaredColumns : (data[0] ? Object.keys(data[0]) : []);
  const declaredRowCount = finiteNumber(rawResult?.row_count);
  return { data, columns, row_count: declaredRowCount !== null ? Math.max(data.length, declaredRowCount) : data.length };
}
function exportChartSpec(item: DataRecord): ChartSpec {
  const content = isRecord(item.content_json) ? item.content_json : undefined;
  const rawChartSpec = isRecord(content?.chart_spec) ? content.chart_spec : isChartType(content?.chart_type) ? { chart_type: content.chart_type } : undefined;
  const rawQuerySpec = isRecord(item.query_spec) ? item.query_spec : undefined;
  const chartType = inferChartType(rawChartSpec, rawQuerySpec);
  const analysisKind = isAnalysisKind(rawChartSpec?.analysis_kind)
    ? rawChartSpec.analysis_kind
    : isAnalysisKind(rawQuerySpec?.analysis_kind)
      ? rawQuerySpec.analysis_kind
      : chartType === "line" && rawQuerySpec?.forecast_algorithm
        ? "forecast"
        : chartType === "histogram" || chartType === "scatter" || chartType === "box" || chartType === "heatmap"
          ? chartType
          : "aggregate";
  const aggregation = isAggregate(rawChartSpec?.aggregation)
    ? rawChartSpec.aggregation
    : isAggregate(rawQuerySpec?.aggregate)
      ? rawQuerySpec.aggregate
      : "count";
  return {
    chart_type: chartType,
    renderer: isRenderer(rawChartSpec?.renderer) ? rawChartSpec.renderer : rendererForChartType(chartType),
    analysis_kind: analysisKind,
    x_column: optionalString(rawChartSpec?.x_column ?? rawQuerySpec?.x_column),
    y_column: optionalString(rawChartSpec?.y_column ?? rawQuerySpec?.y_column),
    aggregation,
    time_grain: isTimeGrain(rawChartSpec?.time_grain) ? rawChartSpec.time_grain : null,
    bins: finiteNumber(rawChartSpec?.bins),
    forecast_algorithm: typeof rawChartSpec?.forecast_algorithm === "string" ? rawChartSpec.forecast_algorithm as ChartSpec["forecast_algorithm"] : null,
    forecast_horizon: finiteNumber(rawChartSpec?.forecast_horizon),
    season_length: finiteNumber(rawChartSpec?.season_length),
  };
}
function exportQuerySpec(item: DataRecord, chartSpec: ChartSpec, result: AnalysisExecution["result"]): QuerySpec {
  const raw = isRecord(item.query_spec) ? item.query_spec : undefined;
  const dimensions = stringList(raw?.dimensions);
  const valueColumns = new Set(["value", "count", "x", "y", "lower", "upper", "bin_index", "bin_start", "bin_end", "min", "q1", "median", "q3", "max"]);
  const presentColumns = result.columns.filter((column) => result.data.some((row) => row[column] !== undefined && row[column] !== null));
  const fallbackDimensions = presentColumns.filter((column) => !valueColumns.has(column)).slice(0, 2);
  const inferredLabel = result.data.some((row) => row.label !== undefined) ? ["label"] : result.data.some((row) => row.name !== undefined) ? ["name"] : [];
  const usesCategoryDimension = ["bar", "line", "missing_bar", "cardinality", "outlier", "donut"].includes(chartSpec.chart_type);
  const filters = Array.isArray(raw?.filters)
    ? raw.filters.filter(isRecord).map((filter) => ({
        column: typeof filter.column === "string" ? filter.column : "",
        operator: typeof filter.operator === "string" ? filter.operator : "",
        ...(Object.prototype.hasOwnProperty.call(filter, "value") ? { value: filter.value } : {}),
      })).filter((filter) => filter.column && filter.operator)
    : [];
  const queryAnalysisKind = isAnalysisKind(raw?.analysis_kind) ? raw.analysis_kind : chartSpec.analysis_kind;
  return {
    analysis_kind: queryAnalysisKind,
    aggregate: isAggregate(raw?.aggregate) ? raw.aggregate : chartSpec.aggregation,
    column: optionalString(raw?.column) ?? undefined,
    x_column: optionalString(raw?.x_column ?? chartSpec.x_column) ?? undefined,
    y_column: optionalString(raw?.y_column ?? chartSpec.y_column) ?? undefined,
    columns: stringList(raw?.columns),
    dimensions: dimensions.length ? dimensions : (usesCategoryDimension ? (fallbackDimensions.length ? fallbackDimensions : inferredLabel) : []),
    filters,
    time_grain: isTimeGrain(raw?.time_grain) ? raw.time_grain : (chartSpec.time_grain ?? undefined),
    bins: finiteNumber(raw?.bins) ?? undefined,
    forecast_algorithm: typeof raw?.forecast_algorithm === "string" ? raw.forecast_algorithm as QuerySpec["forecast_algorithm"] : undefined,
    forecast_horizon: finiteNumber(raw?.forecast_horizon) ?? undefined,
    season_length: finiteNumber(raw?.season_length) ?? undefined,
    confidence_level: finiteNumber(raw?.confidence_level) ?? undefined,
    history_limit: finiteNumber(raw?.history_limit) ?? undefined,
    limit: Math.max(1, Math.floor(finiteNumber(raw?.limit) ?? (result.data.length || 50))),
    sort: raw?.sort === "asc" || raw?.sort === "desc" ? raw.sort : undefined,
  };
}
const EXPORT_CATEGORY_COLORS = ["#6366f1", "#f43f5e", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#d946ef", "#0ea5e9", "#84cc16", "#a855f7", "#14b8a6", "#f97316"];
function exportChartColor(index: number): string {
  return EXPORT_CATEGORY_COLORS[index % EXPORT_CATEGORY_COLORS.length];
}
function exportChartNumber(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function exportChartLabel(row: DataRecord, querySpec: QuerySpec): string {
  if (row.column !== undefined) return text(row.column);
  const dimension = querySpec.dimensions[0];
  return dimension ? text(row[dimension]) : "Kết quả";
}
function exportStyle(entries: Array<[string, string | number | undefined]>): string {
  return entries.filter(([, value]) => value !== undefined).map(([property, value]) => `${property}:${value}`).join(";");
}
function renderChartEvidenceHtml(chartSpec: ChartSpec, result: AnalysisExecution["result"], querySpec: QuerySpec, title: string): string {
  const forecastMode = querySpec.analysis_kind === "forecast";
  const matrixMode = ["missing_heatmap", "correlation_heatmap"].includes(chartSpec.chart_type);
  const limit = chartSpec.chart_type === "table" ? 50 : forecastMode ? 72 : chartSpec.chart_type === "violin" ? 160 : matrixMode ? 144 : chartSpec.chart_type === "donut" ? 12 : 15;
  const rows = forecastMode ? result.data.slice(-limit) : result.data.slice(0, limit);
  const values = rows.map((row) => Number(row.value));
  const finiteValues = values.filter(Number.isFinite);
  if (!rows.length || !finiteValues.length) {
    return `<div class="chart-empty-canvas" role="status"><span>Không có dữ liệu để vẽ</span><small>Hãy kiểm tra bộ lọc, cột measure và khoảng thời gian.</small></div>`;
  }
  const max = Math.max(...finiteValues, 1);
  const min = Math.min(...finiteValues, 0);

  if (chartSpec.chart_type === "histogram") {
    return `<div class="chart-histogram" role="img" aria-label="${escapeHtml(title || "Histogram")}">${rows.map((row, index) => {
      const value = exportChartNumber(row.value) ?? 0;
      const start = exportChartNumber(row.bin_start);
      const end = exportChartNumber(row.bin_end);
      const label = start === null || end === null ? `Khoảng ${index + 1}` : `${formatNumber(start)}–${formatNumber(end)}`;
      const color = exportChartColor(index);
      return `<div class="histogram-column"><span class="histogram-value">${escapeHtml(formatNumber(value))}</span><span class="histogram-bar" style="${exportStyle([["height", `${Math.max(value / max * 100, 2)}%`], ["background", `linear-gradient(180deg, ${color}b3, ${color})`]])}"><span class="sr-only">${escapeHtml(label)}: ${escapeHtml(formatNumber(value))}</span></span><span class="histogram-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span></div>`;
    }).join("")}</div>`;
  }

  if (chartSpec.chart_type === "scatter") {
    const points = rows.map((row) => ({ x: exportChartNumber(row.x), y: exportChartNumber(row.y), count: exportChartNumber(row.value) ?? 1 })).filter((point): point is { x: number; y: number; count: number } => point.x !== null && point.y !== null);
    if (!points.length) return `<div class="chart-empty-canvas" role="status">Không có ô mật độ hợp lệ.</div>`;
    const width = 720; const height = 260; const padding = 24;
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y); const counts = points.map((point) => point.count);
    const xMin = Math.min(...xs); const xSpread = Math.max(Math.max(...xs) - xMin, 1); const yMin = Math.min(...ys); const ySpread = Math.max(Math.max(...ys) - yMin, 1); const countMax = Math.max(...counts, 1);
    const circles = points.map((point, index) => {
      const cx = padding + (point.x - xMin) / xSpread * (width - padding * 2);
      const cy = height - padding - (point.y - yMin) / ySpread * (height - padding * 2);
      const color = exportChartColor(index);
      return `<circle cx="${cx}" cy="${cy}" r="${4 + Math.sqrt(point.count / countMax) * 10}" style="fill:${color};stroke:${color}"><title>${escapeHtml(`${querySpec.x_column || "x"}: ${formatNumber(point.x)} · ${querySpec.y_column || "y"}: ${formatNumber(point.y)} · ${formatNumber(point.count)} dòng`)}</title></circle>`;
    }).join("");
    return `<div class="chart-scatter-wrap"><svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title || "Biểu đồ scatter mật độ")}" class="chart-scatter-svg"><line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" /><line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" />${circles}</svg><div class="chart-scatter-labels"><span>${escapeHtml(querySpec.y_column || "y")}</span><span>${escapeHtml(querySpec.x_column || "x")}</span></div><small class="chart-truncation">Mỗi điểm là một ô mật độ tổng hợp, không phải dòng dữ liệu thô.</small></div>`;
  }

  if (chartSpec.chart_type === "box") {
    const summaries = rows.map((row, index) => ({ label: text(row.group_label, `Tổng thể ${index + 1}`), min: exportChartNumber(row.min), q1: exportChartNumber(row.q1), median: exportChartNumber(row.median), q3: exportChartNumber(row.q3), max: exportChartNumber(row.max) })).filter((row): row is { label: string; min: number; q1: number; median: number; q3: number; max: number } => row.min !== null && row.q1 !== null && row.median !== null && row.q3 !== null && row.max !== null);
    if (!summaries.length) return `<div class="chart-empty-canvas" role="status">Không có tóm tắt năm số hợp lệ.</div>`;
    const domainMin = Math.min(...summaries.map((row) => row.min)); const spread = Math.max(Math.max(...summaries.map((row) => row.max)) - domainMin, 1);
    const position = (value: number) => `${(value - domainMin) / spread * 100}%`;
    return `<div class="chart-box-list" role="img" aria-label="${escapeHtml(title || "Box plot")}">${summaries.map((row, index) => `<div class="chart-box-row" style="--chart-color:${exportChartColor(index)}"><span class="truncate" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><span class="chart-box-track"><i class="chart-box-whisker" style="${exportStyle([["left", position(row.min)], ["width", `${(row.max - row.min) / spread * 100}%`]])}"></i><i class="chart-box-body" style="${exportStyle([["left", position(row.q1)], ["width", `${Math.max((row.q3 - row.q1) / spread * 100, 0.8)}%`]])}"></i><i class="chart-box-median" style="left:${position(row.median)}"></i></span><b>${escapeHtml(formatNumber(row.median))}</b></div>`).join("")}<small class="chart-truncation">Whisker: min–max · hộp: Q1–Q3 · vạch: median.</small></div>`;
  }

  if (chartSpec.chart_type === "heatmap") {
    const xName = querySpec.dimensions[0] || "x"; const yName = querySpec.dimensions[1] || "y";
    const xValues = [...new Set(rows.map((row) => String(row[xName] ?? "-")))]; const yValues = [...new Set(rows.map((row) => String(row[yName] ?? "-")))];
    const lookup = new Map(rows.map((row) => [`${String(row[xName] ?? "-")}\u0000${String(row[yName] ?? "-")}`, exportChartNumber(row.value) ?? 0]));
    return `<div class="chart-heatmap-wrap"><div class="chart-heatmap" role="grid" style="grid-template-columns:minmax(90px,auto) repeat(${yValues.length},minmax(68px,1fr))"><span class="heatmap-corner">${escapeHtml(xName)} \ ${escapeHtml(yName)}</span>${yValues.map((label) => `<b title="${escapeHtml(label)}">${escapeHtml(label)}</b>`).join("")}${xValues.map((xLabel) => `<b title="${escapeHtml(xLabel)}">${escapeHtml(xLabel)}</b>${yValues.map((yLabel) => { const value = lookup.get(`${xLabel}\u0000${yLabel}`) ?? 0; return `<span role="gridcell" class="heatmap-cell" style="--heat:${Math.max(value / max, 0.04)}" title="${escapeHtml(`${xLabel} · ${yLabel}: ${formatNumber(value)}`)}">${escapeHtml(formatNumber(value))}</span>`; }).join("")}`).join("")}</div><small class="chart-truncation">Màu đậm hơn thể hiện giá trị tổng hợp lớn hơn.</small></div>`;
  }

  if (matrixMode) {
    const xValues = [...new Set(rows.map((row) => String(row.x ?? "-")))]; const yValues = [...new Set(rows.map((row) => String(row.y ?? "-")))];
    const lookup = new Map(rows.map((row) => [`${String(row.x ?? "-")}\u0000${String(row.y ?? "-")}`, exportChartNumber(row.value) ?? 0]));
    const correlation = chartSpec.chart_type === "correlation_heatmap";
    return `<div class="chart-heatmap-wrap"><div class="chart-heatmap ${correlation ? "correlation-matrix" : "missing-matrix"}" role="grid" style="grid-template-columns:minmax(90px,auto) repeat(${yValues.length},minmax(68px,1fr))"><span class="heatmap-corner">Cột \ Cột</span>${yValues.map((label) => `<b title="${escapeHtml(label)}">${escapeHtml(label)}</b>`).join("")}${xValues.map((xLabel) => `<b title="${escapeHtml(xLabel)}">${escapeHtml(xLabel)}</b>${yValues.map((yLabel) => { const value = lookup.get(`${xLabel}\u0000${yLabel}`) ?? 0; const intensity = correlation ? Math.abs(value) : Math.abs(value) / 100; return `<span role="gridcell" class="heatmap-cell ${correlation && value < 0 ? "negative" : ""}" style="--heat:${Math.max(Math.min(intensity, 1), 0.04)}" title="${escapeHtml(`${xLabel} · ${yLabel}: ${formatNumber(value)}`)}">${escapeHtml(formatNumber(value))}</span>`; }).join("")}`).join("")}</div><small class="chart-truncation">${correlation ? "Pearson r tổng hợp; màu âm biểu thị tương quan nghịch. Tương quan không chứng minh nhân quả." : "Mỗi ô là tỷ lệ % hai cột cùng thiếu; không hiển thị từng dòng dữ liệu."}</small></div>`;
  }

  if (chartSpec.chart_type === "violin") {
    const groups = [...new Set(rows.map((row) => String(row.group_label ?? "Tổng thể")))];
    return `<div class="chart-violin-list" role="img" aria-label="${escapeHtml(title || "Violin plot tổng hợp")}">${groups.map((group, groupIndex) => { const groupRows = rows.filter((row) => String(row.group_label ?? "Tổng thể") === group); const localMax = Math.max(...groupRows.map((row) => exportChartNumber(row.value) ?? 0), 1); return `<div class="chart-violin-row" style="--chart-color:${exportChartColor(groupIndex)}"><b class="truncate" title="${escapeHtml(group)}">${escapeHtml(group)}</b><div class="chart-violin-shape">${groupRows.map((row) => { const value = exportChartNumber(row.value) ?? 0; const half = Math.max(value / localMax * 48, 1); return `<span class="chart-violin-bin" style="width:${half * 2}%" title="${escapeHtml(`${formatNumber(Number(row.bin_start))}–${formatNumber(Number(row.bin_end))}: ${formatNumber(value)}`)}"></span>`; }).join("")}</div></div>`; }).join("")}<small class="chart-truncation">Hình violin được dựng từ bin count tổng hợp, không phải raw points.</small></div>`;
  }

  if (chartSpec.chart_type === "donut") {
    const positiveRows = rows.map((row) => ({ row, value: Math.max(exportChartNumber(row.value) ?? 0, 0) })).filter((item) => item.value > 0);
    const total = positiveRows.reduce((sum, item) => sum + item.value, 0);
    if (!total) return `<div class="chart-empty-canvas" role="status">Không có giá trị dương để vẽ Donut.</div>`;
    const circumference = 2 * Math.PI * 25;
    let cursorOffset = 0;
    const slices = positiveRows.map((item, index) => { const fraction = item.value / total; const dash = fraction * circumference; const offset = cursorOffset; cursorOffset -= dash; return `<circle cx="50" cy="50" r="25" fill="transparent" stroke="${exportChartColor(index)}" stroke-width="50" stroke-dasharray="${dash} ${circumference}" stroke-dashoffset="${offset}"></circle>`; }).join("");
    return `<div class="chart-donut-wrap"><div class="chart-donut" role="img" aria-label="${escapeHtml(title || "Donut chart")}" style="position:relative;overflow:hidden"><svg width="100%" height="100%" viewBox="0 0 100 100" style="position:absolute;inset:0;transform:rotate(-90deg);border-radius:50%">${slices}</svg><span style="position:relative;z-index:1"><b>${escapeHtml(formatNumber(total))}</b><small>Tổng</small></span></div><div class="chart-donut-legend">${positiveRows.map((item, index) => `<div><i style="background:${exportChartColor(index)}"></i><span class="truncate" title="${escapeHtml(exportChartLabel(item.row, querySpec))}">${escapeHtml(exportChartLabel(item.row, querySpec))}</span><b>${escapeHtml(formatNumber(item.value / total * 100))}%</b></div>`).join("")}</div></div>`;
  }

  if (chartSpec.chart_type === "table") {
    return `<div class="table-wrap chart-result-table"><table><thead><tr>${result.columns.map((name) => `<th>${escapeHtml(name === "value" ? "Kết quả" : name)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${result.columns.map((name) => `<td>${escapeHtml(name === "value" ? formatNumber(exportChartNumber(row[name])) : text(row[name]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  if (chartSpec.chart_type === "kpi") {
    return `<div class="chart-kpi"><span>Giá trị tổng hợp</span><strong>${escapeHtml(formatNumber(exportChartNumber(rows[0]?.value) ?? 0))}</strong><small>${result.row_count} kết quả</small></div>`;
  }

  if (chartSpec.chart_type === "line") {
    const width = 720; const height = 220;
    if (forecastMode) {
      const domainValues = rows.flatMap((row) => [exportChartNumber(row.value), exportChartNumber(row.lower), exportChartNumber(row.upper)]).filter((value): value is number => value !== null);
      const domainMin = Math.min(...domainValues, 0); const domainMax = Math.max(...domainValues, 1); const domainSpread = Math.max(domainMax - domainMin, 1);
      const xAt = (index: number) => index / Math.max(rows.length - 1, 1) * width;
      const yAt = (value: number) => height - (value - domainMin) / domainSpread * (height - 26) - 12;
      const actualIndexes = rows.map((row, index) => row.series === "actual" ? index : -1).filter((index) => index >= 0);
      const forecastIndexes = rows.map((row, index) => row.series === "forecast" ? index : -1).filter((index) => index >= 0);
      const lastActual = actualIndexes[actualIndexes.length - 1];
      const forecastLineIndexes = lastActual === undefined ? forecastIndexes : [lastActual, ...forecastIndexes];
      const linePoints = (indexes: number[]) => indexes.map((index) => `${xAt(index)},${yAt(exportChartNumber(rows[index].value) ?? 0)}`).join(" ");
      const band = forecastIndexes.length ? [...forecastIndexes.map((index) => `${xAt(index)},${yAt(exportChartNumber(rows[index].upper) ?? exportChartNumber(rows[index].value) ?? 0)}`), ...forecastIndexes.slice().reverse().map((index) => `${xAt(index)},${yAt(exportChartNumber(rows[index].lower) ?? exportChartNumber(rows[index].value) ?? 0)}`)].join(" ") : "";
      const points = rows.map((row, index) => { const value = exportChartNumber(row.value); return value === null ? "" : `<circle class="${row.series === "forecast" ? "forecast-point" : "actual-point"}" cx="${xAt(index)}" cy="${yAt(value)}" r="3"><title>${escapeHtml(`${exportChartLabel(row, querySpec)} · ${row.series === "forecast" ? "Dự báo" : "Thực tế"}: ${formatNumber(value)}`)}</title></circle>`; }).join("");
      return `<div class="chart-line-wrap chart-forecast-wrap"><svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title || "Biểu đồ dự báo")}" class="chart-line-svg">${band ? `<polygon points="${band}" class="chart-forecast-band"></polygon>` : ""}${actualIndexes.length ? `<polyline points="${linePoints(actualIndexes)}" class="chart-actual-line" fill="none" stroke-width="3"></polyline>` : ""}${forecastLineIndexes.length ? `<polyline points="${linePoints(forecastLineIndexes)}" class="chart-forecast-line" fill="none" stroke-width="3" stroke-dasharray="8 5"></polyline>` : ""}${points}</svg><div class="chart-forecast-legend"><span><i class="actual"></i>Thực tế</span><span><i class="forecast"></i>Dự báo</span><span><i class="interval"></i>Khoảng dự báo ${Math.round((querySpec.confidence_level ?? 0.95) * 100)}%</span></div><div class="chart-axis-labels">${rows.map((row) => `<span title="${escapeHtml(exportChartLabel(row, querySpec))}">${escapeHtml(exportChartLabel(row, querySpec))}</span>`).join("")}</div>${result.row_count > rows.length ? `<small class="chart-truncation">Hiển thị ${rows.length}/${result.row_count} điểm gần nhất.</small>` : ""}</div>`;
    }
    const spread = Math.max(max - min, 1);
    const points = values.map((value, index) => Number.isFinite(value) ? `${index / Math.max(values.length - 1, 1) * width},${height - ((value - min) / spread) * (height - 26) - 12}` : null).filter((point): point is string => Boolean(point)).join(" ");
    return `<div class="chart-line-wrap"><svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title || "Biểu đồ đường")}" class="chart-line-svg"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>${values.map((value, index) => Number.isFinite(value) ? `<circle cx="${index / Math.max(values.length - 1, 1) * width}" cy="${height - ((value - min) / spread) * (height - 26) - 12}" r="4"><title>${escapeHtml(`${exportChartLabel(rows[index], querySpec)}: ${formatNumber(value)}`)}</title></circle>` : "").join("")}</svg><div class="chart-axis-labels">${rows.map((row) => `<span title="${escapeHtml(exportChartLabel(row, querySpec))}">${escapeHtml(exportChartLabel(row, querySpec))}</span>`).join("")}</div>${result.row_count > rows.length ? `<small class="chart-truncation">Hiển thị ${rows.length}/${result.row_count} điểm.</small>` : ""}</div>`;
  }

  const maxAbsolute = Math.max(...finiteValues.map(Math.abs), 1);
  const hasNegativeValues = finiteValues.some((value) => value < 0);
  const percentMetric = ["missing_bar", "outlier"].includes(chartSpec.chart_type);
  return `<div class="chart-bars chart-result-bars ${hasNegativeValues ? "has-negative-values" : ""}">${rows.map((row, index) => { const value = Number(row.value); const color = exportChartColor(index); const styles: Array<[string, string | number]> = !Number.isFinite(value) || value === 0 ? [["width", "0%"], ["display", "none"]] : !hasNegativeValues ? [["width", `${Math.max(value, 0) / Math.max(...finiteValues, 1) * 100}%`], ["left", "0"], ["background", `linear-gradient(90deg, ${color}a8, ${color})`], ["box-shadow", `0 2px 5px ${color}55`]] : [["width", `${Math.abs(value) / maxAbsolute * 50}%`], [value < 0 ? "right" : "left", "50%"]]; return `<div class="bar-row"><span class="truncate" title="${escapeHtml(exportChartLabel(row, querySpec))}">${escapeHtml(exportChartLabel(row, querySpec))}</span><span class="bar-track chart-diverging-track">${hasNegativeValues ? `<i class="chart-zero-line"></i>` : ""}<span class="bar-fill ${value < 0 ? "negative" : ""}" style="${exportStyle(styles)}"></span></span><b>${Number.isFinite(value) ? `${escapeHtml(formatNumber(value))}${percentMetric ? "%" : ""}` : "-"}</b></div>`; }).join("")}${result.row_count > rows.length ? `<small class="chart-truncation">Hiển thị ${rows.length}/${result.row_count} nhóm.</small>` : ""}</div>`;
}
function evidenceChart(title: string, item: DataRecord): string {
  const result = exportResult(item);
  const chartSpec = exportChartSpec(item);
  const querySpec = exportQuerySpec(item, chartSpec, result);
  const markup = renderChartEvidenceHtml(chartSpec, result, querySpec, title);
  return `<figure class="export-chart"><figcaption>${escapeHtml(title)}</figcaption><div class="export-chart-content">${markup}</div></figure>`;
}
function statRows(stats: DataRecord[]): Array<Array<unknown>> {
  return stats.map((stat) => {
    const piiTag = stat.pii_masked ? `<br/><span style="color:#b1324c;font-size:0.85em;background:#fff4f5;padding:2px 4px;border-radius:4px;display:inline-block;margin-top:2px;border:1px solid #f0c7d0;">Đã ẩn PII</span>` : "";
    let topValuesHtml = '<span style="color:#64748b">—</span>';
    
    if (stat.pii_masked) {
      topValuesHtml = `<span style="color:#b1324c;font-size:0.85em;background:#fff4f5;padding:2px 4px;border-radius:4px;display:inline-block;border:1px solid #f0c7d0;">Đã ẩn PII</span>`;
    } else {
      const topK = stat.top_values ?? stat.top_k_values;
      if (Array.isArray(topK) && topK.length > 0) {
        const topRows = topK.map(v => typeof v === 'object' && v !== null ? v : { value: String(v) }).slice(0, 5);
        if (topRows.length > 0) {
          topValuesHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:220px;">` + topRows.map(row => {
            const val = escapeHtml(String(row.value));
            const countStr = row.count !== undefined && row.count !== null ? number(row.count) : (row.frequency !== undefined && row.frequency !== null ? number(row.frequency) : "");
            const count = countStr ? ` <span style="color:#64748b;">(${countStr})</span>` : "";
            return `<span style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:0.85em;display:inline-block;white-space:nowrap;color:#334155;font-weight:600;">${val}${count}</span>`;
          }).join("") + `</div>`;
        }
      } else if (topK && typeof topK === 'object') {
        const entries = Object.entries(topK).slice(0, 5);
        if (entries.length > 0) {
          topValuesHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:220px;">` + entries.map(([key, val]) => {
            const count = val !== undefined && val !== null ? ` <span style="color:#64748b;">(${number(val)})</span>` : "";
            return `<span style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:0.85em;display:inline-block;white-space:nowrap;color:#334155;font-weight:600;">${escapeHtml(key)}${count}</span>`;
          }).join("") + `</div>`;
        }
      }
    }
    
    return [{ __html: `<strong>${escapeHtml(stat.column_name)}</strong>${piiTag}` }, stat.inferred_type ?? stat.dtype, percentage(stat.null_pct ?? stat.null_percentage), number(stat.cardinality ?? stat.distinct_count), percentage(stat.uniqueness_ratio), { __html: topValuesHtml }];
  });
}
function buildSections(source: ReportSource): Section[] {
  const profile = source.profile || {};
  const run = profile.run || {};
  const stats = Array.isArray(profile.column_stats) ? profile.column_stats : [];
  const snapshotItems = Array.isArray(source.report_snapshot?.items) ? source.report_snapshot.items : [];
  const sections: Section[] = [];

  sections.push({ title: "PHẦN 1: HỒ SƠ & CHẤT LƯỢNG", body: "", isPart: true });
  sections.push({ title: "Tổng quan Dataset", body: table(["Trường", "Giá trị"], [["Tên dataset", text(profile.dataset?.name)], ["Profile run", text(run.id)], ["Trạng thái", text(run.status)], ["Số dòng", number(run.row_count)], ["Chế độ quét", text(run.scan_mode)], ["Ngày profiling", date(run.created_at)]]) });

  const warnings = Array.isArray(run.risk_warnings) ? run.risk_warnings : [];
  if (warnings.length) {
    const md = warnings.map((warning) => `- ⚠️ ${String(warning).replace(/'([^']+)'/g, '\`$1\`')}`).join('\n');
    sections.push({ title: "Rủi ro và giới hạn", body: `<div class="narrative">${markdown(md)}</div>` });
  }

  if (run.narrative_report) {
    const lines = String(run.narrative_report).split(/\r?\n/);
    let preamble = "";
    const children: Section[] = [];
    let currentChild: { title: string, lines: string[], subChildren: Section[] } | null = null;
    let currentSubChild: { title: string, lines: string[] } | null = null;
    let lastTopLevel = 0;
    let lastSubLevel = 0;

    const pushSubChild = () => {
      if (currentSubChild && currentChild) {
        currentChild.subChildren.push({ title: currentSubChild.title, body: markdown(currentSubChild.lines.join("\n")), skipToc: true });
        currentSubChild = null;
      }
    };

    const pushChild = () => {
      pushSubChild();
      if (currentChild) {
        children.push({ title: currentChild.title, body: markdown(currentChild.lines.join("\n")), children: currentChild.subChildren });
        currentChild = null;
      }
    };

    for (const rawLine of lines) {
      const cleanLine = rawLine.replace(/^\s*[-*+]\s+/, "").replace(/^[#\s]+/, "").replace(/\*\*/g, "");
      const match = cleanLine.match(/^(\d+)[.)]\s+(.*)$/);

      if (match) {
        const num = parseInt(match[1], 10);
        let isTopLevel = false;

        if (num === lastTopLevel + 1) {
          lastTopLevel = num;
          lastSubLevel = 0;
          isTopLevel = true;
        } else if (num === lastSubLevel + 1 || num === 1) {
          lastSubLevel = num;
          isTopLevel = false;
        } else {
          lastTopLevel = num;
          lastSubLevel = 0;
          isTopLevel = true;
        }

        if (isTopLevel) {
          pushChild();
          currentChild = { title: match[2].trim(), lines: [], subChildren: [] };
          continue;
        } else {
          pushSubChild();
          currentSubChild = { title: match[2].trim(), lines: [] };
          continue;
        }
      }

      if (currentSubChild) currentSubChild.lines.push(rawLine);
      else if (currentChild) currentChild.lines.push(rawLine);
      else preamble += rawLine + "\n";
    }
    pushChild();

    sections.push({
      title: "Tóm tắt từ Agent",
      body: preamble.trim() ? markdown(preamble.trim()) : "",
      children,
      wrapBodyAndChildren: "narrative"
    });
  }

  if (stats.length) {
    const statBody = `${table(["Cột", "Kiểu", "Null", "Cardinality", "Uniqueness", "Giá trị phổ biến"], statRows(stats))}<div style="display: flex; flex-wrap: wrap; gap: 4mm; margin-top: 5mm;">${barChart("Tỷ lệ null theo cột", stats, "null_pct")}${barChart("Tỷ lệ unique theo cột", stats, "uniqueness_ratio")}</div>`;
    const distributions = stats.filter((stat) => {
      const topK = stat.top_values ?? stat.top_k_values;
      return !stat.pii_masked && topK && (Array.isArray(topK) || typeof topK === 'object');
    }).slice(0, 3);
    const distBody = distributions.length ? `<div style="display: flex; flex-wrap: wrap; gap: 4mm;">${distributions.map((stat) => distributionChart(stat, Number(run.row_count ?? 0))).join("")}</div>` : "";
    const correlation = profile.correlation_matrix;
    const corrBody = correlation && Object.keys(correlation).length ? table(["Cột", ...Object.keys(correlation).slice(0, 8)], Object.keys(correlation).slice(0, 8).map((column) => [column, ...Object.keys(correlation).slice(0, 8).map((peer) => { const value = Number(correlation[column]?.[peer]); return Number.isFinite(value) ? value.toFixed(2) : "-"; })]), "compact") : "";
    sections.push({ title: "Hồ sơ kỹ thuật", body: statBody + (distBody ? `<h4>Phân phối dữ liệu</h4>${distBody}` : "") + (corrBody ? `<h4>Tương quan</h4>${corrBody}` : "") });
  }

  if (snapshotItems.length) {
    sections.push({ title: "PHẦN 2: CHUYÊN ĐỀ PHÂN TÍCH", body: "", isPart: true });
    sections.push({
      title: "Biểu đồ đã ghim", body: "", children: snapshotItems.map((item, index) => {
        const content = item.content_json as DataRecord | undefined;
        const body = [item.note ? `<div class="callout"><strong>Ghi chú</strong><p>${escapeHtml(item.note)}</p></div>` : "", evidenceChart(text(item.title, `Phân tích ${index + 1}`), item), content?.insight ? `<div class="narrative"><strong>Insight đã lưu</strong>${markdown(content.insight)}</div>` : "", content?.answer ? `<div class="narrative">${markdown(content.answer)}</div>` : ""].join("");
        return { title: text(item.title, `Phân tích ${index + 1}`), body: body || "<p>Không có nội dung có thể xuất cho mục này.</p>" };
      })
    });
  }

  const drifts = Array.isArray(profile.drift_reports) ? profile.drift_reports : [];
  if (drifts.length) {
    sections.push({ title: DRIFT_PART_TITLE, body: "", isPart: true });
    const context = table(["Profile A", "Profile B", "Tóm tắt"], drifts.map((drift) => [driftDetailText(drift.profile_run_id_a), driftDetailText(drift.profile_run_id_b), driftDetailText(drift.summary)]));
    sections.push({ title: "Data Drift", body: context + driftEvidenceHtml(drifts) });
  }

  return sections;
}
function numberSections(sections: Section[], prefix = ""): void { let counter = 1; sections.forEach((section) => { if (section.isPart) return; const number = prefix ? `${prefix}.${counter}` : String(counter); section.number = number; counter++; if (section.children) numberSections(section.children, number); }); }
function renderSection(section: Section, level = 2): string { if (section.isPart) return `<div class="part-divider"><h2>${escapeHtml(section.title)}</h2></div>`; const heading = `h${Math.min(level, 4)}`; const contentHtml = `${section.body}${section.children?.map((child) => renderSection(child, level + 1)).join("") || ""}`; const wrappedContent = section.wrapBodyAndChildren ? `<div class="${section.wrapBodyAndChildren}">${contentHtml}</div>` : contentHtml; return `<section class="report-section level-${level}"><${heading}>${escapeHtml(section.number)}. ${escapeHtml(section.title)}</${heading}>${wrappedContent}</section>`; }
function toc(sections: Section[]): string { const entries = (nodes: Section[]): string => nodes.filter(n => !n.skipToc).map((section) => { if (section.isPart) return `<li class="toc-part"><span>${escapeHtml(section.title)}</span></li>`; return `<li class="toc-level-${section.number?.split(".").length || 1}"><span>${escapeHtml(section.number)}. ${escapeHtml(section.title)}</span></li>${section.children && section.children.filter(c => !c.skipToc).length ? `<ol>${entries(section.children)}</ol>` : ""}`; }).join(""); return `<section class="toc"><p class="kicker">CẤU TRÚC BÁO CÁO</p><h1>Mục lục</h1><ol>${entries(sections)}</ol></section>`; }
function styles(): string {
  return `<style>@page { size: A4; margin: 18mm 16mm 18mm; }* { box-sizing: border-box; }body { color: #172033; font-family: "Noto Sans", Arial, sans-serif; font-size: 10pt; line-height: 1.52; margin: 0; }h1,h2,h3,h4 { color: #102a43; line-height: 1.25; break-after: avoid; }h2 { border-bottom: 2px solid #2563eb; font-size: 18pt; margin: 11mm 0 5mm; padding-bottom: 2.5mm; }h3 { color: #1d4ed8; font-size: 13pt; margin: 8mm 0 3mm; }h4 { font-size: 11pt; margin: 5mm 0 2mm; }p { margin: 0 0 3mm; }ul { margin: 2mm 0 4mm; padding-left: 5mm; }.toc { min-height: 220mm; }.toc h1 { font-size: 25pt; margin: 0 0 8mm; }.toc .kicker { color: #2563eb; font-size: 8pt; font-weight: 700; letter-spacing: .12em; }.toc ol { list-style: none; margin: 0; padding: 0; }.toc li { border-bottom: 1px solid #e2e8f0; padding: 2.5mm 0; }.toc ol ol { margin-left: 6mm; }.toc-level-1 { color: #102a43; font-weight: 700; }.toc-level-2 { font-size: 9.5pt; }.toc-level-3 { color: #526075; font-size: 9pt; }table { border-collapse: collapse; font-size: 8.3pt; width: 100%; }.table-wrap { margin: 3mm 0 6mm; overflow: hidden; }th { background: #eaf2ff; color: #173d6b; font-weight: 700; text-align: left; }th,td { border: 1px solid #d9e2ec; overflow-wrap: anywhere; padding: 2.1mm 2.4mm; vertical-align: top; }tr { break-inside: avoid; }thead { display: table-header-group; }.compact table { font-size: 7.5pt; }.callout { background: #eff6ff; border-left: 3px solid #2563eb; break-inside: avoid; margin: 3mm 0 5mm; padding: 3.5mm 4mm; }.warning { background: #fffbeb; border-color: #d97706; }.narrative { background: #f8fafc; border: 1px solid #e2e8f0; break-inside: avoid; margin: 3mm 0 5mm; padding: 4mm; }.chart { break-inside: avoid; margin: 5mm 0 7mm; }.chart figcaption { color: #102a43; font-size: 9pt; font-weight: 700; margin-bottom: 2mm; }.chart svg { display: block; max-height: 180mm; max-width: 100%; width: 100%; }.chart-label { fill: #526075; font-family: Arial, sans-serif; font-size: 10px; }.chart-value { fill: #173d6b; font-family: Arial, sans-serif; font-size: 10px; }.part-divider { border-bottom: 3px solid #2563eb; margin: 15mm 0 5mm; padding-bottom: 2mm; break-after: avoid; }.part-divider h2 { border: none; font-size: 16pt; font-weight: 900; color: #1e293b; margin: 0; padding: 0; }.toc-part { color: #0f172a; font-size: 11pt; font-weight: 800; margin-top: 5mm; text-transform: uppercase; border-bottom: none !important; padding-bottom: 0 !important; }.drift-summary-grid { display: flex; gap: 4mm; margin: 3mm 0 5mm; }.drift-summary-grid > div { background: #f8fafc; border: 1px solid #d9e2ec; padding: 3mm; flex: 1; }.drift-summary-grid strong,.drift-summary-grid span,.drift-summary-grid small { display: block; }.drift-summary-grid strong { color: #173d6b; font-size: 15pt; }.drift-summary-grid span { color: #526075; font-size: 8pt; }.drift-summary-grid small { color: #64748b; font-size: 7.5pt; }.drift-detail { background: #f8fafc; border: 1px solid #d9e2ec; break-inside: avoid; margin: 4mm 0; padding: 4mm; }.drift-detail-heading { align-items: flex-start; display: flex; gap: 4mm; justify-content: space-between; }.drift-detail-heading h4 { margin: 0 0 1mm; }.drift-detail-heading p { color: #64748b; font-size: 8pt; margin: 0; }.drift-eyebrow { color: #2563eb !important; font-size: 7pt !important; font-weight: 700; letter-spacing: .12em; margin: 0 0 1mm !important; }.drift-detail > .drift-detail-heading > .drift-severity { flex: 0 0 auto; }.drift-severity { background: #eaf2ff; color: #173d6b; font-size: 8pt; padding: 1mm 2mm; }.drift-finding { border-top: 1px solid #d9e2ec; margin-top: 3mm; padding-top: 3mm; }.drift-finding > strong { color: #102a43; }.drift-values { margin-top: 2mm; }.drift-values th { width: 25%; }</style>`;
}
function exportChartStyles(): string {
  return `<style>
    .export-chart { background: #ffffff; border: 1px solid #d9e2ec; border-radius: 3mm; break-inside: avoid; margin: 4mm 0 6mm; padding: 4.5mm; }
    .export-chart figcaption { color: #102a43; font-size: 10.5pt; font-weight: 700; margin: 0 0 3mm; }
    .export-chart-content > * { margin: 0; }
    .export-chart .chart-result-canvas { color: #172033; min-height: 0; }
    .export-chart .chart-bars { display: grid; gap: 2.5mm; }
    .export-chart .chart-result-bars .bar-row { align-items: center; display: grid; gap: 3mm; grid-template-columns: 34mm minmax(0, 1fr) 22mm; min-height: 7mm; }
    .export-chart .chart-result-bars .bar-row > .truncate { color: #526075; font-size: 8.5pt; overflow-wrap: anywhere; }
    .export-chart .chart-result-bars .bar-track { background: #eef2f7; border-radius: 999px; display: block; height: 4.5mm; overflow: hidden; position: relative; }
    .export-chart .chart-result-bars .bar-fill { border-radius: inherit; display: block; height: 100%; }
    .export-chart .chart-result-bars .chart-diverging-track .bar-fill { position: absolute; top: 0; }
    .export-chart .chart-result-bars .bar-row > b { color: #173d6b; font-size: 8.5pt; font-weight: 700; text-align: right; }
    .export-chart .chart-truncation { color: #64748b; font-size: 8pt; margin-top: 2mm; }
    .export-chart .chart-line-wrap { min-width: 0; }
    .export-chart .chart-line-svg { color: #0ea5e9; }
    .export-chart .chart-line-svg, .export-chart .chart-scatter-svg { display: block; height: 58mm; overflow: visible; width: 100%; }
    .export-chart .chart-line-svg circle { fill: #0284c7; stroke: #ffffff; stroke-width: 1.5; }
    .export-chart .chart-line-svg .forecast-point { fill: #ffffff; stroke: #e8790c; stroke-width: 2; }
    .export-chart .chart-actual-line { stroke: #315efb; }
    .export-chart .chart-forecast-line { stroke: #e8790c; }
    .export-chart .chart-forecast-band { fill: rgba(232, 121, 12, .14); stroke: none; }
    .export-chart .chart-scatter-svg line { stroke: #cbd5e1; stroke-dasharray: 4 4; stroke-width: 1; }
    .export-chart .chart-scatter-svg circle { fill: rgba(6, 182, 212, .75); stroke: #0891b2; stroke-width: 1.5; }
    .export-chart .chart-axis-labels { color: #64748b; display: flex; font-size: 7pt; gap: 2mm; justify-content: space-between; margin-top: 1mm; }
    .export-chart .chart-axis-labels span { max-width: 30%; overflow-wrap: anywhere; }
    .export-chart .chart-forecast-legend { color: #526075; display: flex; font-size: 8pt; gap: 5mm; margin-top: 2mm; }
    .export-chart .chart-forecast-legend span { align-items: center; display: inline-flex; gap: 1.5mm; }
    .export-chart .chart-forecast-legend i { border-radius: 50%; display: inline-block; height: 2.5mm; width: 2.5mm; }
    .export-chart .chart-histogram { align-items: end; display: flex; gap: 2mm; height: 64mm; overflow: hidden; padding: 2mm 1mm 0; }
    .export-chart .histogram-column { align-items: center; display: flex; flex: 1; flex-direction: column; height: 100%; justify-content: end; min-width: 0; }
    .export-chart .histogram-value { color: #173d6b; font-size: 7pt; margin-bottom: 1mm; }
    .export-chart .histogram-bar { border-radius: 1.5mm 1.5mm 0 0; max-height: 52mm; min-height: 1mm; width: 100%; }
    .export-chart .histogram-label { color: #526075; font-size: 6.5pt; margin-top: 1mm; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .export-chart .chart-box-list, .export-chart .chart-violin-list { display: grid; gap: 3mm; }
    .export-chart .chart-box-row { align-items: center; break-inside: avoid; display: grid; font-size: 8pt; gap: 3mm; grid-template-columns: 30mm minmax(0, 1fr) 18mm; }
    .export-chart .chart-box-row > .truncate, .export-chart .chart-violin-row > .truncate { color: #526075; overflow-wrap: anywhere; }
    .export-chart .chart-box-row > b { color: #173d6b; font-size: 8pt; text-align: right; }
    .export-chart .chart-box-track { height: 7mm; position: relative; }
    .export-chart .chart-box-whisker { background: #94a3b8; height: .5mm; position: absolute; top: 3mm; }
    .export-chart .chart-box-body { background: #bfdbfe; border: .4mm solid #2563eb; border-radius: 1mm; height: 6mm; position: absolute; top: .5mm; }
    .export-chart .chart-box-median { background: #1d4ed8; height: 7mm; position: absolute; top: 0; width: .7mm; }
    .export-chart .chart-violin-row { align-items: center; break-inside: avoid; display: grid; gap: 3mm; grid-template-columns: 30mm minmax(0, 1fr); }
    .export-chart .chart-violin-shape { align-items: center; border-left: 1px solid #c8d2e4; border-right: 1px solid #c8d2e4; display: flex; flex-direction: column; gap: 1px; justify-content: center; min-height: 22mm; }
    .export-chart .chart-violin-bin { background: #7c83e8; border-radius: 999px; display: block; min-height: 1mm; }
    .export-chart .chart-heatmap-wrap { overflow: visible; }
    .export-chart .chart-heatmap { font-size: 7pt; min-width: 0; }
    .export-chart .heatmap-cell { background: #e5e7eb; border-radius: 1mm; color: #0f172a; min-height: 8mm; overflow: hidden; padding: 1.5mm 1mm; text-align: center; }
    .export-chart .heatmap-cell { background: color-mix(in oklch, #4338ca calc(var(--heat) * 100%), #fef08a); }
    .export-chart .correlation-matrix .heatmap-cell.negative { background: color-mix(in oklch, #be123c calc(var(--heat) * 100%), #fecdd3); }
    .export-chart .heatmap-label { color: #526075; font-size: 6.5pt; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .export-chart .chart-donut-wrap { align-items: center; display: grid; gap: 6mm; grid-template-columns: 48mm minmax(0, 1fr); }
    .export-chart .chart-donut { background: #e0e7ff; height: 44mm; width: 44mm; }
    .export-chart .chart-donut > span { background: #ffffff; display: grid; place-content: center; text-align: center; }
    .export-chart .chart-donut > span small { color: #64748b; display: block; }
    .export-chart .chart-donut-legend { display: grid; gap: 1.5mm; min-width: 0; }
    .export-chart .chart-donut-legend > div { align-items: center; display: grid; font-size: 8pt; gap: 2mm; grid-template-columns: 3mm minmax(0, 1fr) auto; }
    .export-chart .chart-donut-legend i { border-radius: 50%; height: 2.5mm; width: 2.5mm; }
    .export-chart .chart-donut-legend span { overflow-wrap: anywhere; }
    .export-chart .chart-donut-legend b { color: #173d6b; }
    .export-chart .chart-kpi { border: 0; display: grid; gap: 2mm; min-height: 35mm; padding: 2mm 0; place-content: center; text-align: center; }
    .export-chart .chart-kpi strong { color: #102a43; font-size: 22pt; }
    .export-chart .chart-kpi span, .export-chart .chart-kpi small { color: #64748b; font-size: 8pt; }
    .export-chart .chart-result-table { max-height: none; overflow: visible; }
    .export-chart .chart-result-table table { font-size: 8pt; }
    .export-chart .chart-empty-canvas { color: #64748b; font-size: 9pt; padding: 5mm 0 2mm; }
  </style>`;
}
function coverHtml(source: ReportSource): string {
  const profile = source.profile || {}; const run = profile.run || {};
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans",Arial,sans-serif}.cover{background:linear-gradient(145deg,#0f2747,#173d6b);color:#fff;height:297mm;overflow:hidden;padding:28mm 23mm;position:relative}.cover:after{background:#3b82f6;border-radius:50%;content:"";height:110mm;opacity:.23;position:absolute;right:-45mm;top:-35mm;width:110mm}.eyebrow{color:#b9d7ff;font-size:9pt;font-weight:700;letter-spacing:.16em;margin:0 0 34mm}.title{font-size:31pt;line-height:1.1;margin:0 0 9mm;max-width:130mm}.dataset{color:#dbeafe;font-size:17pt;line-height:1.4;margin:0 0 45mm;max-width:135mm}.metadata{border-top:1px solid rgba(255,255,255,.35);font-size:10pt;line-height:1.8;max-width:125mm;padding-top:7mm}.brand{bottom:23mm;color:#b9d7ff;font-size:9pt;left:23mm;position:absolute}</style></head><body><main class="cover"><p class="eyebrow">VDaAgent · DATA QUALITY</p><h1 class="title">DATA PROFILING REPORT</h1><p class="dataset">${escapeHtml(text(source.report_snapshot?.title || profile.dataset?.name, "Báo cáo hồ sơ dữ liệu"))}</p><div class="metadata"><div><strong>Dataset:</strong> ${escapeHtml(text(profile.dataset?.name))}</div><div><strong>Profile run:</strong> ${escapeHtml(text(run.id))}</div><div><strong>Ngày tạo báo cáo:</strong> ${escapeHtml(date(new Date()))}</div></div><p class="brand">Tài liệu được tạo tự động từ dữ liệu profiling đã được cấp quyền.</p></main></body></html>`;
}
function tocHtml(sections: Section[]): string { return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${styles()}</head><body>${toc(sections)}</body></html>`; }
function bodyHtml(source: ReportSource, sections: Section[]): string { return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${styles()}${exportChartStyles()}</head><body>${sections.map((section) => renderSection(section)).join("")}</body></html>`; }
function backCoverHtml(source: ReportSource): string { return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans",Arial,sans-serif}.back{align-items:center;background:#f1f5f9;color:#102a43;display:flex;height:297mm;justify-content:center;overflow:hidden;padding:25mm;text-align:center}.rule{background:#2563eb;height:3px;margin:9mm auto;width:28mm}h1{font-size:28pt;margin:0}p{color:#526075;font-size:11pt;line-height:1.6;max-width:110mm}.brand{font-size:9pt;font-weight:700;letter-spacing:.11em;margin-top:35mm}</style></head><body><main class="back"><div><h1>KẾT THÚC BÁO CÁO</h1><div class="rule"></div><p>Data Profiling Report cho ${escapeHtml(text(source.profile?.dataset?.name, "dataset"))}</p><p>Tài liệu này được tạo tự động từ bản phân tích đã được cấp quyền.</p><p class="brand">VDAAGENT · DATA PROFILING</p></div></main></body></html>`; }
function chromiumExecutable(): string { const candidates = [process.env.PDF_CHROMIUM_EXECUTABLE_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter((candidate): candidate is string => Boolean(candidate)); const executable = candidates.find((candidate) => existsSync(candidate)); if (!executable) throw new PdfExportError("Máy chủ xuất PDF chưa có Chromium. Hãy cấu hình PDF_CHROMIUM_EXECUTABLE_PATH.", 503); return executable; }
async function render(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string, includeFooter: boolean, datasetName: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try { await page.setContent(html, { waitUntil: "load" }); await page.evaluate(() => document.fonts.ready); const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: includeFooter, margin: includeFooter ? { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" } : { top: "0", right: "0", bottom: "0", left: "0" }, headerTemplate: includeFooter ? `<div style="color:#64748b;font-family:Arial,sans-serif;font-size:8px;margin-left:16mm;width:178mm;">${escapeHtml(datasetName)} · Data Profiling Report</div>` : "<span></span>", footerTemplate: includeFooter ? `<div style="color:#64748b;font-family:Arial,sans-serif;font-size:8px;margin-left:16mm;text-align:right;width:178mm;">Trang <span class="pageNumber"></span></div>` : "<span></span>" }); return Uint8Array.from(pdf); } finally { await page.close(); }
}
async function merge(parts: Uint8Array[]): Promise<Uint8Array> { const output = await PDFDocument.create(); for (const bytes of parts) { const input = await PDFDocument.load(bytes); const pages = await output.copyPages(input, input.getPageIndices()); pages.forEach((page) => output.addPage(page)); } return output.save(); }
export async function generateProfilingPdf(input: Record<string, unknown>): Promise<Uint8Array> {
  if (activeExports >= MAX_CONCURRENT_EXPORTS) throw new PdfExportError("Máy chủ đang xử lý nhiều yêu cầu xuất PDF. Vui lòng thử lại sau ít phút.", 429);
  activeExports += 1; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try { const source = input as ReportSource; const sections = buildSections(source); numberSections(sections); browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] }); const datasetName = text(source.profile?.dataset?.name, "Data Profiling Report"); return await merge([await render(browser, coverHtml(source), false, datasetName), await render(browser, tocHtml(sections), false, datasetName), await render(browser, bodyHtml(source, sections), true, datasetName), await render(browser, backCoverHtml(source), false, datasetName)]); }
  catch (error) { if (error instanceof PdfExportError) throw error; console.error("Chromium PDF rendering failed", error); throw new PdfExportError("Không thể render PDF bằng Chromium.", 503); }
  finally { activeExports -= 1; await browser?.close(); }
}
export const __test__ = { buildSections, bodyHtml, tocHtml, coverHtml, backCoverHtml, numberSections };
