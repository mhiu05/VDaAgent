import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ReportDraft } from "@/lib/api";
import ReportPage from "./page";

const api = vi.hoisted(() => ({
  downloadPublishedReportPdf: vi.fn(),
  getReportExportSource: vi.fn(),
  getProfileReportDraft: vi.fn(),
  updateReportDraftItem: vi.fn(),
  updateReportDraftTitle: vi.fn(),
  unpinReportDraftItem: vi.fn(),
  reorderReportDraft: vi.fn(),
  snapshotReportDraft: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ reportId: "report-1" }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/ui", () => ({
  EmptyState: () => null,
  ErrorNotice: ({ error }: { error: unknown }) => <p>{error instanceof Error ? error.message : "error"}</p>,
  LoadingBlock: () => <p>loading</p>,
  LoadingButton: ({ children, busy: _busy, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) => <button {...props}>{children}</button>,
  useToast: () => ({ success: vi.fn() }),
}));
vi.mock("@/components/markdown", () => ({ MarkdownContent: () => null }));
vi.mock("@/components/command-center/chart-evidence-view", () => ({ ChartEvidenceView: () => null }));
vi.mock("@/components/report-components", () => ({ TopValues: () => null, Distribution: () => null, MetricChart: () => null, CorrelationPanel: () => null }));

const key = ["command-center", "run-1", "report-draft"] as const;
const draft: ReportDraft = {
  id: "report-1",
  title: "Draft",
  profile_run_id: "run-1",
  status: "draft",
  draft_version: 7,
  version_id: "version-1",
  stale_reasons: [],
  items: [
    { id: "item-a", item_type: "note", position: 0, title: "Before", note: "Original" },
    { id: "item-b", item_type: "note", position: 1, title: "Second", note: "" },
  ],
};

function renderPage(client: QueryClient, exportSource: any = {
    profile: {
      run: { id: "run-1", risk_warnings: [], narrative_report: "", created_at: null, row_count: 0, scan_mode: "sample" },
      dataset: { name: "Dataset" },
      column_stats: [],
      drift_reports: [],
    },
    report_snapshot: { title: "Draft", items: draft.items },
  }) {
  api.getReportExportSource.mockResolvedValue(exportSource);
  api.getProfileReportDraft.mockResolvedValue(draft);
  const view = render(<QueryClientProvider client={client}><ReportPage /></QueryClientProvider>);
  return view;
}

async function openEditor() {
  const editButtons = await screen.findAllByRole("button", { name: "Chỉnh sửa" });
  await waitFor(() => expect((editButtons[0] as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(editButtons[0]);
  await screen.findByRole("button", { name: /lưu thay đổi/i });
}

describe("Final report item mutations", () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.getReportExportSource.mockReset();
    api.getProfileReportDraft.mockReset();
    api.updateReportDraftItem.mockReset();
    api.updateReportDraftTitle.mockReset();
    api.unpinReportDraftItem.mockReset();
    api.reorderReportDraft.mockReset();
    api.snapshotReportDraft.mockReset();
  });

  it("updates a draft item and snapshots the new final report", async () => {
    api.updateReportDraftItem.mockResolvedValue(draft);
    api.snapshotReportDraft.mockResolvedValue(draft);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderPage(client);
    await openEditor();

    fireEvent.change(screen.getByDisplayValue("Before"), { target: { value: "After" } });
    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));

    await waitFor(() => expect(api.updateReportDraftItem).toHaveBeenCalledWith("report-1", "item-a", { title: "After", note: "Original" }));
    await waitFor(() => expect(api.snapshotReportDraft).toHaveBeenCalledWith("report-1"));
  });

  it("keeps the editor open and shows the error when the server rejects the edit", async () => {
    api.updateReportDraftItem.mockRejectedValue(new Error("offline"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderPage(client);
    await openEditor();

    fireEvent.change(screen.getByDisplayValue("Before"), { target: { value: "Unconfirmed" } });
    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));

    await waitFor(() => expect(screen.getByText("offline")).toBeTruthy());
    expect(api.snapshotReportDraft).not.toHaveBeenCalled();
  });

  it("deletes a report item only after confirmation and snapshots the result", async () => {
    api.unpinReportDraftItem.mockResolvedValue(draft);
    api.snapshotReportDraft.mockResolvedValue(draft);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderPage(client);
    const deleteButtons = await screen.findAllByRole("button", { name: "Xóa" });
    await waitFor(() => expect((deleteButtons[0] as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(deleteButtons[0]);

    expect(confirm).toHaveBeenCalledWith("Xóa mục “Before” khỏi báo cáo cuối cùng?");
    await waitFor(() => expect(api.unpinReportDraftItem).toHaveBeenCalledWith("report-1", "item-a"));
    await waitFor(() => expect(api.snapshotReportDraft).toHaveBeenCalledWith("report-1"));
    confirm.mockRestore();
  });

  it("collapses report parts and expands a drift column on demand", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderPage(client, {
      profile: {
        run: { id: "run-1", risk_warnings: [], narrative_report: "", created_at: null, row_count: 10, scan_mode: "full" },
        dataset: { name: "Dataset" },
        column_stats: [],
        drift_reports: [{
          profile_run_id_a: "baseline-run",
          profile_run_id_b: "current-run",
          summary: "Revenue shifted",
          drift_columns: [
            { column_name: "revenue", drift_type: "numeric_shift", severity: "major", baseline_value: 10, current_value: 20, detail: "Mean increased" },
            { column_name: "revenue", drift_type: "null_rate_shift", severity: "minor", baseline_value: 0, current_value: 0.1, detail: "Missing values increased" },
            { column_name: "region", drift_type: "column_added", severity: "minor", detail: "New column" },
          ],
        }],
      },
      report_snapshot: { title: "Draft", items: draft.items },
    });

    const editButtons = await screen.findAllByRole("button", { name: "Chỉnh sửa" });
    await waitFor(() => expect((editButtons[0] as HTMLButtonElement).disabled).toBe(false));
    const partOne = document.querySelector("#part-1") as HTMLDetailsElement;
    const partTwo = document.querySelector("#part-2") as HTMLDetailsElement;
    const partThree = document.querySelector("#part-3") as HTMLDetailsElement;
    expect(partOne.open).toBe(false);
    expect(partTwo.open).toBe(false);
    expect(partThree.open).toBe(false);

    fireEvent.click(partOne.querySelector("summary")!);
    fireEvent.click(partTwo.querySelector("summary")!);
    fireEvent.click(partThree.querySelector(".report-accordion-summary")!);
    expect(partOne.open).toBe(true);
    expect(partTwo.open).toBe(true);
    expect(partThree.open).toBe(true);
    expect(screen.queryByText("baseline-run", { exact: true })).toBeNull();
    expect(screen.queryByText("current-run", { exact: true })).toBeNull();

    const driftColumns = document.querySelectorAll("#sec-drift .report-drift-column");
    expect(driftColumns).toHaveLength(2);
    expect((driftColumns[0] as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(driftColumns[0].querySelector("summary")!);
    expect((driftColumns[0] as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText("Mean increased")).toBeTruthy();
  });
});
