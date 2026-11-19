import fixture from "../../../mocks/reports/data/riverside-r010-v2/report.json";

/** Presentation-only projection of the supplied public mock. Never calls a service. */
export const reportPreview = {
  version: fixture.report.version_id,
  project: fixture.report.project,
  available: fixture.snapshots.current.available,
  agingRate: fixture.kpis.find((kpi) => kpi.id === "aging_rate")!.value,
  buckets: fixture.charts[0].series.map((series) => ({
    label: series.label,
    value: "value" in series ? series.value : 0,
  })),
};

export const agentRoles = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    description: "orchestrator",
    symbol: "O",
  },
  { id: "data", name: "Data", description: "dataRole", symbol: "D" },
  { id: "compare", name: "Compare", description: "compare", symbol: "C" },
  { id: "insight", name: "Insight", description: "insightRole", symbol: "I" },
  { id: "chart", name: "Chart", description: "chart", symbol: "↗" },
  { id: "report", name: "Report", description: "report", symbol: "R" },
] as const;
