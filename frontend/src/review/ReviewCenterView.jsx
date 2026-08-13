import React, { useMemo, useState } from "react";
import { CheckCircle2, Clock3, MessageSquareText, ShieldCheck, XCircle } from "lucide-react";

export function ReviewCenterView({ hitlRecords = [], agentRuns = [], decideHitl }) {
  const [statusFilter, setStatusFilter] = useState("pending");
  const records = useMemo(() => {
    const filtered = statusFilter === "all"
      ? hitlRecords
      : hitlRecords.filter((record) => record.status === statusFilter);
    return filtered.sort((left, right) => String(right.reviewed_at || right.id).localeCompare(String(left.reviewed_at || left.id)));
  }, [hitlRecords, statusFilter]);
  const counts = useMemo(() => ({
    pending: hitlRecords.filter((record) => record.status === "pending").length,
    approved: hitlRecords.filter((record) => record.status === "approved").length,
    rejected: hitlRecords.filter((record) => record.status === "rejected").length,
  }), [hitlRecords]);
  const runById = useMemo(() => new Map(agentRuns.map((run) => [run.run_id, run])), [agentRuns]);

  return (
    <section className="review-page">
      <header className="view-header">
        <span className="fabric-kicker">Human-in-the-loop</span>
        <h2>Review Center</h2>
        <p>Review sensitive Agent proposals before they become trusted metadata.</p>
      </header>

      <div className="review-summary-grid">
        <ReviewMetric icon={Clock3} label="Pending" value={counts.pending} tone={counts.pending ? "warning" : "default"} />
        <ReviewMetric icon={CheckCircle2} label="Approved" value={counts.approved} tone="success" />
        <ReviewMetric icon={XCircle} label="Rejected" value={counts.rejected} tone="danger" />
        <ReviewMetric icon={MessageSquareText} label="Agent runs" value={agentRuns.length} />
      </div>

      <section className="panel review-list-panel">
        <div className="panel-title">
          <h3>Review items</h3>
          <label className="compact-select">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
        {records.length ? (
          <div className="review-record-list">
            {records.map((record) => (
              <ReviewRecord
                key={record.id}
                record={record}
                run={runById.get(record.run_id)}
                decideHitl={decideHitl}
              />
            ))}
          </div>
        ) : (
          <div className="review-empty">
            <ShieldCheck size={24} />
            <strong>No matching items</strong>
            <span>PII, key, relationship, or sensitive-rule proposals will appear here.</span>
          </div>
        )}
      </section>
    </section>
  );
}

function ReviewMetric({ icon: Icon, label, value, tone = "default" }) {
  return (
    <article className={`review-metric ${tone}`}>
      <span><Icon size={18} /></span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

function ReviewRecord({ record, run, decideHitl }) {
  const pending = record.status === "pending";
  return (
    <article className={`review-record ${record.status}`}>
      <div className="review-record-main">
        <div className="review-record-title">
          <span className={`review-status-dot ${record.status}`} />
          <strong>{humanize(record.type)}</strong>
          <span className={`severity-badge ${record.severity}`}>{record.severity}</span>
        </div>
        <p>{record.evidence}</p>
        <div className="review-record-meta">
          <span>{record.source}</span>
          {record.table ? <span>{record.table}</span> : null}
          {record.columns?.length ? <span>{record.columns.join(", ")}</span> : null}
          {run?.started_at ? <span>{new Date(run.started_at).toLocaleString("en-US")}</span> : null}
        </div>
      </div>
      <div className="review-record-action">
        <small>{record.proposed_action}</small>
        {pending ? (
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => decideHitl?.(record.id, "reject")}>Reject</button>
            <button className="primary-button" type="button" onClick={() => decideHitl?.(record.id, "approve")}>Confirm</button>
          </div>
        ) : (
          <span className="muted-text">Reviewed by {record.reviewer || "analyst"}</span>
        )}
      </div>
    </article>
  );
}

function humanize(value = "Review") {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
