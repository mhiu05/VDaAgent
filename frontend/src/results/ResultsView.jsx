import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  Clock3,
  FileWarning,
  Search,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { ColumnDetailPanel } from "./components/ColumnDetailPanel.jsx";
import { ColumnSummaryTable } from "./components/ColumnSummaryTable.jsx";
import { FindingsPanel } from "./components/FindingsPanel.jsx";
import { ReportEmptyState } from "./components/ReportEmptyState.jsx";
import { useReportSelection } from "./hooks/useReportSelection.js";
import { requestJson } from "../services/api.js";
import {
  buildQualityOverview,
  formatCompact,
  formatDateTime,
  formatMaybeNumber,
  formatPercentValue,
  getSourceIcon,
  getSourceName,
  getSourceType,
  groupFindingsByColumn,
} from "./utils/reportMetrics.js";

const REPORT_TABS = [
  ["overview", "Overview", BarChart3, "overview"],
  ["columns", "Column Summary", Table2, "columns"],
  ["findings", "Findings", FileWarning, "findings"],
  ["hitl", "HITL", ShieldCheck, "hitl"],
];

export function ResultsView({
  result,
  resultSources,
  selectedProfileIndex,
  setSelectedProfileIndex,
  quality,
  traceEvents = [],
  hitlRecords = [],
  decideHitl,
  savedReports = [],
  openStoredReport,
  apiBase,
  userId = "anonymous",
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const selection = useReportSelection(result, resultSources, selectedProfileIndex, setSelectedProfileIndex);
  const activeResult = selection.activeResult;
  const columns = activeResult?.columns || [];
  const findings = activeResult?.findings || [];
  const activeQuality = activeResult?.quality_summary || quality || {};

  const findingsByColumn = useMemo(() => groupFindingsByColumn(findings), [findings]);
  const selectedColumn = useMemo(() => {
    const selected = columns.find((column) => column.name === selection.selectedColumnName);
    return selected || columns[0] || null;
  }, [columns, selection.selectedColumnName]);
  const overview = useMemo(() => buildQualityOverview(activeResult, columns, findings, activeQuality), [activeResult, columns, findings, activeQuality]);
  const sourceScopedHitl = useMemo(() => filterHitlForResult(hitlRecords, activeResult), [hitlRecords, activeResult]);
  const tabCounts = useMemo(() => ({
    overview: activeResult ? 1 : 0,
    columns: columns.length,
    findings: findings.length,
    hitl: sourceScopedHitl.filter((record) => record.status === "pending").length || sourceScopedHitl.length,
  }), [activeResult, columns.length, findings.length, sourceScopedHitl]);

  if (!activeResult) {
    return (
      <section className="report-page analytics-report-page">
        <SavedReportsStrip reports={savedReports} openStoredReport={openStoredReport} />
        <ReportEmptyState />
      </section>
    );
  }

  return (
    <section className="report-page analytics-report-page">
      <SavedReportsStrip reports={savedReports} openStoredReport={openStoredReport} />
      <ReportHero
        result={activeResult}
        sources={selection.sources}
        selectedIndex={selection.selectedProfileIndex}
        setSelectedIndex={selection.setSelectedProfileIndex}
        hitlRecords={sourceScopedHitl}
      />
      <ReportTabs activeTab={activeTab} setActiveTab={setActiveTab} counts={tabCounts} />

      {activeTab === "overview" && (
        <OverviewTab
          result={activeResult}
          overview={overview}
          columns={columns}
          findings={findings}
          findingsByColumn={findingsByColumn}
          hitlRecords={sourceScopedHitl}
          apiBase={apiBase}
          userId={userId}
          setSelectedColumnName={(name) => {
            selection.setSelectedColumnName(name);
            setActiveTab("columns");
          }}
        />
      )}
      {activeTab === "columns" && (
        <ColumnsTab
          columns={columns}
          findings={findings}
          findingsByColumn={findingsByColumn}
          selectedColumn={selectedColumn}
          selection={selection}
        />
      )}
      {activeTab === "findings" && <FindingsPanel findings={findings} columns={columns} />}
      {activeTab === "hitl" && <HitlTab records={sourceScopedHitl} decideHitl={decideHitl} />}
    </section>
  );
}

function ReportHero({ result, sources, selectedIndex, setSelectedIndex, hitlRecords }) {
  const metadata = result.profile_metadata || {};
  const sourceName = getSourceName(result);
  const sourceType = getSourceType(result);
  const SourceIcon = getSourceIcon(sourceType, sourceName);
  const warningCount = result.quality_summary?.warning_count || 0;
  const criticalCount = result.quality_summary?.critical_count || 0;
  const status = result.agent_run?.status || result.agent_status?.status || "completed";

  return (
    <header className="report-hero panel">
      <div className="report-hero-main">
        <span className="report-source-icon"><SourceIcon size={20} /></span>
        <div className="report-title-copy">
          <span className="fabric-kicker">Data profiling report</span>
          <h2 title={sourceName}>{sourceName}</h2>
          <div className="report-meta-row">
            <span>{sourceType}</span>
            {metadata.engine ? <span>{metadata.engine}</span> : null}
            {metadata.profile_mode ? <span>{metadata.profile_mode}</span> : null}
            {metadata.sampled ? <span>{formatCompact(metadata.sample_size || 0)} sample rows</span> : null}
            {metadata.profiling_version ? <span>v{metadata.profiling_version}</span> : null}
            {metadata.generated_at ? <span><Clock3 size={12} /> {formatDateTime(metadata.generated_at)}</span> : null}
          </div>
        </div>
      </div>

      <div className="report-hero-controls">
        {sources.length > 1 ? (
          <label className="compact-select report-source-select">
            <span>Dataset</span>
            <select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
              {sources.map((source, index) => (
                <option key={`${getSourceName(source)}-${index}`} value={index}>{getSourceName(source)}</option>
              ))}
            </select>
          </label>
        ) : null}
        <StatusPill status={status} />
      </div>

      <div className="report-hero-metrics">
        <HeroMetric label="Rows" value={formatCompact(result.dataset_summary?.row_count)} />
        <HeroMetric label="Columns" value={formatCompact(result.dataset_summary?.column_count)} />
        <HeroMetric label="Warnings" value={warningCount} tone={warningCount ? "warning" : "default"} />
        <HeroMetric label="Critical" value={criticalCount} tone={criticalCount ? "critical" : "default"} />
        <HeroMetric label="Generated" value={metadata.generated_at ? formatDateTime(metadata.generated_at) : "-"} />
      </div>
    </header>
  );
}

function ReportTabs({ activeTab, setActiveTab, counts }) {
  return (
    <nav className="report-tabs" aria-label="Report sections">
      {REPORT_TABS.map(([id, label, Icon, countKey]) => (
        <button key={id} className={activeTab === id ? "active" : ""} type="button" onClick={() => setActiveTab(id)}>
          <Icon size={15} />
          <span>{label}</span>
          {countKey && counts?.[countKey] ? <b>{counts[countKey]}</b> : null}
        </button>
      ))}
    </nav>
  );
}

function OverviewTab({ result, apiBase, userId }) {
  const critical = result.quality_summary?.critical_count || 0;
  const warning = result.quality_summary?.warning_count || 0;
  const metadata = result.profile_metadata || {};
  const datasetRows = [
    ["Source name", getSourceName(result)],
    ["Rows", formatMaybeNumber(result.dataset_summary?.row_count)],
    ["Columns", formatMaybeNumber(result.dataset_summary?.column_count)],
    ["Warnings", warning, "warning"],
    ["Critical", critical, "critical"],
    ["Generated time", metadata.generated_at ? formatDateTime(metadata.generated_at) : "-"],
  ];

  return (
    <div className="overview-table-grid simple-overview-grid">
      <section className="panel report-section-card overview-table-panel overview-wide">
        <ReportSectionHeader title="Dataset overview" aside={getSourceName(result)} />
        <KeyValueTable rows={datasetRows} />
      </section>
      <ReportCommentsPanel result={result} apiBase={apiBase} userId={userId} />
    </div>
  );
}

function ReportCommentsPanel({ result, apiBase, userId }) {
  const runId = result?.agent_run?.run_id;
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const [column, setColumn] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadComments() {
      if (!apiBase || !runId) {
        setComments([]);
        return;
      }
      try {
        const data = await requestJson(`${apiBase}/profile/reports/${runId}/comments?user_id=${encodeURIComponent(userId)}&limit=100`);
        if (!cancelled) setComments(data || []);
      } catch {
        if (!cancelled) setComments([]);
      }
    }
    loadComments();
    return () => {
      cancelled = true;
    };
  }, [apiBase, runId, userId]);

  async function submitComment(event) {
    event.preventDefault();
    if (!comment.trim() || !apiBase || !runId) return;
    setLoading(true);
    try {
      const saved = await requestJson(`${apiBase}/profile/reports/${runId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          author_name: userId,
          comment: comment.trim(),
          column: column.trim() || null,
        }),
      });
      setComments((current) => [saved, ...current]);
      setComment("");
      setColumn("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel report-section-card overview-table-panel overview-wide">
      <ReportSectionHeader title="Report comments" aside={`${comments.length} comment(s)`} />
      <form className="report-comment-form" onSubmit={submitComment}>
        <input
          value={column}
          onChange={(event) => setColumn(event.target.value)}
          placeholder="Optional column"
          aria-label="Optional column"
        />
        <input
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Add a note for this report..."
          aria-label="Report comment"
        />
        <button className="primary-button compact-action" type="submit" disabled={loading || !comment.trim()}>
          {loading ? "Saving..." : "Add comment"}
        </button>
      </form>
      {comments.length ? (
        <div className="report-comment-list">
          {comments.map((item) => (
            <article key={item.id} className="report-comment-item">
              <div>
                <strong>{item.author_name}</strong>
                {item.column ? <span>{item.column}</span> : null}
              </div>
              <p>{item.comment}</p>
              <small>{formatDateTime(item.created_at)}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="report-empty-state compact flat-empty">No comments for this report yet.</div>
      )}
    </section>
  );
}

function ColumnsTab({ columns, findings, findingsByColumn, selectedColumn, selection }) {
  return (
    <div className="report-main-grid report-tab-columns">
      <ColumnSummaryTable
        columns={columns}
        findingsByColumn={findingsByColumn}
        selectedColumn={selectedColumn}
        setSelectedColumnName={selection.setSelectedColumnName}
        filters={selection.filters}
        setFilters={selection.setFilters}
        sort={selection.sort}
        setSort={selection.setSort}
      />
      <ColumnDetailPanel column={selectedColumn} findings={findings} />
    </div>
  );
}

function HitlTab({ records = [], decideHitl }) {
  const [status, setStatus] = useState("all");
  const filteredRecords = useMemo(() => {
    const scoped = status === "all" ? records : records.filter((record) => record.status === status);
    return scoped.slice().sort((left, right) => String(right.reviewed_at || right.id).localeCompare(String(left.reviewed_at || left.id)));
  }, [records, status]);
  const counts = useMemo(() => ({
    pending: records.filter((record) => record.status === "pending").length,
    approved: records.filter((record) => record.status === "approved").length,
    rejected: records.filter((record) => record.status === "rejected").length,
  }), [records]);

  return (
    <section className="panel report-section-card overview-table-panel hitl-report-panel">
      <ReportSectionHeader
        title="HITL review"
        aside={`${counts.pending} pending / ${records.length} total`}
      />
      <div className="hitl-report-toolbar">
        <div className="hitl-status-strip">
          <span className={counts.pending ? "warning" : ""}>Pending <b>{counts.pending}</b></span>
          <span>Approved <b>{counts.approved}</b></span>
          <span>Rejected <b>{counts.rejected}</b></span>
        </div>
        <label className="compact-select">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>
      {filteredRecords.length ? (
        <div className="table-wrap hitl-report-table-wrap">
          <table className="fabric-report-table hitl-report-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Type</th>
                <th>Evidence</th>
                <th>Column</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => {
                const pending = record.status === "pending";
                return (
                  <tr key={record.id}>
                    <td><span className={`hitl-status ${record.status}`}>{record.status}</span></td>
                    <td className="truncate" title={record.type}>{humanize(record.type)}</td>
                    <td className="truncate" title={record.evidence}>{record.evidence || "-"}</td>
                    <td className="truncate" title={record.columns?.join(", ") || record.table || record.source}>
                      {record.columns?.length ? record.columns.join(", ") : record.table || record.source || "-"}
                    </td>
                    <td>
                      {pending ? (
                        <span className="hitl-table-actions">
                          <button className="secondary-button compact-action" type="button" onClick={() => decideHitl?.(record.id, "reject")}>Reject</button>
                          <button className="primary-button compact-action" type="button" onClick={() => decideHitl?.(record.id, "approve")}>Confirm</button>
                        </span>
                      ) : (
                        <span className="muted-table-value">{record.reviewer || "reviewed"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="report-empty-state compact flat-empty">No HITL records for this report.</div>
      )}
    </section>
  );
}

function SavedReportsStrip({ reports, openStoredReport }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filteredReports = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return reports.slice(0, 20);
    return reports.filter((report) => {
      const haystack = [
        report.source_name,
        report.source_type,
        report.run_id,
        report.generated_at,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(text);
    }).slice(0, 20);
  }, [reports, query]);

  if (!reports?.length) return null;

  function selectReport(report) {
    setQuery(report.source_name || report.run_id || "");
    setOpen(false);
    openStoredReport?.(report.run_id);
  }

  return (
    <section className="panel report-history-panel">
      <div className="panel-title">
        <h3>Saved reports</h3>
        <span className="muted">{reports.length} report{reports.length === 1 ? "" : "s"}</span>
      </div>
      <div className="report-combobox">
        <label className="report-combobox-input">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search saved reports..."
            role="combobox"
            aria-expanded={open}
            aria-controls="saved-report-options"
          />
          <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Toggle report list">
            <ChevronDown size={16} />
          </button>
        </label>
        {open ? (
          <div className="report-combobox-menu" id="saved-report-options" role="listbox">
            {filteredReports.length ? filteredReports.map((report) => (
              <button
                key={report.run_id}
                className="report-combobox-option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectReport(report)}
                role="option"
              >
                <span className="report-option-main">
                  <strong title={report.source_name}>{report.source_name || "Unnamed report"}</strong>
                  <small title={report.run_id}>{report.run_id}</small>
                </span>
                <span className="report-option-meta">
                  <b>{Number(report.row_count || 0).toLocaleString("en-US")}</b> rows
                  <i>{report.column_count || 0} cols</i>
                  <i className={Number(report.warning_count || 0) ? "warning" : ""}>{report.warning_count || 0} warnings</i>
                  <i className={Number(report.critical_count || 0) ? "critical" : ""}>{report.critical_count || 0} critical</i>
                </span>
              </button>
            )) : (
              <div className="report-combobox-empty">No reports match this search.</div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HeroMetric({ label, value, tone = "default" }) {
  return (
    <div className={`hero-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function ReportSectionHeader({ title, aside }) {
  return (
    <div className="report-section-header">
      <h3>{title}</h3>
      {aside ? <span title={aside}>{aside}</span> : null}
    </div>
  );
}

function KeyValueTable({ rows }) {
  return (
    <table className="fabric-report-table compact key-value-table">
      <tbody>
        {rows.filter(([, value]) => hasValue(value)).map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td className="truncate" title={String(value)}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusPill({ status }) {
  return <span className={`report-status-pill ${status}`}>{status}</span>;
}

function ColumnHealthBadge({ findings }) {
  const rank = severityRank(findings);
  if (rank >= 3) return <span className="health-badge critical">critical</span>;
  if (rank >= 2) return <span className="health-badge warning">warning</span>;
  if (rank >= 1) return <span className="health-badge info">info</span>;
  return <span className="health-badge ok">OK</span>;
}

function KeyValueGrid({ data }) {
  const entries = Object.entries(data || {}).filter(([, value]) => hasValue(value));
  if (!entries.length) return <div className="report-empty-state compact">No metadata returned.</div>;
  return (
    <div className="detail-kv run-detail-kv">
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <span>{key.replaceAll("_", " ")}</span>
          <b>{formatValue(value)}</b>
        </React.Fragment>
      ))}
    </div>
  );
}

function collectPiiColumns(columns) {
  return columns.filter((column) => (column.pii_detection || column.pii_candidates || []).length).map((column) => column.name);
}

function filterHitlForResult(records, result) {
  const sourceName = getSourceName(result);
  return (records || []).filter((record) => !sourceName || record.source === sourceName || record.table === sourceName);
}

function severityRank(findings) {
  if (!findings?.length) return 0;
  if (findings.some((finding) => finding.severity === "critical")) return 3;
  if (findings.some((finding) => finding.severity === "warning")) return 2;
  return 1;
}

function hasValue(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && !value.length) return false;
  return !(typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatMaybeNumber(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humanize(value = "Review") {
  return String(value).replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
