import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileReviewPanel } from "./profile-review-panel";

const api = vi.hoisted(() => ({ getProfile: vi.fn(), confirmProposals: vi.fn() }));
vi.mock("@/lib/api", () => api);
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ workspaceId: "workspace-1" }) }));
vi.mock("@/components/ui", () => ({
  ErrorNotice: ({ error }: { error: Error }) => <div role="alert">{error.message}</div>,
  LoadingBlock: ({ label }: { label: string }) => <div>{label}</div>,
  LoadingButton: ({ children, busy: _busy, ...props }: { children: React.ReactNode; busy?: boolean; [key: string]: unknown }) => <button {...props}>{children}</button>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

const profile = {
  profile_run_id: "run-review", dataset_id: "dataset-1", status: "pending_review", pending_proposals: 3,
  proposals: {
    candidate_key: [{ id: "key-1", status: "pending", proposed_type: "candidate_key", confidence_score: 0.9, evidence: "key", detection_method: "rule", columns: ["id"] }],
    semantic_type: [{ id: "semantic-1", status: "pending", proposed_type: "categorical", confidence_score: 0.8, evidence: "type", detection_method: "rule", column_name: "city" }],
    pii: [{ id: "pii-1", status: "pending", pii_type: "email", confidence_score: 0.95, evidence: "pattern", detection_method: "rule", column_name: "email" }],
  },
} as never;

function renderPanel(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onClose, ...render(<QueryClientProvider client={queryClient}><ProfileReviewPanel runId="run-review" onClose={onClose} /></QueryClientProvider>) };
}

describe("ProfileReviewPanel", () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.getProfile.mockResolvedValue(profile);
    api.confirmProposals.mockResolvedValue({ profile_run_id: "run-review", status: "resuming", pending_proposals: 0, proposals: {} });
  });

  it("requires and submits explicit confirm, edit, and reject decisions", async () => {
    renderPanel();
    await screen.findByText("Xác nhận metadata");
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "confirm" } });
    fireEvent.change(selects[1], { target: { value: "edit" } });
    fireEvent.change(screen.getByLabelText("Lý do chỉnh sửa (bắt buộc)"), { target: { value: "Định dạng đã được xác minh" } });
    fireEvent.change(selects[2], { target: { value: "reject" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu quyết định & tiếp tục" }));
    await waitFor(() => expect(api.confirmProposals).toHaveBeenCalled());
    expect(api.confirmProposals.mock.calls[0][1].decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ proposal_id: "key-1", decision: "confirm" }),
      expect.objectContaining({ proposal_id: "semantic-1", decision: "edit", final_type: "categorical", note: "Định dạng đã được xác minh" }),
      expect.objectContaining({ proposal_id: "pii-1", decision: "reject" }),
    ]));
  });
});
