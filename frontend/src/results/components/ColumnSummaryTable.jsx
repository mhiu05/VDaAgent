import React, { useMemo } from "react";
import { AlertTriangle, ArrowDownAZ, CheckCircle2, Search, Table2 } from "lucide-react";
import { SeverityLegend } from "./SeverityLegend.jsx";
import { formatMaybeNumber, formatPercentValue, getWorstSeverity } from "../utils/reportMetrics.js";
import { useFilteredColumns } from "../hooks/useReportSelection.js";

export function ColumnSummaryTable({
  columns,
  findingsByColumn,
  selectedColumn,
  setSelectedColumnName,
  filters,
  setFilters,
  sort,
  setSort,
}) {
  const dataTypes = useMemo(() => Array.from(new Set((columns || []).map((column) => column.data_type).filter(Boolean))).sort(), [columns]);
  const visibleColumns = useFilteredColumns(columns, findingsByColumn, filters, sort);

  if (!columns?.length) {
    return <div className="report-empty-state">No column profiling result yet.</div>;
  }

  function updateFilter(key, value) {
    setFilters({ ...filters, [key]: value });
  }

  function updateSort(key) {
    setSort({
      key,
      direction: sort.key === key && sort.direction === "desc" ? "asc" : "desc",
    });
  }

  return (
    <section className="panel column-summary-panel">
      <div className="report-card-title split">
        <div>
          <h3>Column summary</h3>
          <span>{visibleColumns.length} of {columns.length} columns</span>
        </div>
        <SeverityLegend />
      </div>
      <div className="report-table-toolbar">
        <label className="search-box compact">
          <Search size={15} />
          <input
            value={filters.search || ""}
            onChange={(event) => updateFilter("search", event.target.value)}
            placeholder="Search column"
          />
        </label>
        <label className="compact-select">
          <span>Type</span>
          <select value={filters.dataType || "all"} onChange={(event) => updateFilter("dataType", event.target.value)}>
            <option value="all">All types</option>
            {dataTypes.map((type) => <option value={type} key={type}>{type}</option>)}
          </select>
        </label>
        <label className="compact-select">
          <span>Issue</span>
          <select value={filters.severity || "all"} onChange={(event) => updateFilter("severity", event.target.value)}>
            <option value="all">All</option>
            <option value="ok">OK</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </label>
      </div>
      <div className="table-wrap report-column-table-wrap">
        <table className="profile-table report-column-table">
          <thead>
            <tr>
              <SortableHeader label="Column" sortKey="name" sort={sort} onSort={updateSort} />
              <SortableHeader label="Type" sortKey="data_type" sort={sort} onSort={updateSort} />
              <SortableHeader label="Missing %" sortKey="null_ratio" sort={sort} onSort={updateSort} />
              <SortableHeader label="Distinct %" sortKey="distinct_ratio" sort={sort} onSort={updateSort} />
              <SortableHeader label="Min" sortKey="min" sort={sort} onSort={updateSort} />
              <SortableHeader label="Max" sortKey="max" sort={sort} onSort={updateSort} />
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleColumns.length ? visibleColumns.map((column) => {
              const columnFindings = findingsByColumn.get(column.name) || [];
              const selected = selectedColumn?.name === column.name;
              return (
                <tr
                  key={column.name}
                  className={selected ? "selected-row" : ""}
                  onClick={() => setSelectedColumnName(column.name)}
                >
                  <td><span className="column-name" title={column.name}><Table2 size={15} /> {column.name}</span></td>
                  <td><span className="type-pill" title={column.data_type}>{column.data_type || "-"}</span></td>
                  <td><MetricBar value={column.null_ratio} tone="warn" /></td>
                  <td><MetricBar value={column.distinct_ratio} tone="info" /></td>
                  <td title={String(column.min ?? "-")}>{formatMaybeNumber(column.min)}</td>
                  <td title={String(column.max ?? "-")}>{formatMaybeNumber(column.max)}</td>
                  <td><IssueSummary findings={columnFindings} /></td>
                </tr>
              );
            }) : (
              <tr><td colSpan={7} className="empty-cell">No columns match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  return (
    <th>
      <button className={`sort-header ${active ? "active" : ""}`} type="button" onClick={() => onSort(sortKey)}>
        {label}
        <ArrowDownAZ size={13} />
      </button>
    </th>
  );
}

function MetricBar({ value, tone }) {
  const percent = Math.max(0, Math.min(100, Number(value || 0) * 100));
  return (
    <span className="metric-bar-cell" title={formatPercentValue(value)}>
      <span className={`metric-bar ${tone}`}><i style={{ width: `${percent}%` }} /></span>
      <span>{formatPercentValue(value)}</span>
    </span>
  );
}

function IssueSummary({ findings }) {
  const severity = getWorstSeverity(findings);
  if (severity === "ok") {
    return <span className="ok-mark" title="Healthy: no profiling findings"><CheckCircle2 size={15} /> Healthy</span>;
  }
  return (
    <span className={`issue-summary ${severity}`} title={findings.map((finding) => finding.message).join("\n")}>
      <AlertTriangle size={14} />
      {severity} ({findings.length})
    </span>
  );
}
