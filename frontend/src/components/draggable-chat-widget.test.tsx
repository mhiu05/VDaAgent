import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraggableChatWidget } from "./draggable-chat-widget";

const api = vi.hoisted(() => ({
  listAllRuns: vi.fn(),
  streamQuestion: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/image", () => ({ default: ({ alt }: { alt?: string }) => <span aria-label={alt} /> }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/api", () => api);
vi.mock("@/lib/chat-history", () => ({
  createConversation: vi.fn((title = "Cuộc trò chuyện mới") => ({ id: "conv-test", title, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z", hasUploadedData: false })),
  getConversation: vi.fn(),
  getConversationSnapshot: vi.fn(),
  updateConversationSnapshot: vi.fn(),
  listConversations: vi.fn(() => []),
}));
vi.mock("@/components/answer-sources", () => ({ AnswerSources: () => null }));

const dataset = { id: "dataset-a", name: "Doanh thu", source_type: "file", source_ref: null, collection_name: null, last_profiled_at: null };
const run = { id: "run-a", dataset_id: dataset.id, dataset_name: dataset.name, run_name: "Tháng 1", version: 1, status: "completed", scan_mode: "full", row_count: 100, is_approximate: false, created_at: "2026-01-12T10:00:00Z" };

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DraggableChatWidget conversations={[]} onRemoveConversation={() => {}} />
    </QueryClientProvider>,
  );
}

describe("DraggableChatWidget", () => {
  afterEach(cleanup);

  beforeEach(() => {
    navigation.pathname = "/dashboard";
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    api.listAllRuns.mockReset();
    api.streamQuestion.mockReset();
    api.listAllRuns.mockResolvedValue([run]);
  });

  it("opens from the floating logo and selects a dataset before its completed run", async () => {
    renderWidget();

    const bubble = await screen.findByRole("button", { name: /trợ lý ai copilot/i });
    fireEvent.pointerDown(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 900, clientY: 700 });

    const datasetSelect = await screen.findByLabelText("Bộ dữ liệu") as HTMLSelectElement;
    const runSelect = screen.getByLabelText("Phiên bản chạy") as HTMLSelectElement;
    await waitFor(() => expect(datasetSelect.querySelectorAll("option")).toHaveLength(2));
    expect(screen.queryByText(/^Dataset:/i)).toBeNull();
    expect(screen.getByPlaceholderText(/chọn profile run để bắt đầu hỏi/i)).toBeTruthy();

    fireEvent.change(datasetSelect, { target: { value: dataset.id } });
    fireEvent.change(runSelect, { target: { value: run.id } });
    await waitFor(() => expect((screen.getByPlaceholderText(/hỏi ai về profile run đã chọn/i) as HTMLInputElement).disabled).toBe(false));
  });

  it("keeps the floating icon available on the legacy Chat route", async () => {
    navigation.pathname = "/chat";
    renderWidget();

    expect(await screen.findByRole("button", { name: /trợ lý ai copilot/i })).toBeTruthy();
  });

  it("brings a saved off-screen icon position back into the viewport", async () => {
    localStorage.setItem("p170_chat_widget_pos", JSON.stringify({ x: 99999, y: -99999 }));
    renderWidget();

    const bubble = await screen.findByRole("button", { name: /trợ lý ai copilot/i });
    const container = bubble.parentElement as HTMLDivElement;
    expect(Number.parseInt(container.style.left, 10)).toBeLessThanOrEqual(window.innerWidth - 72);
    expect(Number.parseInt(container.style.top, 10)).toBeGreaterThanOrEqual(16);
  });
});
