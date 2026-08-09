import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, FileSpreadsheet, FileText, Info, Table2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyTable, Metric, PanelTitle, SeverityBadge } from "../shared/components.jsx";
import { formatPercent } from "../utils/formatters.js";

export function ResultsView({
  result,
  resultSources,
  selectedProfileIndex,
  setSelectedProfileIndex,
  columns,
  findings,
  correlations,
  quality,
  topCategoricalColumn,
}) {
  const [selectedColumnName, setSelectedColumnName] = useState("");
  const selectedColumn = useMemo(
    () => columns.find((column) => column.name === selectedColumnName) || columns[0] || null,
    [columns, selectedColumnName],
  );
  const overview = buildQualityOverview(result, columns, findings, quality);

  return (
    <section className="report-page">
      <div className="section-header">
        <div>
          <h2>Profile Results / Data Quality Report</h2>
          <p>Overview, column-level quality, and explainable profiling details.</p>
        </div>
      </div>
      <ReportOverview result={result} sourceName={getSourceName(result)} overview={overview} findings={findings} />
      <SourceResultSelector
        sources={resultSources?.length ? resultSources : result ? [result] : []}
        selectedIndex={selectedProfileIndex}
        setSelectedIndex={setSelectedProfileIndex}
      />
      <div className="two-column wide-left">
        <section className="panel">
          <PanelTitle title="Column summary" aside={result?.source?.name || "No profile loaded"} />
          <ResultColumnsTable columns={columns} findings={findings} selectedColumn={selectedColumn} setSelectedColumnName={setSelectedColumnName} />
        </section>
        <section className="panel">
          <ColumnDetail column={selectedColumn} findings={findings} />
        </section>
      </div>
      <div className="two-column">
        <section className="panel">
          <PanelTitle title="Correlations" aside="Pearson strength" />
          <CorrelationChart correlations={correlations} />
        </section>
        <section className="panel">
          <PanelTitle title="Top values" aside={topCategoricalColumn?.name || "Categorical columns"} />
          <TopValuesChart column={topCategoricalColumn} />
        </section>
      </div>
    </section>
  );
}

function ResultColumnsTable({ columns, findings, selectedColumn, setSelectedColumnName }) {
  if (!columns.length) return <EmptyTable columns={7} message="No profiling result yet." />;
  return (
    <>
      <IssueLegend />
      <div className="table-wrap profile-table-wrap">
        <table className="profile-table">
          <thead>
            <tr><th>Column</th><th>Type</th><th>Null %</th><th>Unique</th><th>Min</th><th>Max</th><th>Issues</th></tr>
          </thead>
          <tbody>
            {columns.map((column) => {
              const columnFindings = findings.filter((item) => item.column === column.name);
              return (
                <tr
                  key={column.name}
                  className={selectedColumn?.name === column.name ? "selected-row" : ""}
                  onClick={() => setSelectedColumnName(column.name)}
                >
                  <td><span className="column-name" title={`Column: ${column.name}`}><Table2 size={15} /> {column.name}</span></td>
                  <td><span className="type-pill" title={`Inferred data type: ${column.data_type}`}>{column.data_type}</span></td>
                  <td><MetricBar value={column.null_ratio} tone="warn" /></td>
                  <td><MetricBar value={column.distinct_ratio} tone="info" /></td>
                  <td title={`Minimum value: ${column.min ?? "not available"}`}>{column.min ?? "-"}</td>
                  <td title={`Maximum value: ${column.max ?? "not available"}`}>{column.max ?? "-"}</td>
                  <td>{columnFindings.length ? <IssueSummary findings={columnFindings} /> : <OkIssueMark />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function IssueLegend() {
  return (
    <div className="issue-legend" aria-label="Issue severity legend">
      <LegendItem tone="info" label="info" tooltip="Info: an observation or candidate signal. It is not necessarily a data quality problem." />
      <LegendItem tone="warning" label="warning" tooltip="Warning: a data quality risk that should be reviewed before trusting this data." />
      <LegendItem tone="critical" label="critical" tooltip="Critical: a blocking or high-risk data quality issue." />
      <LegendItem tone="ok" label="OK" tooltip="OK: no profiling findings were generated for this column." />
    </div>
  );
}

function LegendItem({ tone, label, tooltip }) {
  return (
    <span className={`issue-legend-item ${tone}`}>
      {label}
      <span className="lookup-tooltip" data-tooltip={tooltip} aria-label={tooltip} tabIndex={0}>
        <Info size={13} className="lookup-icon" />
      </span>
    </span>
  );
}

function ReportOverview({ result, sourceName, overview, findings }) {
  const metadata = result?.profile_metadata || {};
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;
  const scoreTone = overview.score >= 90 ? "good" : overview.score >= 75 ? "warn" : "bad";

  return (
    <section className="report-hero panel">
      <div className="report-hero-main">
        <div className={`quality-ring ${scoreTone}`} style={{ "--score": `${overview.score}%` }}>
          <strong>{overview.score}</strong>
          <span>/100</span>
        </div>
        <div className="report-title-block">
          <span className="selector-label">Data quality report</span>
          <h3 title={sourceName}>{sourceName}</h3>
          <div className="report-meta">
            <span>{metadata.engine || "duckdb"} engine</span>
            <span>{metadata.profile_mode || "full"} mode</span>
            <span>{metadata.generated_at ? formatDateTime(metadata.generated_at) : "generated in this session"}</span>
          </div>
        </div>
      </div>
      <div className="report-kpi-grid">
        <ReportKpi label="Rows" value={formatCompact(overview.rows)} tone="neutral" />
        <ReportKpi label="Columns" value={overview.columns} tone="neutral" />
        <ReportKpi label="Missing" value={overview.missing} tone={parseFloat(overview.missing) >= 10 ? "warn" : "good"} />
        <ReportKpi label="Warnings" value={warningCount} tone={warningCount ? "warn" : "good"} />
        <ReportKpi label="Critical" value={criticalCount} tone={criticalCount ? "bad" : "good"} />
        <ReportKpi label="Info" value={infoCount} tone="info" />
      </div>
    </section>
  );
}

function ReportKpi({ label, value, tone }) {
  return (
    <div className={`report-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ColumnDetail({ column, findings }) {
  if (!column) return <div className="empty-state">Select a column to inspect details.</div>;
  const columnFindings = findings.filter((item) => item.column === column.name);
  return (
    <div className="column-detail">
      <PanelTitle title="Column detail" aside={column.name} />
      <div className="detail-stat-grid">
        <Metric label="Type" value={column.data_type} />
        <Metric label="Null" value={formatPercent(column.null_ratio)} />
        <Metric label="Unique" value={column.distinct_count} />
        <Metric label="Outliers" value={column.outlier?.outlier_count ?? "-"} />
      </div>
      <section>
        <h4>Statistics</h4>
        <div className="detail-kv">
          <span>Min</span><b>{column.min ?? "-"}</b>
          <span>Max</span><b>{column.max ?? "-"}</b>
          <span>Avg</span><b>{formatMaybeNumber(column.avg)}</b>
          <span>Stddev</span><b>{formatMaybeNumber(column.stddev)}</b>
          <span>P25</span><b>{formatMaybeNumber(column.p25)}</b>
          <span>Median</span><b>{formatMaybeNumber(column.median)}</b>
          <span>P75</span><b>{formatMaybeNumber(column.p75)}</b>
        </div>
      </section>
      <section>
        <h4>Top values</h4>
        {column.top_values?.length ? <MiniBars values={column.top_values} /> : <p className="muted">No top values returned for this column.</p>}
      </section>
      <section>
        <h4>Sample values</h4>
        <div className="sample-chip-list">{(column.sample_values || []).map((value, index) => <span key={index}>{String(value)}</span>)}</div>
      </section>
      <section>
        <h4>Detected patterns</h4>
        <PatternList column={column} />
      </section>
      <section>
        <h4>Anomalies / issues</h4>
        {columnFindings.length ? <FindingsList findings={columnFindings} /> : <p className="muted">No issues detected for this column.</p>}
      </section>
    </div>
  );
}

function MiniBars({ values }) {
  const max = Math.max(...values.map((item) => item.count), 1);
  return (
    <div className="mini-bars">
      {values.map((item, index) => (
        <div key={index}>
          <span>{String(item.value)}</span>
          <i><b style={{ width: `${(item.count / max) * 100}%` }} /></i>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
  );
}

function PatternList({ column }) {
  const patterns = column.regex_patterns || [];
  const pii = column.pii_detection || [];
  if (!patterns.length && !pii.length && !column.outlier) return <p className="muted">No patterns, PII, or outlier metadata returned.</p>;
  return (
    <div className="pattern-list">
      {patterns.map((pattern) => <span key={pattern.name}>{pattern.name}: {(pattern.confidence * 100).toFixed(0)}%</span>)}
      {pii.map((item) => <span key={item.pii_type}>PII {item.pii_type}: {(item.confidence * 100).toFixed(0)}%</span>)}
      {column.outlier && <span>Outlier method: {column.outlier.method}, ratio {formatPercent(column.outlier.outlier_ratio)}</span>}
    </div>
  );
}

function IssueSummary({ findings }) {
  const worst = findings.find((finding) => finding.severity === "critical")
    || findings.find((finding) => finding.severity === "warning")
    || findings[0];
  return (
    <span
      className={`issue-summary ${worst.severity}`}
      aria-label={`${worst.severity}: ${findings.length} finding(s)`}
    >
      <AlertTriangle size={14} />
      {worst.severity} ({findings.length})
    </span>
  );
}

function OkIssueMark() {
  return (
    <span className="ok-mark" aria-label="OK: no profiling findings">
      <CheckCircle2 size={15} /> OK
    </span>
  );
}

function SourceResultSelector({ sources, selectedIndex, setSelectedIndex }) {
  if (!sources.length) return null;
  const safeIndex = sources[selectedIndex] ? selectedIndex : 0;
  const selectedSource = sources[safeIndex] || sources[0];
  const selectedName = getSourceName(selectedSource);
  const selectedType = getSourceType(selectedSource);
  const SelectedIcon = getSourceIcon(selectedType, selectedName);
  const warnings = selectedSource.quality_summary?.warning_count ?? 0;

  return (
    <div className="profile-source-selector">
      <div className="profile-source-current">
        <span className="profile-source-icon"><SelectedIcon size={18} /></span>
        <div>
          <span className="selector-label">Profiled source</span>
          <strong>{selectedName}</strong>
        </div>
      </div>
      <label className="profile-source-dropdown">
        <span>Table / sheet</span>
        <select value={safeIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
          {sources.map((source, index) => {
            const sourceName = getSourceName(source);
            const sourceType = getSourceType(source);
            return (
              <option key={`${sourceName}-${index}`} value={index}>
                {sourceName} - {sourceType}
              </option>
            );
          })}
        </select>
      </label>
      <div className="profile-source-stats">
        <span><b>{selectedSource.dataset_summary?.row_count ?? "-"}</b> rows</span>
        <span><b>{selectedSource.dataset_summary?.column_count ?? "-"}</b> columns</span>
        <span><b>{warnings}</b> warnings</span>
      </div>
    </div>
  );
}

function MetricBar({ value, tone }) {
  const percent = Math.max(0, Math.min(100, (value || 0) * 100));
  const label = tone === "warn" ? "Null ratio" : "Distinct ratio";
  return (
    <span className="metric-bar-cell" title={`${label}: ${formatPercent(value)}`}>
      <span className={`metric-bar ${tone}`}><i style={{ width: `${percent}%` }} /></span>
      <span>{formatPercent(value)}</span>
    </span>
  );
}

function getSourceName(source) {
  return source?.source?.name || source?.source_name || "Unknown source";
}

function getSourceType(source) {
  return source?.source?.type || source?.source_type || "profiled source";
}

function getSourceIcon(sourceType, sourceName) {
  const text = `${sourceType} ${sourceName}`.toLowerCase();
  if (text.includes("excel") || text.includes("sheet") || text.includes("xlsx")) return FileSpreadsheet;
  if (text.includes("database") || text.includes("table") || text.includes("sql") || text.includes("postgres")) return Database;
  return FileText;
}

function buildQualityOverview(result, columns, findings, quality) {
  const rows = result?.dataset_summary?.row_count ?? "-";
  const columnCount = result?.dataset_summary?.column_count ?? columns.length ?? "-";
  const totalCells = Number(rows) * Number(columnCount);
  const nulls = columns.reduce((sum, column) => sum + (column.null_count || 0), 0);
  const missingRatio = totalCells > 0 ? nulls / totalCells : 0;
  const score = Math.max(0, Math.round(
    100
    - missingRatio * 25
    - (quality.warning_count || 0) * 4
    - (quality.critical_count || 0) * 15,
  ));
  return {
    rows,
    columns: columnCount,
    missing: formatPercent(missingRatio),
    score,
  };
}

function formatCompact(value) {
  if (value === "-" || value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Intl.NumberFormat("en", { notation: number >= 10000 ? "compact" : "standard" }).format(number);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMaybeNumber(value) {
  if (value === null || value === undefined) return "-";
  return typeof value === "number" ? Number(value.toFixed(3)).toString() : String(value);
}

function FindingsList({ findings }) {
  if (!findings.length) return <div className="empty-state">No data quality issues detected.</div>;
  return (
    <div className="finding-list">
      {findings.map((finding, index) => (
        <div className={`finding ${finding.severity}`} key={`${finding.column}-${index}`}>
          <SeverityBadge severity={finding.severity} />
          <p>{finding.message}</p>
        </div>
      ))}
    </div>
  );
}

function CorrelationChart({ correlations }) {
  const [viewMode, setViewMode] = useState("matrix");
  if (!correlations.length) return <div className="empty-state chart-empty">No correlations available.</div>;
  const data = correlations.slice(0, 8).map((item) => ({
    name: `${item.left_column} / ${item.right_column}`,
    shortName: compactPairName(item.left_column, item.right_column),
    value: Number(item.coefficient.toFixed(3)),
  }));
  const strongest = data.reduce((best, item) => Math.abs(item.value) > Math.abs(best.value) ? item : best, data[0]);
  return (
    <div className="chart-box polished-chart">
      <div className="chart-summary">
        <span>Strongest pair</span>
        <strong title={strongest.name}>{strongest.name}</strong>
        <b>{strongest.value}</b>
      </div>
      <div className="chart-legend">
        <span><i className="positive" /> positive</span>
        <span><i className="negative" /> negative</span>
        <div className="chart-mode-toggle" aria-label="Correlation chart mode">
          <button className={viewMode === "matrix" ? "active" : ""} type="button" onClick={() => setViewMode("matrix")}>Matrix</button>
          <button className={viewMode === "pairs" ? "active" : ""} type="button" onClick={() => setViewMode("pairs")}>Top pairs</button>
        </div>
      </div>
      {viewMode === "matrix" ? <CorrelationMatrix correlations={correlations} /> : (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 42, top: 12, bottom: 6 }}>
          <defs>
            <linearGradient id="corrPositive" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
            <linearGradient id="corrNegative" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stopColor="#fca5a5" />
              <stop offset="100%" stopColor="#c2412d" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f3f2f1" horizontal={false} />
          <ReferenceLine x={0} stroke="#8a8886" strokeWidth={1.5} />
          <XAxis type="number" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tick={{ fontSize: 11, fill: "#605e5c" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="shortName" width={172} tick={<PowerBiTick />} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip label="Correlation" />} cursor={{ fill: "rgba(0, 120, 212, 0.06)" }} />
          <Bar dataKey="value" radius={[5, 5, 5, 5]} barSize={18}>
            {data.map((entry) => <Cell key={entry.name} fill={entry.value >= 0 ? "url(#corrPositive)" : "url(#corrNegative)"} />)}
            <LabelList dataKey="value" position="right" formatter={(value) => Number(value).toFixed(2)} className="chart-label" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}

function CorrelationMatrix({ correlations }) {
  const { columns, lookup } = useMemo(() => buildCorrelationMatrix(correlations), [correlations]);
  if (columns.length < 2) return <div className="empty-state chart-empty">Not enough numeric columns for a matrix.</div>;
  return (
    <div className="correlation-matrix-wrap">
      <div
        className="correlation-matrix"
        style={{ "--matrix-size": columns.length }}
        role="table"
        aria-label="Correlation matrix"
      >
        <span className="matrix-corner" />
        {columns.map((column) => (
          <span className="matrix-axis x-axis" key={`x-${column}`} title={column}>{compactLabel(column, 10)}</span>
        ))}
        {columns.map((row) => (
          <React.Fragment key={row}>
            <span className="matrix-axis y-axis" title={row}>{compactLabel(row, 12)}</span>
            {columns.map((column) => {
              const value = row === column ? 1 : lookup.get(matrixKey(row, column));
              const displayValue = value === undefined ? null : Number(value);
              return (
                <span
                  className="matrix-cell"
                  key={`${row}-${column}`}
                  style={{ background: correlationColor(displayValue) }}
                  title={`${row} vs ${column}: ${displayValue === null ? "N/A" : displayValue.toFixed(3)}`}
                >
                  {displayValue === null ? "" : displayValue.toFixed(2)}
                </span>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function TopValuesChart({ column }) {
  if (!column?.top_values?.length) return <div className="empty-state chart-empty">No categorical top values available.</div>;
  const data = column.top_values.map((item) => ({ name: String(item.value), shortName: compactLabel(String(item.value), 12), count: item.count }));
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return (
    <div className="chart-box polished-chart">
      <div className="chart-summary">
        <span>Top category</span>
        <strong title={data[0]?.name}>{data[0]?.name}</strong>
        <b>{data[0]?.count} rows</b>
      </div>
      <div className="chart-legend">
        <span><i className="category" /> count</span>
        <span>{total} rows in top values</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ left: 0, right: 18, top: 24, bottom: 6 }}>
          <defs>
            <linearGradient id="topValuesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a085" />
              <stop offset="100%" stopColor="#107c63" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f3f2f1" vertical={false} />
          <XAxis dataKey="shortName" tick={{ fontSize: 11, fill: "#605e5c" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#605e5c" }} axisLine={false} tickLine={false} width={34} />
          <Tooltip content={<ChartTooltip label="Count" />} cursor={{ fill: "rgba(16, 124, 16, 0.06)" }} />
          <Bar dataKey="count" fill="url(#topValuesFill)" radius={[5, 5, 0, 0]} maxBarSize={54}>
            <LabelList dataKey="count" position="top" className="chart-label" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div className="chart-tooltip">
      <span>{point.payload.name}</span>
      <strong>{label}: {point.value}</strong>
    </div>
  );
}

function PowerBiTick({ x, y, payload }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={4} textAnchor="end" fill="#605e5c" fontSize={11}>
        {payload.value}
      </text>
    </g>
  );
}

function compactPairName(left, right) {
  return `${compactLabel(left, 16)} / ${compactLabel(right, 16)}`;
}

function compactLabel(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function buildCorrelationMatrix(correlations) {
  const scores = new Map();
  const lookup = new Map();

  correlations.forEach((item) => {
    const left = item.left_column;
    const right = item.right_column;
    const value = Number(item.coefficient);
    if (!left || !right || !Number.isFinite(value)) return;

    scores.set(left, (scores.get(left) || 0) + Math.abs(value));
    scores.set(right, (scores.get(right) || 0) + Math.abs(value));
    lookup.set(matrixKey(left, right), value);
    lookup.set(matrixKey(right, left), value);
  });

  const columns = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name);

  return { columns, lookup };
}

function matrixKey(left, right) {
  return `${left}__${right}`;
}

function correlationColor(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "#f8fafc";
  const magnitude = Math.min(1, Math.abs(value));
  const alpha = 0.12 + magnitude * 0.78;
  if (value >= 0) return `rgba(37, 99, 235, ${alpha})`;
  return `rgba(194, 65, 45, ${alpha})`;
}
