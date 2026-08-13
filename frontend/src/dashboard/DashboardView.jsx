import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Database,
  Layers3,
  MessageSquareText,
  Rows3,
  ShieldCheck,
} from "lucide-react";

export function DashboardView({ result, history = [], profileReports = [], agentRuns = [], hitlRecords = [], onOpenReports, onOpenWorkspace }) {
  const hasProfile = Boolean(result?.source && result?.dataset_summary);
  const pendingRecords = hitlRecords.filter((item) => item.status === "pending");
  const profileRuns = agentRuns.filter((run) => run.source_type !== "chat");
  const recentActivity = agentRuns.slice(0, 6);
  const datasetCount = profileReports.length || new Set(profileRuns.map((run) => run.source_name)).size;
  const rowsProfiled = profileReports.length
    ? profileReports.reduce((total, report) => total + Number(report.row_count || 0), 0)
    : profileRuns.reduce((total, run) => total + Number(run.metrics?.rows_profiled || 0), 0);
  const warningCount = profileReports.length
    ? profileReports.reduce((total, report) => total + Number(report.warning_count || 0), 0)
    : profileRuns.reduce((total, run) => total + Number(run.metrics?.warnings_count || 0), 0);

  return (
    <section className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <span className="dashboard-eyebrow">Overview</span>
          <h2>Overview Dashboard</h2>
          <p>Monitor profiling activity, data quality status, and decisions that need review.</p>
        </div>
        {hasProfile ? (
          <button className="secondary-button dashboard-report-button" type="button" onClick={onOpenReports}>
            Open latest report <ArrowRight size={16} />
          </button>
        ) : null}
      </header>

      <div className="dashboard-kpi-grid" aria-label="Profiling operations overview">
        <DashboardMetric icon={Layers3} label="Profiled sources" value={datasetCount} detail={`${profileRuns.length} profiling run`} />
        <DashboardMetric icon={Rows3} label="Rows processed" value={formatNumber(rowsProfiled)} detail="Across saved runs" />
        <DashboardMetric icon={AlertTriangle} label="Warnings" value={formatNumber(warningCount)} detail="From profiling history" tone={warningCount ? "warning" : "default"} />
        <DashboardMetric icon={ShieldCheck} label="Pending review" value={pendingRecords.length} detail="HITL decisions" tone={pendingRecords.length ? "warning" : "success"} />
      </div>

      <div className="dashboard-content-grid">
        <section className="dashboard-panel dashboard-jobs-panel">
          <DashboardPanelHeader title="Recent profiling jobs" description="Latest datasets processed by the profiling workflow." aside={history.length ? `${history.length} job` : "No jobs yet"} />
          {profileRuns.length ? <RecentJobs runs={profileRuns} history={history} /> : (
            <CompactEmptyState
              icon={Database}
              title="No profiling runs yet"
              description="Go to Data Workspace to upload files or connect a cloud database."
              action="Open Data Workspace"
              onAction={onOpenWorkspace}
            />
          )}
        </section>

        <section className="dashboard-panel dashboard-activity-panel">
          <DashboardPanelHeader title="Agent activity" description="Profiling runs and assistant runs are tracked separately for audit." aside={`${profileRuns.length} profile run`} />
          {recentActivity.length ? <AgentActivity runs={recentActivity} /> : (
            <CompactEmptyState icon={Activity} title="No agent activity yet" description="Runs and trace status will appear when the Agent starts processing." />
          )}
        </section>
      </div>

      {pendingRecords.length ? <PendingReviews records={pendingRecords.slice(0, 4)} /> : null}
    </section>
  );
}

function DashboardMetric({ icon: Icon, label, value, detail, tone = "default" }) {
  return (
    <article className={`dashboard-kpi ${tone}`}>
      <div className="dashboard-kpi-icon"><Icon size={18} /></div>
      <div><span>{label}</span><strong>{value}</strong><small title={detail}>{detail}</small></div>
    </article>
  );
}

function DashboardPanelHeader({ title, description, aside }) {
  return (
    <div className="dashboard-panel-header">
      <div><h3>{title}</h3><p>{description}</p></div>
      <span>{aside}</span>
    </div>
  );
}

function RecentJobs({ runs, history }) {
  const historyBySource = new Map(history.map((job) => [job.sourceName, job]));
  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table">
        <thead><tr><th>Source</th><th>Rows</th><th>Columns</th><th>Time</th></tr></thead>
        <tbody>
          {runs.slice(0, 6).map((run) => {
            const localJob = historyBySource.get(run.source_name);
            return (
              <tr key={run.run_id}>
                <td><strong title={run.source_name}>{run.source_name}</strong></td>
                <td>{formatNumber(run.metrics?.rows_profiled ?? localJob?.rowCount)}</td>
                <td>{run.metrics?.columns_profiled ?? localJob?.columnCount ?? "-"}</td>
                <td><span className={`run-status ${run.status}`}>{translateStatus(run.status)}</span> {formatDate(run.started_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AgentActivity({ runs }) {
  return (
    <div className="agent-activity-list">
      {runs.map((run) => {
        const isChat = run.source_type === "chat";
        const Icon = isChat ? MessageSquareText : Activity;
        return (
          <div className="agent-activity-row" key={run.run_id}>
            <span className={`agent-activity-icon ${isChat ? "chat" : "profile"}`}><Icon size={15} /></span>
            <div className="agent-activity-copy">
              <strong>{isChat ? "Assistant conversation" : run.source_name}</strong>
              <span>{isChat ? "Chat run" : "Profiling run"} / {formatDate(run.started_at)}</span>
            </div>
            <span className={`run-status ${run.status}`}>{translateStatus(run.status)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PendingReviews({ records }) {
  return (
    <section className="dashboard-panel dashboard-review-panel">
      <DashboardPanelHeader title="Pending reviews" description="Agent proposals that need user confirmation before becoming trusted metadata." aside={`Showing ${records.length}`} />
      <div className="dashboard-review-list">
        {records.map((record) => (
          <div key={record.id}>
            <ShieldCheck size={16} /><strong>{humanize(record.type)}</strong>
            <span title={record.evidence}>{record.source} / {record.columns?.join(", ") || record.table || "Dataset"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompactEmptyState({ icon: Icon, title, description, action, onAction }) {
  return (
    <div className="dashboard-compact-empty">
      <Icon size={20} /><strong>{title}</strong><span>{description}</span>
      {action ? <button type="button" onClick={onAction}>{action} <ArrowRight size={14} /></button> : null}
    </div>
  );
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "-") return "-";
  return Number(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function humanize(value = "Review") {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function translateStatus(status = "") {
  const labels = {
    completed: "Completed",
    failed: "Failed",
    running: "Running",
    pending: "Pending",
    queued: "Queued",
    cancelled: "Cancelled",
    canceled: "Canceled",
  };
  return labels[status] || status || "-";
}
