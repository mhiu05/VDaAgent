import { FileSpreadsheet, FileText, Database } from "lucide-react";

export function getSourceName(source) {
  return source?.source?.name || source?.source_name || "Unknown source";
}

export function getSourceType(source) {
  return source?.source?.type || source?.source_type || "profiled source";
}

export function getSourceIcon(sourceType, sourceName) {
  const text = `${sourceType} ${sourceName}`.toLowerCase();
  if (text.includes("excel") || text.includes("sheet") || text.includes("xlsx")) return FileSpreadsheet;
  if (text.includes("database") || text.includes("table") || text.includes("sql") || text.includes("postgres")) return Database;
  return FileText;
}

export function formatCompact(value) {
  if (value === "-" || value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Intl.NumberFormat("en", { notation: number >= 10000 ? "compact" : "standard" }).format(number);
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "-");
  return Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatMaybeNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return typeof value === "number" ? Number(value.toFixed(3)).toString() : String(value);
}

export function formatPercentValue(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export function buildQualityOverview(result, columns, findings, quality) {
  const rows = result?.dataset_summary?.row_count ?? result?.row_count ?? null;
  const columnCount = result?.dataset_summary?.column_count ?? result?.column_count ?? columns.length ?? null;
  const numericRows = Number(rows);
  const numericColumns = Number(columnCount);
  const totalCells = numericRows * numericColumns;
  const nulls = columns.reduce((sum, column) => sum + Number(column.null_count || 0), 0);
  const missingRatio = totalCells > 0 ? nulls / totalCells : null;
  const duplicateRatio = result?.dataset_summary?.duplicate_ratio ?? result?.duplicate_ratio ?? null;
  const warningCount = quality?.warning_count ?? countSeverity(findings, "warning");
  const criticalCount = quality?.critical_count ?? countSeverity(findings, "critical");
  const infoCount = quality?.info_count ?? countSeverity(findings, "info");
  const score = missingRatio === null
    ? null
    : Math.max(0, Math.round(100 - missingRatio * 25 - warningCount * 4 - criticalCount * 15));

  return {
    rows,
    columns: columnCount,
    missingRatio,
    duplicateRatio,
    warningCount,
    criticalCount,
    infoCount,
    score,
  };
}

export function countSeverity(findings, severity) {
  return (findings || []).filter((finding) => finding.severity === severity).length;
}

export function groupFindingsByColumn(findings) {
  return (findings || []).reduce((map, finding) => {
    const key = finding.column || "__dataset__";
    const current = map.get(key) || [];
    current.push(finding);
    map.set(key, current);
    return map;
  }, new Map());
}

export function getWorstSeverity(findings) {
  if (!findings?.length) return "ok";
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.some((finding) => finding.severity === "warning")) return "warning";
  return "info";
}

export function getColumnKind(column) {
  const type = String(column?.data_type || "").toLowerCase();
  if (type.includes("bool")) return "boolean";
  if (type.includes("int") || type.includes("double") || type.includes("float") || type.includes("decimal") || type.includes("numeric")) {
    return column?.distinct_ratio !== undefined && column.distinct_ratio <= 0.05 ? "low-cardinality numeric" : "numeric";
  }
  if (type.includes("date") || type.includes("time")) return "datetime";
  return "categorical";
}

export function isCategoricalLike(column) {
  const kind = getColumnKind(column);
  return kind === "categorical" || kind === "boolean" || kind === "low-cardinality numeric" || Number(column?.distinct_ratio) <= 0.05;
}

export function buildQualityCharts(columns, findings) {
  const columnTypeCounts = new Map();
  const highCardinality = [];
  const lowCardinality = [];
  const outlierColumns = [];
  const piiColumns = [];

  (columns || []).forEach((column) => {
    const type = column.data_type || "unknown";
    columnTypeCounts.set(type, (columnTypeCounts.get(type) || 0) + 1);
    if (Number(column.distinct_ratio) >= 0.8) highCardinality.push(column);
    if (Number(column.distinct_ratio) <= 0.05) lowCardinality.push(column);
    if (Number(column.outlier?.outlier_count || 0) > 0) outlierColumns.push(column);
    if ((column.pii_detection || []).length) piiColumns.push(column);
  });

  const severityCounts = ["critical", "warning", "info"].map((severity) => ({
    severity,
    count: countSeverity(findings, severity),
  }));

  return {
    columnTypes: Array.from(columnTypeCounts, ([name, count]) => ({ name, count })),
    missingColumns: [...(columns || [])]
      .filter((column) => Number(column.null_ratio) > 0)
      .sort((a, b) => Number(b.null_ratio || 0) - Number(a.null_ratio || 0))
      .slice(0, 12)
      .map((column) => ({ name: column.name, value: Number(column.null_ratio || 0) })),
    severityCounts,
    highCardinality,
    lowCardinality,
    outlierColumns,
    piiColumns,
  };
}
