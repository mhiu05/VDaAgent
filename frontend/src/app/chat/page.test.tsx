import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "./page";

const api = vi.hoisted(() => ({
  createProfile: vi.fn(),
  getProfile: vi.fn(),
  listDatasets: vi.fn(),
  listRuns: vi.fn(),
  streamQuestion: vi.fn(),
  uploadDataset: vi.fn(),
  waitForProfilingJob: vi.fn(),
}));
const chatHistory = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  getConversationSnapshot: vi.fn(),
  listConversations: vi.fn(),
  updateConversationSnapshot: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("@/lib/chat-history", () => chatHistory);
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/answer-sources", () => ({ AnswerSources: () => null }));
vi.mock("@/components/ui", () => ({
  LoadingButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  ProgressSteps: () => null,
}));

const conversation = { id: "conversation-1", title: "Conversation", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const profile = { profile_run_id: "run-1", dataset_id: "dataset-1", dataset_name: "Revenue", run_name: "January", pending_proposals: 0, column_stats: {}, version: 1 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function renderChat() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ChatPage /></QueryClientProvider>);
}

describe("ChatPage SSE message lifecycle", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/chat?conversation=conversation-1");
    Element.prototype.scrollTo = vi.fn();
    Object.values(api).forEach((mock) => mock.mockReset());
    Object.values(chatHistory).forEach((mock) => mock.mockReset());
    api.listDatasets.mockResolvedValue([]);
    api.listRuns.mockResolvedValue([]);
    api.getProfile.mockResolvedValue(profile);
    chatHistory.listConversations.mockReturnValue([conversation]);
    chatHistory.getConversation.mockReturnValue(conversation);
    chatHistory.getConversationSnapshot.mockReturnValue({ messages: [], profile, datasetId: profile.dataset_id, profileRunId: profile.profile_run_id, sources: [] });
  });

  it("adds an empty assistant placeholder, then streams into that same message", async () => {
    const response = deferred<void>();
    let emit: ((event: { event: string; data?: unknown }) => void) | undefined;
    api.streamQuestion.mockImplementation((_payload: unknown, callback: (event: { event: string; data?: unknown }) => void) => {
      emit = callback;
      return response.promise;
    });
    const view = renderChat();

    const composer = await screen.findByPlaceholderText(/đặt câu hỏi về dataset/i);
    fireEvent.change(composer, { target: { value: "What changed?" } });
    fireEvent.click(screen.getByRole("button", { name: /gửi câu hỏi/i }));

    expect(screen.getByText("What changed?")).toBeTruthy();
    expect(screen.getAllByText(/đang tìm evidence/i).length).toBeGreaterThan(0);
    expect(view.container.querySelectorAll(".agent-message.agent")).toHaveLength(2);

    await act(async () => { emit?.({ event: "token", data: { text: "Verified answer" } }); });
    expect(screen.getAllByText("Verified answer")).toHaveLength(1);

    await act(async () => {
      emit?.({ event: "done", data: {} });
      response.resolve();
    });
    await waitFor(() => expect(screen.getAllByText("Verified answer")).toHaveLength(1));
    expect(view.container.querySelectorAll(".agent-message.agent")).toHaveLength(2);
  });
});
