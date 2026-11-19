import { resolveChart } from "../../../shared/charts/chart-registry";
import type { ChartSpec } from "../../../shared/charts/chart-contract";
import type { SchemaBlock } from "./report-schema";
import type { ReportDetail } from "./types";
import { deriveReportVersionSummary } from "./version-summary";

/** Layout suitability only. Never ranks values or changes a saved chart. */
export function isCompactChart(chart: ChartSpec): boolean {
  const { type } = resolveChart(chart);
  if (!type || chart.series.length > 4) return false;
  if (type === "heatmap")
    return chart.labels.length <= 8 && chart.series.length <= 4;
  if (type === "pie" || type === "donut") return chart.labels.length <= 6;
  if (type === "bar") return chart.labels.length <= 8;
  return chart.labels.length <= 40;
}

/** A readonly presentation projection of exactly one version; no service or persistence. */
export function deriveReportDashboardView(detail: ReportDetail) {
  const summary = deriveReportVersionSummary(detail);
  if (!summary || !detail.version) return null;
  const schema = detail.version.schema;
  if (
    schema &&
    (schema.reportId !== summary.reportId ||
      schema.versionId !== summary.versionId)
  ) {
    throw new Error(
      "Dashboard schema does not belong to the selected version.",
    );
  }
  const blocks = schema?.dashboard ?? [];
  // Keep sections intact: nested IDs and authored groupings are never flattened.
  const metrics = blocks.find((b) => b.kind === "metric-grid");
  const introduction = blocks[0]?.kind === "text" ? blocks[0] : undefined;
  const charts = blocks
    .filter((b) => b.kind === "chart" && isCompactChart(b.chart))
    .slice(0, 2);
  const finding = blocks.find(
    (b) =>
      b.kind === "finding" ||
      (b.kind === "section" &&
        b.blocks.length > 0 &&
        b.blocks.every((child) => child.kind === "finding")),
  );
  const selected = new Set<SchemaBlock>([
    ...(introduction ? [introduction] : []),
    ...(metrics ? [metrics] : []),
    ...charts,
    ...(finding ? [finding] : []),
  ]);
  return {
    reportId: summary.reportId,
    versionId: summary.versionId,
    summary,
    schema: schema
      ? {
          introduction: introduction ? [introduction] : [],
          metrics: metrics ? [metrics] : [],
          charts,
          finding: finding ? [finding] : [],
          remaining: blocks.filter((b) => !selected.has(b)),
        }
      : null,
    // Legacy summaries already preserve all original charts/findings and the reader owns prose.
    legacy: {
      charts: summary.charts.slice(0, 2),
      finding: summary.findings.slice(0, 1),
      chartsRemaining: summary.charts.slice(2),
      findingsRemaining: summary.findings.slice(1),
    },
  };
}
