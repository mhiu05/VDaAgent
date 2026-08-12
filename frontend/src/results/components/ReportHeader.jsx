import React from "react";
import { Activity, Clock3, ShieldCheck } from "lucide-react";
import { formatCompact, formatDateTime, getSourceIcon, getSourceName, getSourceType } from "../utils/reportMetrics.js";

export function ReportHeader({ result, sources, selectedIndex, setSelectedIndex, traceEvents = [], hitlRecords = [] }) {
  if (!result) return null;
  const metadata = result.profile_metadata || {};
  const sourceName = getSourceName(result);
  const sourceType = getSourceType(result);
  const SourceIcon = getSourceIcon(sourceType, sourceName);
  const sampled = metadata.sampled === true || metadata.profile_mode === "sample";
  const governance = result.governance || {};
  const runId = result.agent_run?.run_id;

  return (
    <section className="report-header panel">
      <div className="report-title-row">
        <span className="report-source-icon"><SourceIcon size={19} /></span>
        <div className="report-title-copy">
          <span className="fabric-kicker">Data quality report</span>
          <h2 title={sourceName}>{sourceName}</h2>
          <div className="report-meta-row">
            <span>{sourceType}</span>
            <span>{metadata.engine || "unknown engine"}</span>
            <span>{sampled ? "sampled" : metadata.profile_mode || "full data"}</span>
            {metadata.sample_size ? <span>{formatCompact(metadata.sample_size)} sample rows</span> : null}
            {metadata.profiling_version ? <span>v{metadata.profiling_version}</span> : null}
          </div>
        </div>
      </div>
      <div className="report-header-actions">
        <span className="generated-at">
          <Clock3 size={14} />
          {metadata.generated_at ? formatDateTime(metadata.generated_at) : "Generated in session"}
        </span>
        {sources.length > 1 ? (
          <label className="compact-select">
            <span>Dataset</span>
            <select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
              {sources.map((source, index) => (
                <option key={`${getSourceName(source)}-${index}`} value={index}>{getSourceName(source)}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {result.agent_status || runId ? (
        <div className="agent-governance-strip">
          <span><Activity size={14} /> Run {runId ? runId.slice(0, 8) : "active"}</span>
          <span><ShieldCheck size={14} /> {governance.masked_values_count || 0} masked values</span>
          <span>{governance.hitl_pending_count ?? hitlRecords.length} HITL pending</span>
          <span>{traceEvents.length} trace events</span>
        </div>
      ) : null}
      {result.agent_status?.safe_summary ? (
        <p className="agent-safe-summary">{result.agent_status.safe_summary}</p>
      ) : null}
    </section>
  );
}
