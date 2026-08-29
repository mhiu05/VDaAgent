import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceManagePage from "./page";

const api = vi.hoisted(() => ({
  listWorkspaceMembers: vi.fn(),
  listWorkspaceInvitations: vi.fn(),
  inviteWorkspaceMember: vi.fn(),
  cancelWorkspaceInvitation: vi.fn(),
  updateWorkspaceMember: vi.fn(),
}));
const auth = vi.hoisted(() => ({ me: null as unknown }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/api", () => api);
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ me: auth.me }) }));
vi.mock("@/components/ui", () => ({
  ErrorNotice: ({ error }: { error: unknown }) => <div role="alert">{error instanceof Error ? error.message : "error"}</div>,
  LoadingBlock: ({ label }: { label: string }) => <div role="status">{label}</div>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => <header><h1>{title}</h1>{action}</header>,
  useToast: () => toast,
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a> }));

const me = {
  user: { id: "user-1", email: "owner@example.com" },
  workspace: { id: "workspace-1", role: "analyst" },
  effective_permissions: ["workspace.members.manage"],
  workspaces: [{ id: "workspace-1", name: "Analytics", slug: "analytics", role: "analyst" }],
};
const member = { workspace_id: "workspace-1", user_id: "user-1", email: "owner@example.com", display_name: "Owner", role: "analyst", status: "active", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const pending = { id: "inv-1", workspace_id: "workspace-1", email: "analyst@example.com", role: "analyst", status: "pending", expires_at: "2026-01-08T00:00:00Z", created_at: "2026-01-01T00:00:00Z" };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WorkspaceManagePage /></QueryClientProvider>);
}

describe("WorkspaceManagePage invitations", () => {
  beforeEach(() => {
    auth.me = me;
    vi.clearAllMocks();
    api.listWorkspaceMembers.mockResolvedValue({ members: [member] });
    api.listWorkspaceInvitations.mockResolvedValue({ invitations: [] });
    api.inviteWorkspaceMember.mockResolvedValue(pending);
    api.cancelWorkspaceInvitation.mockResolvedValue({ cancelled: true });
  });
  afterEach(cleanup);

  it("shows the invite action for an authorized user and opens/closes the dialog", async () => {
    renderPage();
    await screen.findByText("Owner");
    fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Analyst", { selector: "strong" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("rejects invalid email and does not call the API", async () => {
    renderPage();
    await screen.findByText("Owner");
    fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("valid email");
    expect(api.inviteWorkspaceMember).not.toHaveBeenCalled();
  });

  it("prevents duplicate submission and only confirms after the API resolves", async () => {
    let resolve!: (value: typeof pending) => void;
    api.inviteWorkspaceMember.mockReturnValue(new Promise((nextResolve) => { resolve = nextResolve; }));
    renderPage();
    await screen.findByText("Owner");
    fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " analyst@example.com " } });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    await waitFor(() => expect(api.inviteWorkspaceMember).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => resolve(pending));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Invitation sent."));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders pending invitations and cancels them", async () => {
    api.listWorkspaceInvitations.mockResolvedValue({ invitations: [pending] });
    renderPage();
    expect(await screen.findByText("analyst@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancelWorkspaceInvitation).toHaveBeenCalled());
    expect(api.cancelWorkspaceInvitation.mock.calls[0][0]).toBe("inv-1");
    expect(toast.success).toHaveBeenCalledWith("Invitation cancelled.");
  });

  it("rolls back a failed cancellation and reports the backend error", async () => {
    api.listWorkspaceInvitations.mockResolvedValue({ invitations: [pending] });
    api.cancelWorkspaceInvitation.mockRejectedValue(new Error("Invitation is no longer pending."));
    renderPage();
    expect(await screen.findByText("analyst@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invitation is no longer pending."));
    expect(screen.getByText("analyst@example.com")).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("Invitation is no longer pending.");
  });

  it("does not expose invitation actions without permission", () => {
    auth.me = { ...me, effective_permissions: [] };
    renderPage();
    expect(screen.queryByRole("button", { name: "Invite member" })).toBeNull();
  });
});
