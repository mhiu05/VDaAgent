import type { ChartSpec, ChartType } from "./chart-contract";

type Family = "cartesian" | "radial" | "matrix";
export const chartRegistry = {
  line: { family: "cartesian" },
  area: { family: "cartesian" },
  bar: { family: "cartesian" },
  column: { family: "cartesian" },
  "grouped-bar": { family: "cartesian" },
  "stacked-bar": { family: "cartesian" },
  pie: { family: "radial" },
  donut: { family: "radial" },
  scatter: { family: "cartesian" },
  heatmap: { family: "matrix" },
  histogram: { family: "cartesian" },
} as const satisfies Record<ChartType, { family: Family }>;
export function validateChart(spec: ChartSpec): string | null {
  if (!spec.labels.length || !spec.series.length) return "empty";
  if (spec.labels.length * spec.series.length > 2000) return "capacity";
  if (
    spec.series.some(
      (s) =>
        s.values.length !== spec.labels.length ||
        s.values.some(
          (v) => v !== null && (typeof v !== "number" || !Number.isFinite(v)),
        ),
    )
  )
    return "invalid";
  if (
    new Set(spec.series.map((s) => s.id)).size !== spec.series.length ||
    new Set(spec.labels).size !== spec.labels.length
  )
    return "invalid";
  if (
    spec.dimension.kind === "numeric" &&
    spec.labels.some((v) => typeof v !== "number" || !Number.isFinite(v))
  )
    return "invalid";
  if (
    spec.dimension.kind === "temporal" &&
    spec.labels.some(
      (v) => typeof v !== "string" || !Number.isFinite(Date.parse(v)),
    )
  )
    return "invalid";
  if (spec.series.every((s) => s.values.every((v) => v === null)))
    return "empty";
  return null;
}
export function compatibleChartTypes(spec: ChartSpec): ChartType[] {
  if (validateChart(spec)) return [];
  const units = new Set(spec.series.map((s) => s.unit));
  if (units.size > 1) return []; // Shared axes cannot silently mix units.
  const values = spec.series.flatMap((s) => s.values);
  const known = values.filter((v): v is number => v !== null);
  if (!Number.isFinite(Math.max(0, ...known) - Math.min(0, ...known)))
    return [];
  if (spec.semantic === "matrix") return ["heatmap"];
  if (spec.semantic === "distribution") {
    const edges = spec.binEnds;
    return spec.dimension.kind === "numeric" &&
      spec.series.length === 1 &&
      edges?.length === spec.labels.length &&
      edges.every(
        (end, i) =>
          Number.isFinite(end) &&
          end > Number(spec.labels[i]) &&
          (i === 0 || Number(spec.labels[i]) >= edges[i - 1]),
      ) &&
      values.every((v) => v === null || v >= 0)
      ? ["histogram"]
      : [];
  }
  if (spec.dimension.kind === "numeric") return ["scatter"];
  const types: ChartType[] =
    spec.series.length > 1
      ? ["grouped-bar", "line", "area"]
      : ["bar", "column", "line", "area"];
  if (
    spec.series.length > 1 &&
    spec.semantic === "composition" &&
    spec.labels.every((_, i) =>
      Number.isFinite(
        spec.series.reduce((sum, s) => sum + Math.abs(s.values[i] ?? 0), 0),
      ),
    )
  )
    types.push("stacked-bar");
  const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  if (
    spec.semantic === "composition" &&
    spec.series.length === 1 &&
    spec.labels.length <= 12 &&
    values.every((v) => v !== null && v >= 0) &&
    Number.isFinite(total) &&
    total > 0
  )
    types.push("donut", "pie");
  return types;
}
export function recommendChart(spec: ChartSpec): ChartType | undefined {
  const compatible = compatibleChartTypes(spec);
  const preferred: ChartType =
    spec.semantic === "distribution"
      ? "histogram"
      : spec.semantic === "matrix"
        ? "heatmap"
        : spec.dimension.kind === "numeric"
          ? "scatter"
          : spec.dimension.kind === "temporal"
            ? "line"
            : spec.semantic === "composition"
              ? "donut"
              : spec.series.length > 1
                ? "grouped-bar"
                : "bar";
  return compatible.includes(preferred) ? preferred : compatible[0];
}
export function resolveChart(spec: ChartSpec): {
  type?: ChartType;
  compatible: ChartType[];
  issue?: string;
} {
  const compatible = compatibleChartTypes(spec);
  const type = spec.type ?? recommendChart(spec);
  if (
    !type ||
    !Object.hasOwn(chartRegistry, type) ||
    !compatible.includes(type as ChartType)
  )
    return { compatible: [], issue: validateChart(spec) ?? "incompatible" };
  return { type: type as ChartType, compatible };
}
/** Stable chronological order, copied with aligned series; null observations stay gaps. */
export function orderChart(spec: ChartSpec): ChartSpec {
  if (spec.dimension.kind !== "temporal") return spec;
  const order = spec.labels
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Date.parse(String(spec.labels[a])) - Date.parse(String(spec.labels[b])),
    );
  return {
    ...spec,
    labels: order.map((i) => spec.labels[i]),
    series: spec.series.map((s) => ({
      ...s,
      values: order.map((i) => s.values[i]),
    })),
  };
}
