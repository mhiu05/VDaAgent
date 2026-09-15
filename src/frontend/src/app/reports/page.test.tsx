import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ReportPage from "./page";

const api = vi.hoisted(() => ({
  archiveReport: vi.fn(),
  listPublishedReports: vi.fn(),
  listReportReviewQueue: vi.fn(),
  publishReport: vi.fn(),
  reviewReport: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  current: {
    user: { id: "owner-1" },
    effective_permissions: [
      "report.published.read",
      "report.review",
      "report.publish",
      "report.archive",
    ],
  },
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ me: auth.current, workspaceId: "workspace-1" }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui", () => ({
  ErrorNotice: ({ error }: { error: unknown }) => <p>{error instanceof Error ? error.message : "error"}</p>,
  LoadingBlock: ({ label }: { label: string }) => <p>{label}</p>,
  useDialog: () => ({ confirm: vi.fn() }),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}><ReportPage /></QueryClientProvider>);
}

describe("ReportsPage publication actions", () => {
  beforeEach(() => {
    api.archiveReport.mockReset();
    api.listPublishedReports.mockReset();
    api.listReportReviewQueue.mockReset();
    api.publishReport.mockReset();
    api.reviewReport.mockReset();
    api.listPublishedReports.mockResolvedValue({ reports: [] });
    api.listReportReviewQueue.mockResolvedValue({
      reports: [{
        id: "report-1",
        title: "Owner review",
        status: "in_review",
        report_version_id: "version-1",
        version: 1,
        submitted_by_user_id: "analyst-1",
        submitted_at: "2026-09-15T00:00:00Z",
      }],
    });
    auth.current = {
      user: { id: "owner-1" },
      effective_permissions: [
        "report.published.read",
        "report.review",
        "report.publish",
        "report.archive",
      ],
    };
  });

  afterEach(cleanup);

  it("shows Owner-only actions for an in-review version", async () => {
    api.reviewReport.mockResolvedValue({ status: "approved" });
    renderPage();

    await screen.findByRole("heading", { name: "Chờ duyệt hoặc phát hành" });
    fireEvent.click(await screen.findByRole("button", { name: "Phê duyệt" }));

    await waitFor(() => expect(api.reviewReport).toHaveBeenCalledWith(
      "report-1", { decision: "approved" },
    ));
    expect(screen.getByRole("button", { name: "Yêu cầu chỉnh sửa" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeTruthy();
  });

  it("does not query or render the queue for an Analyst", async () => {
    auth.current = {
      user: { id: "analyst-1" },
      effective_permissions: ["report.published.read"],
    };
    renderPage();

    await screen.findByRole("heading", { name: "Danh sách báo cáo" });
    expect(api.listReportReviewQueue).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Chờ duyệt hoặc phát hành" })).toBeNull();
  });
});