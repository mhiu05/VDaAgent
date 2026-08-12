import React from "react";
import { Fingerprint, Hash, Sigma } from "lucide-react";
import { SeverityBadge } from "../../shared/components.jsx";
import { TopValuesChart } from "./TopValuesChart.jsx";
import { formatMaybeNumber, formatPercentValue, getColumnKind, isCategoricalLike } from "../utils/reportMetrics.js";

export function ColumnDetailPanel({ column, findings }) {
  if (!column) {
    return (
      <section className="panel column-detail-panel">
        <div className="report-empty-state">Select a column to inspect details.</div>
      </section>
    );
  }

  const columnFindings = findings.filter((item) => item.column === column.name);
  const categorical = isCategoricalLike(column);

  return (
    <section className="panel column-detail-panel">
      <div className="report-card-title split">
        <div>
          <h3>Column detail</h3>
          <span title={column.name}>{column.name}</span>
        </div>
        <span className="type-pill">{column.data_type}</span>
      </div>
      <div className="column-metric-grid">
        <MiniMetric icon={Hash} label="Null ratio" value={formatPercentValue(column.null_ratio)} />
        <MiniMetric icon={Hash} label="Distinct ratio" value={formatPercentValue(column.distinct_ratio)} />
        <MiniMetric icon={Sigma} label="Distinct count" value={formatMaybeNumber(column.distinct_count)} />
        <MiniMetric icon={Fingerprint} label="Outliers" value={formatMaybeNumber(column.outlier?.outlier_count)} />
      </div>
      <section className="detail-section">
        <h4>Statistics</h4>
        <div className="detail-kv">
          <span>Min</span><b>{formatMaybeNumber(column.min)}</b>
          <span>Max</span><b>{formatMaybeNumber(column.max)}</b>
          <span>Average</span><b>{formatMaybeNumber(column.avg)}</b>
          <span>Stddev</span><b>{formatMaybeNumber(column.stddev)}</b>
          <span>P25</span><b>{formatMaybeNumber(column.p25)}</b>
          <span>Median</span><b>{formatMaybeNumber(column.median)}</b>
          <span>P75</span><b>{formatMaybeNumber(column.p75)}</b>
        </div>
      </section>
      <section className="detail-section">
        <h4>Distribution</h4>
        {categorical ? (
          <TopValuesChart column={column} height={190} />
        ) : (
          <div className="chart-empty small">
            {getColumnKind(column) === "numeric"
              ? "Histogram bins are not returned by the backend yet."
              : "No distribution visualization is available for this datatype."}
          </div>
        )}
      </section>
      <section className="detail-section">
        <h4>Sample values</h4>
        <div className="sample-chip-list">
          {(column.sample_values || []).length
            ? column.sample_values.map((value, index) => <span key={`${value}-${index}`} title={String(value)}>{String(value)}</span>)
            : <span>No sample values returned.</span>}
        </div>
      </section>
      <section className="detail-section">
        <h4>Patterns and PII</h4>
        <PatternList column={column} />
      </section>
      <section className="detail-section">
        <h4>Findings</h4>
        {columnFindings.length ? <FindingsList findings={columnFindings} /> : <p className="muted">No findings returned for this column.</p>}
      </section>
    </section>
  );
}

function MiniMetric({ icon: Icon, label, value }) {
  return (
    <div className="mini-metric">
      <span><Icon size={14} /> {label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function PatternList({ column }) {
  const patterns = column.regex_patterns || column.patterns || [];
  const pii = column.pii_detection || column.pii_candidates || [];
  const outlier = column.outlier;
  if (!patterns.length && !pii.length && !outlier) {
    return <p className="muted">No pattern, PII, or outlier metadata returned.</p>;
  }
  return (
    <div className="pattern-list">
      {patterns.map((pattern, index) => (
        <span key={`pattern-${index}`}>{pattern.name || pattern.pattern || "pattern"}: {formatConfidence(pattern.confidence)}</span>
      ))}
      {pii.map((item, index) => (
        <span key={`pii-${index}`}>PII {item.pii_type || item.type || "candidate"}: {formatConfidence(item.confidence)}</span>
      ))}
      {outlier ? <span>Outlier: {formatMaybeNumber(outlier.outlier_count)} rows, {formatPercentValue(outlier.outlier_ratio)}</span> : null}
    </div>
  );
}

function FindingsList({ findings }) {
  return (
    <div className="finding-list compact">
      {findings.map((finding, index) => (
        <div className={`finding ${finding.severity}`} key={`${finding.column}-${index}`}>
          <SeverityBadge severity={finding.severity || "info"} />
          <p>{finding.message}</p>
        </div>
      ))}
    </div>
  );
}

function formatConfidence(value) {
  if (value === undefined || value === null) return "confidence n/a";
  return `${(Number(value) * 100).toFixed(0)}%`;
}
