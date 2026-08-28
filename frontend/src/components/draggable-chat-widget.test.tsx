import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraggableChatWidget } from "./draggable-chat-widget";
import type { ChatConversation } from "@/lib/chat-history";

const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listDatasets: vi.fn(),
  listRuns: vi.fn(),
  streamQuestion: vi.fn(),
}));
const chatHistory = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversationSnapshot: vi.fn(),
  updateConversationSnapshot: vi.fn(),
  listConversations: vi.fn(() => [] as ChatConversation[]),
}));
const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/image", () => ({ default: ({ alt }: { alt?: string }) => <span aria-label={alt} /> }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/api", () => api);
vi.mock("@/lib/chat-history", () => chatHistory);
vi.mock("@/components/answer-sources", () => ({ AnswerSources: () => null }));

const dataset = { id: "dataset-a", name: "Doanh thu", source_type: "file", source_ref: null, collection_name: null, last_profiled_at: null };
const run = { id: "run-a", dataset_id: dataset.id, run_name: "Tháng 1", version: 1, status: "completed", scan_mode: "full", row_count: 100, is_approximate: false, created_at: "2026-01-12T10:00:00Z" };

function renderWidget(conversations: ChatConversation[] = [], onRemoveConversation: (conversation: ChatConversation) => boolean | void | Promise<boolean | void> = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DraggableChatWidget conversations={conversations} onRemoveConversation={onRemoveConversation} />
    </QueryClientProvider>,
  );
}

describe("DraggableChatWidget", () => {
  afterEach(cleanup);

  beforeEach(() => {
    navigation.pathname = "/dashboard";
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    api.listDatasets.mockReset();
    api.listRuns.mockReset();
    api.streamQuestion.mockReset();
    chatHistory.createConversation.mockReset();
    chatHistory.getConversationSnapshot.mockReset();
    chatHistory.updateConversationSnapshot.mockReset();
    chatHistory.listConversations.mockReset();
    chatHistory.listConversations.mockReturnValue([]);
    api.listDatasets.mockResolvedValue([dataset]);
    api.listRuns.mockResolvedValue([run]);
  });

  it("selects a dataset before loading its completed Profile Runs", async () => {
    renderWidget();

    const bubble = await screen.findByRole("button", { name: /trợ lý ai copilot/i });
    fireEvent.pointerDown(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 900, clientY: 700 });

    const datasetSelect = document.querySelector("#widget-profile-run-dataset") as HTMLSelectElement;
    const runSelect = document.querySelector("#widget-profile-run") as HTMLSelectElement;
    await waitFor(() => expect(datasetSelect.options).toHaveLength(2));
    expect(runSelect.disabled).toBe(true);

    fireEvent.change(datasetSelect, { target: { value: dataset.id } });
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledWith(dataset.id, expect.anything()));
    await waitFor(() => expect(runSelect.disabled).toBe(false));
    expect(runSelect.options).toHaveLength(2);

    fireEvent.change(runSelect, { target: { value: run.id } });
    expect((document.querySelector("form input[type='text']") as HTMLInputElement).disabled).toBe(false);
  });

  it("keeps the floating icon available on the legacy Chat route", async () => {
    navigation.pathname = "/chat";
    renderWidget();

    expect(await screen.findByRole("button", { name: /trợ lý ai copilot/i })).toBeTruthy();
  });

  it("prioritizes the profile route run over an older conversation context", async () => {
    navigation.pathname = `/profiles/${run.id}`;
    api.getProfile.mockResolvedValue({ dataset_id: dataset.id });
    const conversation: ChatConversation = { id: "conversation-1", title: "Cuộc trò chuyện 1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    chatHistory.listConversations.mockReturnValue([conversation]);
    chatHistory.getConversationSnapshot.mockReturnValue({
      messages: [{ id: "message-1", role: "agent", text: "Đã lưu" }],
      profile: null,
      datasetId: dataset.id,
      profileRunId: "older-run",
    });
    renderWidget([conversation]);

    const bubble = await screen.findByRole("button", { name: /trợ lý ai copilot/i });
    fireEvent.pointerDown(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 900, clientY: 700 });

    await waitFor(() => expect((document.querySelector("#widget-profile-run") as HTMLSelectElement).value).toBe(run.id));
  });

  it("keeps chat input disabled until a selected run is validated", async () => {
    navigation.pathname = `/profiles/${run.id}`;
    api.getProfile.mockResolvedValue({ dataset_id: dataset.id });
    api.listRuns.mockReturnValue(new Promise(() => {}));
    renderWidget();

    const bubble = await screen.findByRole("button", { name: /trợ lý ai copilot/i });
    fireEvent.pointerDown(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 900, clientY: 700 });

    const input = await screen.findByPlaceholderText(/chọn profile run để bắt đầu hỏi/i) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("keeps the active conversation when deletion is canceled", async () => {
    const first: ChatConversation = { id: "conversation-1", title: "Cuộc trò chuyện 1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    const second: ChatConversation = { id: "conversation-2", title: "Cuộc trò chuyện 2", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };
    chatHistory.listConversations.mockReturnValue([first, second]);
    const onRemoveConversation = vi.fn().mockResolvedValue(false);
    renderWidget([second], onRemoveConversation);

    const bubble = document.querySelector("button[title]") as HTMLButtonElement;
    expect(bubble).toBeTruthy();
    fireEvent.pointerDown(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.click(document.querySelector("aside button[title]") as HTMLButtonElement);

    const deleteButton = screen.getByRole("button", { name: `Xóa ${second.title}` });
    fireEvent.click(deleteButton);
    await waitFor(() => expect(onRemoveConversation).toHaveBeenCalledWith(second));
    expect((deleteButton.parentElement as HTMLDivElement).style.background).toBe("rgb(239, 246, 255)");
  });

  it("clears profile context when opening a conversation without saved context", async () => {
    const first: ChatConversation = { id: "conversation-1", title: "Cuộc trò chuyện 1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    const second: ChatConversation = { id: "conversation-2", title: "Cuộc trò chuyện 2", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };
    chatHistory.listConversations.mockReturnValue([first, second]);
    chatHistory.getConversationSnapshot.mockImplementation((id: string) => id === first.id
      ? { messages: [{ id: "message-1", role: "agent", text: "Đã lưu" }], profile: null, datasetId: dataset.id, profileRunId: run.id }
      : { messages: [{ id: "message-2", role: "agent", text: "Chưa chọn" }], profile: null, datasetId: null, profileRunId: null });
    renderWidget([first, second]);

    const bubble = document.querySelector("button[title]") as HTMLButtonElement;
    fireEvent.pointerDown(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerUp(bubble, { pointerId: 1, clientX: 900, clientY: 700 });
    await waitFor(() => expect((document.querySelector("#widget-profile-run-dataset") as HTMLSelectElement).value).toBe(dataset.id));

    fireEvent.click(document.querySelector("aside button[title]") as HTMLButtonElement);
    const deleteButton = screen.getByRole("button", { name: `Xóa ${second.title}` });
    fireEvent.click(deleteButton.parentElement?.querySelector("div") as HTMLDivElement);
    await waitFor(() => expect((document.querySelector("#widget-profile-run-dataset") as HTMLSelectElement).value).toBe(""));
    expect((document.querySelector("#widget-profile-run") as HTMLSelectElement).value).toBe("");
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
