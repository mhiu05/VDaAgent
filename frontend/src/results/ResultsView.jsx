import React, { useMemo } from "react";
import { ColumnDetailPanel } from "./components/ColumnDetailPanel.jsx";
import { ColumnSummaryTable } from "./components/ColumnSummaryTable.jsx";
import { CorrelationsPanel } from "./components/CorrelationMatrix.jsx";
import { FindingsPanel } from "./components/FindingsPanel.jsx";
import { OverviewMetrics } from "./components/OverviewMetrics.jsx";
import { QualityOverview } from "./components/QualityOverview.jsx";
import { ReportEmptyState } from "./components/ReportEmptyState.jsx";
import { ReportHeader } from "./components/ReportHeader.jsx";
import { useReportSelection } from "./hooks/useReportSelection.js";
import { buildQualityOverview, groupFindingsByColumn } from "./utils/reportMetrics.js";

export function ResultsView({
  result,
  resultSources,
  selectedProfileIndex,
  setSelectedProfileIndex,
  quality,
  traceEvents = [],
  hitlRecords = [],
}) {
  const selection = useReportSelection(result, resultSources, selectedProfileIndex, setSelectedProfileIndex);
  const activeResult = selection.activeResult;
  const columns = activeResult?.columns || [];
  const findings = activeResult?.findings || [];
  const correlations = activeResult?.relationships?.correlations || [];
  const activeQuality = activeResult?.quality_summary || quality || {};

  const findingsByColumn = useMemo(() => groupFindingsByColumn(findings), [findings]);
  const selectedColumn = useMemo(() => {
    const selected = columns.find((column) => column.name === selection.selectedColumnName);
    return selected || columns[0] || null;
  }, [columns, selection.selectedColumnName]);
  const overview = useMemo(() => buildQualityOverview(activeResult, columns, findings, activeQuality), [activeResult, columns, findings, activeQuality]);

  if (!activeResult) return <ReportEmptyState />;

  return (
    <section className="report-page">
      <ReportHeader
        result={activeResult}
        sources={selection.sources}
        selectedIndex={selection.selectedProfileIndex}
        setSelectedIndex={selection.setSelectedProfileIndex}
        traceEvents={traceEvents}
        hitlRecords={hitlRecords}
      />
      <OverviewMetrics overview={overview} />
      <QualityOverview columns={columns} findings={findings} />
      <div className="report-main-grid">
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
      <div className="report-lower-grid">
        <CorrelationsPanel
          correlations={correlations}
          method={activeResult?.profile_metadata?.correlation_method}
          viewMode={selection.correlationView}
          setViewMode={selection.setCorrelationView}
        />
        <FindingsPanel findings={findings} columns={columns} />
      </div>
    </section>
  );
}
