import { describe, expect, it } from "vitest";
import {
  chartRegistry,
  compatibleChartTypes,
  orderChart,
  recommendChart,
  resolveChart,
  validateChart,
} from "./chart-registry";
import type { ChartSpec, ChartType } from "./chart-contract";
import { chartFixture } from "./chart-test-fixtures";

const base = (): ChartSpec => ({
  id: "x",
  title: "Observed values",
  dimension: { label: "Category", kind: "categorical" },
  labels: ["A", "B", "C"],
  series: [{ id: "a", label: "First", unit: "items", values: [4, 2, 3] }],
  sourceId: "source",
});

describe("shared chart registry", () => {
  it.each(Object.keys(chartRegistry) as ChartType[])(
    "resolves a real %s with compatible data",
    (type) => {
      expect(resolveChart(chartFixture(type))).toMatchObject({ type });
    },
  );
  it("uses semantics and dimension metadata for deterministic recommendations", () => {
    for (const [spec, expected] of [
      [{ ...base(), semantic: "composition" }, "donut"],
      [
        {
          ...base(),
          dimension: { label: "Date", kind: "temporal" },
          labels: ["2026-01-01", "2026-01-02", "2026-01-03"],
        },
        "line",
      ],
      [{ ...chartFixture("scatter"), type: undefined }, "scatter"],
      [{ ...chartFixture("heatmap"), type: undefined }, "heatmap"],
      [{ ...chartFixture("histogram"), type: undefined }, "histogram"],
    ] as const)
      expect(recommendChart(spec)).toBe(expected);
    expect(recommendChart(base())).toBe("bar");
  });
  it("preserves multi-series signed values and unit metadata", () => {
    const spec = chartFixture("stacked-bar");
    spec.series[0].values = [-3, 0, 4];
    expect(resolveChart(spec).type).toBe("stacked-bar");
    expect(spec.series[0].unit).toBe("items");
    spec.series[1].unit = "currency";
    expect(resolveChart(spec).issue).toBe("incompatible");
  });
  it("preserves null observations, rejects all-missing data and invalid dimensions", () => {
    const spec = base();
    spec.series[0].values = [4, null, 2];
    expect(validateChart(spec)).toBeNull();
    expect(spec.series[0].values[1]).toBeNull();
    spec.series[0].values = [null, null, null];
    expect(validateChart(spec)).toBe("empty");
    expect(
      validateChart({ ...base(), dimension: { label: "x", kind: "numeric" } }),
    ).toBe("invalid");
  });
  it("sorts time with aligned series without mutating saved data", () => {
    const spec: ChartSpec = {
      ...base(),
      dimension: { label: "Time", kind: "temporal" },
      labels: ["2026-01-03", "2026-01-01", "2026-01-02"],
      series: [{ id: "a", label: "A", unit: "items", values: [3, 1, null] }],
    };
    const before = JSON.stringify(spec);
    const sorted = orderChart(spec);
    expect(sorted.labels).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(sorted.series[0].values).toEqual([1, null, 3]);
    expect(JSON.stringify(spec)).toBe(before);
  });
  it("rejects negative, incomplete, non-compositional or zero-total pie data", () => {
    for (const values of [
      [-1, 2, 3],
      [null, 2, 3],
      [0, 0, 0],
    ]) {
      const spec = chartFixture("pie");
      spec.series[0].values = values;
      expect(resolveChart(spec).issue).toBe("incompatible");
    }
    expect(resolveChart({ ...base(), type: "pie" }).issue).toBe("incompatible");
  });
  it("does not silently reinterpret unsupported or incompatible explicit choices", () => {
    expect(resolveChart({ ...base(), type: "future" }).type).toBeUndefined();
    expect(resolveChart({ ...base(), type: "scatter" }).type).toBeUndefined();
    expect(compatibleChartTypes(base())).not.toContain("pie");
  });
  it("requires aligned finite series and valid non-overlapping histogram bins", () => {
    const spec = base();
    spec.series[0].values = [1, 2];
    expect(validateChart(spec)).toBe("invalid");
    spec.series[0].values = [1, Infinity, 3];
    expect(validateChart(spec)).toBe("invalid");
    const histogram = chartFixture("histogram");
    histogram.binEnds = [3, 4, 6];
    expect(resolveChart(histogram).issue).toBe("incompatible");
  });
  it("bounds SVG work without changing source values or aggregates", () => {
    const spec = base();
    spec.labels = Array.from({ length: 3000 }, (_, i) => String(i));
    spec.series[0].values = spec.labels.map(() => 1);
    expect(validateChart(spec)).toBe("capacity");
    expect(
      spec.series[0].values.reduce<number>((sum, v) => sum + (v ?? 0), 0),
    ).toBe(3000);
  });
});
