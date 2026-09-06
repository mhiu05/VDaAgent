import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectorsPage from "./page";

const api = vi.hoisted(() => ({
  listConnectors: vi.fn(),
  testSavedConnector: vi.fn(),
  deleteConnector: vi.fn(),
  deleteGoogleDriveConnection: vi.fn(),
}));
const dialog = vi.hoisted(() => ({ confirm: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
let deleteSucceeded = false;

vi.mock("@/lib/api", () => api);
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ authenticated: true, workspaceId: "workspace-1" }) }));
vi.mock("@/components/connection-wizard", () => ({ ConnectionWizard: () => null }));
vi.mock("@/components/connector-detail-dialog", () => ({
  ConnectorDetailDialog: ({ connector, onDisconnect }: { connector: { id: string } | null; onDisconnect: (id: string) => void }) => connector ? <div role="dialog"><button type="button" onClick={() => onDisconnect(connector.id)}>Xóa kết nối</button></div> : null,
}));
vi.mock("@/components/ui", () => ({
  ErrorNotice: ({ error }: { error: unknown }) => <div role="alert">{error instanceof Error ? error.message : "error"}</div>,
  LoadingButton: ({ children, busy: _busy, ...props }: { children: React.ReactNode; busy?: boolean; [key: string]: unknown }) => <button {...props}>{children}</button>,
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header>,
  useDialog: () => dialog,
  useToast: () => toast,
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a> }));

const connector = {
  id: "datasource:connector-1",
  provider: "mongodb",
  category: "data",
  name: "Mongo orders",
  owner_scope: "workspace",
  status: "connected",
  safe_target: { host: "localhost", database: "app", object: "orders" },
  version: 1,
  dataset_count: 0,
  can_test: true,
  can_edit: true,
  can_disconnect: true,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConnectorsPage /></QueryClientProvider>);
}

describe("ConnectorsPage deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSucceeded = false;
    dialog.confirm.mockResolvedValue(true);
    api.listConnectors.mockImplementation(() => Promise.resolve({
      connectors: deleteSucceeded ? [] : [connector],
      available: [],
    }));
    api.deleteConnector.mockImplementation(async () => {
      deleteSucceeded = true;
      return { id: connector.id, deleted: true };
    });
  });

  afterEach(cleanup);

  it("deletes a connector and removes its card from the list", async () => {
    renderPage();
    const card = await screen.findByRole("button", { name: "Mở chi tiết Mongo orders" });

    fireEvent.click(card);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Xóa kết nối" }));
    await waitFor(() => expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "Xác nhận xóa kết nối",
      confirmLabel: "Xóa kết nối",
    })));
    await waitFor(() => expect(api.deleteConnector).toHaveBeenCalledWith(connector.id));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mở chi tiết Mongo orders" })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Đã xóa kết nối khỏi workspace.");
  });

  it("restores the card and reports an API failure", async () => {
    api.deleteConnector.mockRejectedValue(new Error("Connector đang được sử dụng."));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mở chi tiết Mongo orders" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Xóa kết nối" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Connector đang được sử dụng."));
    expect(screen.getByRole("button", { name: "Mở chi tiết Mongo orders" })).toBeTruthy();
  });
});
