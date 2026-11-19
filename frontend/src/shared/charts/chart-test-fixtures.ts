import type { ChartSpec, ChartType } from "./chart-contract";
const base = (): ChartSpec => ({
  id: "x",
  title: "Observed values",
  dimension: { label: "Category", kind: "categorical" },
  labels: ["A", "B", "C"],
  series: [{ id: "a", label: "First", unit: "items", values: [4, 2, 3] }],
  sourceId: "source",
});
export function chartFixture(type: ChartType): ChartSpec {
  const spec = { ...base(), type };
  if (type === "pie" || type === "donut") spec.semantic = "composition";
  if (type === "grouped-bar" || type === "stacked-bar" || type === "heatmap")
    spec.series = [
      ...spec.series,
      { id: "b", label: "Second", unit: "items", values: [2, 1, 4] },
    ];
  if (type === "heatmap") spec.semantic = "matrix";
  if (type === "stacked-bar") spec.semantic = "composition";
  if (type === "scatter" || type === "histogram") {
    spec.dimension = { label: "X", kind: "numeric" };
    spec.labels = [0, 2, 4];
  }
  if (type === "histogram") {
    spec.semantic = "distribution";
    spec.binEnds = [2, 4, 6];
  }
  return spec;
}
