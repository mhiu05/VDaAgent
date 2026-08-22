import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

function payload(items: Array<Record<string, unknown>>) {
  return {
    profile: {
      dataset: { name: "Production chart test" },
      run: { id: "run-1", status: "completed", row_count: 100 },
      column_stats: [],
      proposals: {},
      drift_reports: [],
    },
    analysis_sessions: [],
    report_snapshot: {
      id: "report-1",
      version: 1,
      snapshot_hash: "hash",
      items,
    },
    export_sections: ["report_snapshot"],
  };
}

function chartItem(chartType: string, renderer: string, x: string, y: string | undefined, data: Array<Record<string, unknown>>) {
  return {
    id: `chart-${chartType}`,
    item_type: "chart",
    title: chartType,
    result_hash: `${chartType}-hash`,
    query_spec: { analysis_kind: chartType, aggregate: "count", dimensions: y ? [x, y] : [] },
    content_json: {
      chart_spec: { chart_type: chartType, renderer, x_column: x, y_column: y },
      result: { columns: Object.keys(data[0]), data },
      insight: "Insight đã được review từ Official evidence.",
    },
  };
}

describe("chart PDF export", () => {
  it("draws every advanced chart and keeps its evidence table", async () => {
    const items = [
      chartItem("histogram", "native-svg", "sales", undefined, [{ bin_start: 0, bin_end: 10, value: 5 }]),
      chartItem("scatter", "native-svg", "sales", "cost", [{ x: 10, y: 4, value: 3 }]),
      chartItem("box", "native-svg", "region", "sales", [{ group_label: "North", min: 1, q1: 2, median: 3, q3: 4, max: 5, value: 3 }]),
      chartItem("heatmap", "native-grid", "region", "channel", [{ region: "North", channel: "Online", value: 8 }]),
    ];

    const render = async (snapshotItems: Array<Record<string, unknown>>) => {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload(snapshotItems))));
      const response = await GET(
        new Request("http://localhost/api/reports/profile/run-1"),
        { params: Promise.resolve({ runId: "run-1" }) },
      );
      return new Uint8Array(await response.arrayBuffer());
    };
    const empty = await render([]);
    const advanced = await render(items);

    expect(new TextDecoder().decode(advanced.slice(0, 8))).toContain("%PDF-1.4");
    expect(advanced.byteLength).toBeGreaterThan(empty.byteLength + 2_000);
    vi.unstubAllGlobals();
  });
});
