import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompareWorkspace } from "./compare-workspace";

const api = vi.hoisted(() => ({
  detectDrift: vi.fn(),
  listAllRuns: vi.fn(),
}));
const auth = vi.hoisted(() => ({ workspaceId: "workspace-a" }));

vi.mock("@/lib/api", () => api);
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ workspaceId: auth.workspaceId }) }));
vi.mock("@/components/ui", () => ({
  EmptyState: ({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) => <section><h2>{title}</h2><p>{detail}</p>{action}</section>,
  ErrorNotice: ({ error }: { error: Error }) => <section role="alert">{error.message}</section>,
  InfoTip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  LoadingBlock: ({ label }: { label?: string }) => <section>{label}</section>,
  Notice: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header>,
  LoadingButton: ({ children, busy: _busy, ...props }: { children: React.ReactNode; busy?: boolean; [key: string]: unknown }) => <button {...props}>{children}</button>,
  useToast: () => ({ success: vi.fn(), error: vi.fn(), show: vi.fn() }),
}));

const datasets = [
  { id: "dataset-a", name: "Doanh thu", source_type: "file", source_ref: null, collection_name: null, last_profiled_at: null },
  { id: "dataset-b", name: "Doanh thu tháng sau", source_type: "file", source_ref: null, collection_name: null, last_profiled_at: null },
];
const baseline = { id: "run-base", dataset_id: "dataset-a", run_name: "Tháng 1", version: 1, status: "completed", scan_mode: "full", row_count: 100, is_approximate: false, created_at: "2026-01-12T10:00:00Z" };
const current = { id: "run-current", dataset_id: "dataset-b", run_name: "Tháng 2", version: 1, status: "completed", scan_mode: "full", row_count: 120, is_approximate: false, created_at: "2026-02-12T10:00:00Z" };
const unfinished = { id: "run-pending", dataset_id: "dataset-a", run_name: "Đang xử lý", version: 2, status: "running", scan_mode: "sample", row_count: null, is_approximate: false, created_at: "2026-02-13T10:00:00Z" };

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CompareWorkspace /></QueryClientProvider>);
}

describe("CompareWorkspace", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    auth.workspaceId = "workspace-a";
    api.listAllRuns.mockResolvedValue([
      { ...baseline, dataset_name: datasets[0].name },
      { ...current, dataset_name: datasets[1].name },
      { ...unfinished, dataset_name: datasets[0].name },
    ]);
    api.detectDrift.mockReset();
  });

  it("lists only completed Profile Runs and prevents an incomplete comparison", async () => {
    const { container } = renderWorkspace();

    await waitFor(() => expect(container.querySelectorAll("#compare-baseline option")).toHaveLength(3));
    expect(screen.queryByRole("option", { name: /Đang xử lý/i })).toBeNull();
    expect(screen.getByRole("button", { name: "So sánh dữ liệu" }).hasAttribute("disabled")).toBe(true);
  });

  it("sends the current run in the path argument and baseline in the request argument", async () => {
    api.detectDrift.mockResolvedValue({
      baseline_run_id: baseline.id,
      current_run_id: current.id,
      summary: "Phát hiện 1 dấu hiệu drift.",
      findings: [{
        column_name: "net_revenue",
        drift_type: "numeric_shift",
        severity: "major",
        metric: "mean",
        baseline_value: 120,
        current_value: 220,
        psi: null,
        detail: "mean lệch 83.3% so với run trước.",
      }],
    });
    const { container } = renderWorkspace();
    await waitFor(() => expect(container.querySelector("#compare-baseline")).toBeTruthy());

    fireEvent.change(container.querySelector("#compare-baseline")!, { target: { value: baseline.id } });
    fireEvent.change(container.querySelector("#compare-current")!, { target: { value: current.id } });
    fireEvent.click(screen.getByRole("button", { name: "So sánh dữ liệu" }));

    await waitFor(() => expect(api.detectDrift).toHaveBeenCalledWith(current.id, baseline.id));
    expect(await screen.findByText("Phát hiện 1 dấu hiệu drift.")).toBeTruthy();
    expect(screen.getAllByText("net_revenue")).toHaveLength(2);
    expect(screen.getByText("220")).toBeTruthy();
  });

  it("clears transient selections after a workspace switch", async () => {
    const rendered = renderWorkspace();
    await waitFor(() => expect(rendered.container.querySelector("#compare-baseline")).toBeTruthy());
    fireEvent.change(rendered.container.querySelector("#compare-baseline")!, { target: { value: baseline.id } });
    fireEvent.change(rendered.container.querySelector("#compare-current")!, { target: { value: current.id } });
    expect(screen.getByRole("button", { name: "So sánh dữ liệu" }).hasAttribute("disabled")).toBe(false);

    auth.workspaceId = "workspace-b";
    rendered.rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CompareWorkspace /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByRole("button", { name: "So sánh dữ liệu" }).hasAttribute("disabled")).toBe(true));
  });
});
