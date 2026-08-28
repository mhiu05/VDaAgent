import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ReportDraft } from "@/lib/api";
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

function renderPage(client: QueryClient) {
  api.getReportExportSource.mockResolvedValue({
    profile: {
      run: { id: "run-1", risk_warnings: [], narrative_report: "", created_at: null, row_count: 0, scan_mode: "sample" },
      dataset: { name: "Dataset" },
      column_stats: [],
      drift_reports: [],
    },
    report_snapshot: { title: "Draft", items: draft.items },
  });
  api.getProfileReportDraft.mockResolvedValue(draft);
  const view = render(<QueryClientProvider client={client}><ReportPage /></QueryClientProvider>);
  return view;
}

async function openEditor() {
  await screen.findByRole("button", { name: /chỉnh sửa report draft/i });
  fireEvent.click(screen.getByRole("button", { name: /chỉnh sửa report draft/i }));
  await screen.findAllByRole("button", { name: /edit/i });
}

describe("Report draft optimistic mutations", () => {
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

  it("updates an item in the cache before the server confirms it", async () => {
    let resolve!: (value: ReportDraft) => void;
    api.updateReportDraftItem.mockReturnValue(new Promise<ReportDraft>((done) => { resolve = done; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderPage(client);
    await openEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    fireEvent.change(screen.getByDisplayValue("Before"), { target: { value: "After" } });
    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));

    await waitFor(() => expect((client.getQueryData<ReportDraft>(key)?.items[0].title)).toBe("After"));
    expect(api.updateReportDraftItem).toHaveBeenCalledWith("report-1", "item-a", { title: "After", note: "Original" });

    await act(async () => resolve(draft));
  });

  it("rolls an item back when the server rejects the edit", async () => {
    api.updateReportDraftItem.mockRejectedValue(new Error("offline"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderPage(client);
    await openEditor();

    fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    fireEvent.change(screen.getByDisplayValue("Before"), { target: { value: "Unconfirmed" } });
    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));

    await waitFor(() => expect(client.getQueryData<ReportDraft>(key)?.items[0].title).toBe("Before"));
  });

  it("uses the server draft version, blocks a duplicate reorder, and recovers a 409", async () => {
    let reject!: (error: Error) => void;
    api.reorderReportDraft.mockReturnValue(new Promise<ReportDraft>((_resolve, fail) => { reject = fail; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderPage(client);
    await openEditor();
    const down = screen.getAllByTitle("Xuống")[0];

    fireEvent.click(down);
    fireEvent.click(down);

    await waitFor(() => expect(client.getQueryData<ReportDraft>(key)?.items.map((item) => item.id)).toEqual(["item-b", "item-a"]));
    expect(api.reorderReportDraft).toHaveBeenCalledTimes(1);
    expect(api.reorderReportDraft).toHaveBeenCalledWith("report-1", ["item-b", "item-a"], 7);

    await act(async () => reject(new ApiError("stale draft", 409)));
    await waitFor(() => expect(client.getQueryData<ReportDraft>(key)?.items.map((item) => item.id)).toEqual(["item-a", "item-b"]));
    await screen.findByText(/thứ tự báo cáo đã thay đổi/i);
  });
});
