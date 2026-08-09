import React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PanelTitle({ title, aside }) {
  return (
    <div className="panel-title">
      <h3>{title}</h3>
      {aside ? <span className="muted">{aside}</span> : null}
    </div>
  );
}

export function SeverityBadge({ severity }) {
  const Icon = severity === "critical" ? XCircle : severity === "warning" ? AlertTriangle : Info;
  const tooltip = severityDescription(severity);
  return (
    <span className={`severity-badge ${severity}`} title={tooltip} aria-label={tooltip}>
      <Icon size={14} />
      {severity}
    </span>
  );
}

function severityDescription(severity) {
  if (severity === "critical") return "Critical: profiling found a blocking or high-risk data quality issue.";
  if (severity === "warning") return "Warning: profiling found a data quality risk that should be reviewed.";
  return "Info: profiling found an observation or candidate signal, not necessarily a problem.";
}

export function TextField({ label, type = "text", value, onChange, disabled = false, placeholder = "" }) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function EmptyTable({ columns, message }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          <tr>
            <td colSpan={columns} className="empty-cell">{message}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Toast({ toast }) {
  return (
    <div className={`toast ${toast.type}`}>
      {toast.type === "critical" ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
      {toast.message}
    </div>
  );
}
