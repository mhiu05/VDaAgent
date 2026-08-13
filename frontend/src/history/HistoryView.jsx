import React from "react";
import { BarChart3, Clock3, Database, MessageSquareText } from "lucide-react";

export function HistoryView({
  history = [],
  profileReports = [],
  conversations = [],
  agentRuns = [],
  openStoredReport,
  selectConversation,
  setActiveView,
}) {
  const chatRuns = agentRuns.filter((run) => run.source_type === "chat");

  function openConversation(id) {
    selectConversation?.(id);
    setActiveView?.("agent");
  }

  return (
    <section className="history-page">
      <header className="view-header">
        <span className="fabric-kicker">Audit history</span>
        <h2>History</h2>
        <p>Review saved reports, profiling runs, and Agent conversations.</p>
      </header>

      <div className="history-summary-grid">
        <HistoryMetric icon={BarChart3} label="Saved reports" value={profileReports.length} />
        <HistoryMetric icon={Database} label="Session jobs" value={history.length} />
        <HistoryMetric icon={MessageSquareText} label="Conversations" value={conversations.length} />
        <HistoryMetric icon={Clock3} label="Chat runs" value={chatRuns.length} />
      </div>

      <div className="history-grid">
        <section className="panel history-list-panel">
          <div className="panel-title">
            <h3>Profiling reports</h3>
            <span className="muted">{profileReports.length} report</span>
          </div>
          {profileReports.length ? (
            <div className="history-list">
              {profileReports.map((report) => (
                <button
                  className="history-row-card"
                  type="button"
                  key={report.run_id}
                  onClick={() => openStoredReport?.(report.run_id)}
                >
                  <div>
                    <h4 title={report.source_name}>{report.source_name}</h4>
                    <p>{report.source_type} / {formatDate(report.created_at)}</p>
                  </div>
                  <div className="history-row-meta">
                    <span>{formatNumber(report.row_count)} rows</span>
                    <span>{report.column_count} columns</span>
                    <span>{report.warning_count} warnings</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyHistory title="No saved reports yet" description="After a full profiling run, the report will be saved in the metadata database." />
          )}
        </section>

        <section className="panel history-list-panel">
          <div className="panel-title">
            <h3>Chat history</h3>
            <span className="muted">{conversations.length} conversation</span>
          </div>
          {conversations.length ? (
            <div className="history-list">
              {conversations.map((conversation) => (
                <button
                  className="history-row-card"
                  type="button"
                  key={conversation.id}
                  onClick={() => openConversation(conversation.id)}
                >
                  <div>
                    <h4 title={conversation.title}>{conversation.title}</h4>
                    <p>{formatDate(conversation.updated_at)}</p>
                  </div>
                  <div className="history-row-meta">
                    <span>{conversation.message_count || 0} messages</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyHistory title="No conversations yet" description="Questions sent to the Agent will be saved for audit and review." />
          )}
        </section>
      </div>
    </section>
  );
}

function HistoryMetric({ icon: Icon, label, value }) {
  return (
    <article className="history-metric">
      <span><Icon size={18} /></span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

function EmptyHistory({ title, description }) {
  return (
    <div className="history-empty">
      <Clock3 size={24} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function formatNumber(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("en-US");
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
