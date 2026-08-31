import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChartsTab } from "./charts-tab";

const api = vi.hoisted(() => ({
  autoPlanChart: vi.fn(),
  autoProfilePack: vi.fn(),
  ensureExplorerSession: vi.fn(),
  getProfileReportDraft: vi.fn(),
  listForecastAlgorithms: vi.fn(),
  pinChartToReport: vi.fn(),
  previewExplorer: vi.fn(),
  promoteExplorerPreview: vi.fn(),
  streamQuestion: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/markdown", () => ({ MarkdownContent: ({ text }: { text: string }) => <>{text}</>, normalizeMarkdownText: (text: string) => text }));
vi.mock("@/components/ui", () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  ErrorNotice: () => <div role="alert" />,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./chart-evidence-view", () => ({ ChartEvidenceView: () => <div /> }));

const execution = {
  id: "execution-1",
  execution_kind: "official",
  query_summary: "Official aggregate",
  result_hash: "evidence-hash",
  query_spec: { analysis_kind: "aggregate", aggregate: "count", dimensions: ["region"], filters: [], limit: 50, sort: "desc" },
  result: { row_count: 2, rows: [] },
};

function readyChart(id: string) {
  return {
    id,
    question: `Question ${id}`,
    title: `Question ${id}`,
    problem: "compare",
    algorithm: "count",
    x_column: "region",
    y_column: "",
    second_dimension: "",
    time_grain: "",
    date_from: "",
    date_to: "",
    forecast_horizon: 12,
    season_length: 12,
    chart_type: "bar",
    renderer: "native-css",
    status: "official",
    generated: true,
    execution: { ...execution, id: `execution-${id}` },
    insight: `Reviewed insight ${id}`,
    insight_reviewed: true,
    pin_idempotency_key: `pin-${id}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderCharts(charts: unknown[]) {
  localStorage.setItem("p170_charts_state_run-1", JSON.stringify(charts));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ChartsTab runId="run-1" profile={{} as never} onExplain={vi.fn()} /></QueryClientProvider>);
}

describe("ChartsTab optimistic pinning", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(api).forEach((mock) => mock.mockReset());
    api.ensureExplorerSession.mockResolvedValue({ context: { context: { dimensions: ["region"], measures: [] } } });
    api.listForecastAlgorithms.mockResolvedValue({ algorithms: [] });
    api.getProfileReportDraft.mockResolvedValue({ id: "report-1" });
  });

  afterEach(cleanup);

  it("prevents a rapid duplicate single-chart pin", async () => {
    const request = deferred<unknown>();
    api.pinChartToReport.mockReturnValue(request.promise);
    renderCharts([readyChart("one")]);

    const pin = await screen.findByRole("button", { name: /ghim vào báo cáo/i });
    fireEvent.click(pin);
    fireEvent.click(pin);

    await waitFor(() => expect(api.pinChartToReport).toHaveBeenCalledTimes(1));
    request.resolve({});
    await screen.findByText(/đã ghim vào báo cáo/i);
  });

  it("updates every bulk pin immediately and rolls back only the failed chart", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    api.pinChartToReport.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderCharts([readyChart("one"), readyChart("two")]);

    fireEvent.click(await screen.findByRole("button", { name: /ghim 2 biểu đồ sẵn sàng/i }));
    await waitFor(() => expect(api.pinChartToReport).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText(/đang ghim/i)).toHaveLength(2);

    first.resolve({});
    second.reject(new Error("pin failed"));

    await screen.findByText(/đã ghim 1 biểu đồ; 1 biểu đồ đã được hoàn tác do lỗi/i);
    expect(screen.getByText(/đã ghim vào báo cáo/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /ghim vào báo cáo/i })).toBeTruthy();
  });
});
