import React, { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { SeverityBadge } from "../../shared/components.jsx";

export function FindingsPanel({ findings, columns }) {
  const [severity, setSeverity] = useState("all");
  const [columnName, setColumnName] = useState("all");
  const [type, setType] = useState("all");
  const issueTypes = useMemo(() => Array.from(new Set((findings || []).map(deriveFindingType))).sort(), [findings]);
  const filtered = useMemo(() => (findings || []).filter((finding) => (
    (severity === "all" || finding.severity === severity)
    && (columnName === "all" || finding.column === columnName)
    && (type === "all" || deriveFindingType(finding) === type)
  )), [findings, severity, columnName, type]);

  return (
    <section className="panel report-section-card findings-panel">
      <div className="report-card-title split">
        <div>
          <h3>Findings</h3>
          <span>{filtered.length} of {(findings || []).length} findings</span>
        </div>
        <Filter size={16} />
      </div>
      <div className="report-table-toolbar compact-toolbar">
        <label className="compact-select">
          <span>Severity</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label className="compact-select">
          <span>Column</span>
          <select value={columnName} onChange={(event) => setColumnName(event.target.value)}>
            <option value="all">All columns</option>
            {(columns || []).map((column) => <option value={column.name} key={column.name}>{column.name}</option>)}
          </select>
        </label>
        <label className="compact-select">
          <span>Type</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            {issueTypes.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {filtered.length ? (
        <div className="finding-list report-findings-list simple-findings-list">
          {filtered.map((finding, index) => (
            <article className={`finding ${finding.severity || "info"}`} key={`${finding.column || "dataset"}-${index}`}>
              <div className="finding-heading">
                <SeverityBadge severity={finding.severity || "info"} />
                <span title={finding.column || "Dataset-level"}>{finding.column || "Dataset-level"}</span>
              </div>
              <p>{finding.message}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="report-empty-state">No findings match the current filters.</div>
      )}
    </section>
  );
}

function deriveFindingType(finding) {
  const message = String(finding.message || "").toLowerCase();
  if (message.includes("pii")) return "PII";
  if (message.includes("identifier") || message.includes("key")) return "Identifier";
  if (message.includes("null") || message.includes("missing")) return "Missing data";
  if (message.includes("outlier")) return "Outlier";
  if (message.includes("cardinality")) return "Cardinality";
  if (message.includes("correlation")) return "Correlation";
  return "General";
}

