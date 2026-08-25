import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartEvidenceView } from "./chart-evidence-view";
import type { ChartSpec, QuerySpec } from "@/lib/analysis-types";

const query: QuerySpec = {
  aggregate: "sum",
  column: "sales",
  dimensions: ["month"],
  filters: [],
  time_grain: "month",
  limit: 50,
  sort: "asc",
};

const bar: ChartSpec = {
  chart_type: "bar",
  renderer: "native-css",
  x_column: "month",
  y_column: "sales",
  aggregation: "sum",
  time_grain: "month",
};

describe("ChartEvidenceView", () => {
  it("fails gracefully when an aggregate result is empty", () => {
    render(<ChartEvidenceView chartSpec={bar} querySpec={query} result={{ data: [], columns: ["month", "value"], row_count: 0 }} />);
    expect(screen.getByRole("status").textContent).toContain("Không có dữ liệu để vẽ");
  });

  it("renders positive and negative bars around the zero baseline", () => {
    const { container } = render(<ChartEvidenceView chartSpec={bar} querySpec={query} result={{
      data: [{ month: "2026-01", value: -20 }, { month: "2026-02", value: 40 }],
      columns: ["month", "value"],
      row_count: 2,
    }} />);
    const fills = container.querySelectorAll(".bar-fill");
    expect(fills).toHaveLength(2);
    expect(fills[0].classList.contains("negative")).toBe(true);
    expect(fills[0].getAttribute("style")).toContain("right: 50%");
    expect(fills[0].getAttribute("style")).toContain("width: 25%");
    expect(fills[1].getAttribute("style")).toContain("left: 50%");
    expect(fills[1].getAttribute("style")).toContain("width: 50%");
  });

  it("starts an all-positive bar chart at the zero baseline", () => {
    const { container } = render(<ChartEvidenceView chartSpec={bar} querySpec={query} result={{
      data: [{ month: "2026-01", value: 12 }, { month: "2026-02", value: 6 }],
      columns: ["month", "value"],
      row_count: 2,
    }} />);
    const fills = container.querySelectorAll(".bar-fill");
    expect(fills[0].getAttribute("style")).toContain("left: 0");
    expect(fills[0].getAttribute("style")).toContain("width: 100%");
    expect(container.querySelector(".chart-zero-line")).toBeNull();
  });

  it("states the Top 15 cap when the dataset has fewer groups", () => {
    const { container } = render(<ChartEvidenceView chartSpec={bar} querySpec={query} result={{ data: [{ month: "2026-01", value: 12 }, { month: "2026-02", value: 6 }], columns: ["month", "value"], row_count: 2 }} />);

    expect(container.textContent).toContain("Hiển thị Top 2/15 nhóm; dữ liệu hiện có 2 nhóm.");
  });

  it("renders a bounded histogram", () => {
    render(<ChartEvidenceView chartSpec={{ chart_type: "histogram", renderer: "native-svg", analysis_kind: "histogram", x_column: "sales", aggregation: "count", bins: 12 }} querySpec={{ analysis_kind: "histogram", aggregate: "count", column: "sales", dimensions: [], filters: [], bins: 12, limit: 50 }} result={{ data: [{ bin_index: 0, bin_start: 0, bin_end: 10, value: 4 }], columns: ["bin_index", "bin_start", "bin_end", "value"], row_count: 1 }} />);
    expect(screen.getByRole("img", { name: "Histogram" })).toBeTruthy();
  });

  it("labels scatter output as aggregate density", () => {
    render(<ChartEvidenceView chartSpec={{ chart_type: "scatter", renderer: "native-svg", analysis_kind: "scatter", x_column: "sales", y_column: "cost", aggregation: "count", bins: 12 }} querySpec={{ analysis_kind: "scatter", aggregate: "count", x_column: "sales", y_column: "cost", dimensions: [], filters: [], bins: 12, limit: 50 }} result={{ data: [{ x: 10, y: 4, value: 3, x_bin: 0, y_bin: 0 }], columns: ["x", "y", "value", "x_bin", "y_bin"], row_count: 1 }} />);
    expect(screen.getByText(/không phải dòng dữ liệu thô/i)).toBeTruthy();
  });

  it("renders a five-number box summary", () => {
    render(<ChartEvidenceView chartSpec={{ chart_type: "box", renderer: "native-svg", analysis_kind: "box", x_column: "region", y_column: "sales", aggregation: "median" }} querySpec={{ analysis_kind: "box", aggregate: "median", column: "sales", dimensions: ["region"], filters: [], limit: 50 }} result={{ data: [{ group_label: "North", min: 1, q1: 2, median: 3, q3: 4, max: 5, value: 3, count: 10 }], columns: ["group_label", "min", "q1", "median", "q3", "max", "value", "count"], row_count: 1 }} />);
    expect(screen.getByRole("img", { name: "Box plot" })).toBeTruthy();
  });

  it("renders a two-dimensional heatmap grid", () => {
    render(<ChartEvidenceView chartSpec={{ chart_type: "heatmap", renderer: "native-grid", analysis_kind: "heatmap", x_column: "region", y_column: "channel", aggregation: "count" }} querySpec={{ analysis_kind: "heatmap", aggregate: "count", dimensions: ["region", "channel"], filters: [], limit: 50 }} result={{ data: [{ region: "North", channel: "Online", value: 8 }], columns: ["region", "channel", "value"], row_count: 1 }} />);
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.getByRole("gridcell").textContent).toBe("8");
  });

  it("renders actual values, forecast and prediction interval separately", () => {
    render(<ChartEvidenceView chartSpec={{ chart_type: "line", renderer: "native-svg", analysis_kind: "forecast", x_column: "order_date", y_column: "sales", aggregation: "sum", forecast_algorithm: "seasonal_naive", forecast_horizon: 2, season_length: 12 }} querySpec={{ analysis_kind: "forecast", aggregate: "sum", column: "sales", dimensions: ["order_date"], filters: [], time_grain: "month", forecast_algorithm: "seasonal_naive", forecast_horizon: 2, season_length: 12, confidence_level: 0.95, limit: 50 }} result={{ data: [{ order_date: "2026-01-01", value: 10, series: "actual", lower: null, upper: null }, { order_date: "2026-02-01", value: 12, series: "actual", lower: null, upper: null }, { order_date: "2026-03-01", value: 13, series: "forecast", lower: 11, upper: 15 }], columns: ["order_date", "value", "series", "lower", "upper"], row_count: 3 }} />);

    expect(screen.getByText("Thực tế")).toBeTruthy();
    expect(screen.getByText("Dự báo")).toBeTruthy();
    expect(screen.getByText("Khoảng dự báo 95%")).toBeTruthy();
  });

  it("renders privacy-safe profiling matrices", () => {
    const { container } = render(<ChartEvidenceView chartSpec={{ chart_type: "missing_heatmap", renderer: "native-grid", analysis_kind: "missing_heatmap", x_column: "x", y_column: "y", aggregation: "count" }} querySpec={{ analysis_kind: "missing_heatmap", aggregate: "count", columns: ["sales", "cost"], dimensions: [], filters: [], limit: 50 }} result={{ data: [{ x: "sales", y: "cost", value: 12.5 }], columns: ["x", "y", "value"], row_count: 1 }} />);
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
    expect(container.textContent).toMatch(/không hiển thị từng dòng/i);
  });

  it("renders aggregate violin density and donut share", () => {
    const violin = render(<ChartEvidenceView chartSpec={{ chart_type: "violin", renderer: "native-svg", analysis_kind: "violin", x_column: "region", y_column: "sales", aggregation: "count", bins: 12 }} querySpec={{ analysis_kind: "violin", aggregate: "count", column: "sales", dimensions: ["region"], filters: [], bins: 12, limit: 8 }} result={{ data: [{ group_label: "North", bin_index: 0, bin_start: 0, bin_end: 10, value: 4 }], columns: ["group_label", "bin_index", "bin_start", "bin_end", "value"], row_count: 1 }} />);
    expect(violin.container.querySelector(".chart-violin-bin")).toBeTruthy();
    violin.unmount();

    const donut = render(<ChartEvidenceView chartSpec={{ chart_type: "donut", renderer: "native-svg", analysis_kind: "donut", x_column: "region", y_column: "sales", aggregation: "sum" }} querySpec={{ analysis_kind: "donut", aggregate: "sum", column: "sales", dimensions: ["region"], filters: [], limit: 12 }} result={{ data: [{ region: "North", value: 60 }, { region: "South", value: 40 }], columns: ["region", "value"], row_count: 2 }} />);
    expect(donut.container.querySelector(".chart-donut")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
  });
});
