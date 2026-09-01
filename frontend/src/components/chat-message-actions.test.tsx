import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatMessageActions } from "./chat-message-actions";

describe("ChatMessageActions", () => {
  const assistant = {
    id: "answer-1",
    role: "agent" as const,
    text: "The Profile Run contains 10 rows. [S1]",
    answerEnvelope: {
      schema_version: "v2" as const,
      summary: "The Profile Run contains 10 rows. [S1]",
      findings: [], limitations: [], actions: [], evidence_status: "verified" as const,
      is_approximate: false, provenance: { profile_run_id: "run-1", agent_run_id: "agent-run-1" },
    },
  };

  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("copies only user-facing structured content and gives non-intrusive feedback", async () => {
    render(<ChatMessageActions message={assistant} />);

    fireEvent.click(screen.getByRole("button", { name: "Sao chép câu trả lời" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Kết luận"));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(expect.stringContaining("agent-run-1"));
    expect((await screen.findByRole("button", { name: "Sao chép câu trả lời" })).textContent).toBe("Đã sao chép");
  });

  it("prevents rapid duplicate retry activation and exposes keyboard-accessible feedback", () => {
    const retry = vi.fn();
    const feedback = vi.fn();
    render(<ChatMessageActions message={{ ...assistant, status: "error", recoveryActions: ["retry"] }} onRetry={retry} onFeedback={feedback} />);

    const retryButton = screen.getByRole("button", { name: "Thử lại yêu cầu này" });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);

    // Retry failures keep the action bar compact; unrelated feedback actions
    // are not offered until there is a completed answer.
    expect(screen.queryByRole("button", { name: "Hữu ích" })).toBeNull();
  });

  it("renders only the recovery CTA supplied by the typed failure", () => {
    const recover = vi.fn();
    const view = render(<ChatMessageActions message={{ ...assistant, status: "error", recoveryActions: ["open_profiling_status"] }} onRecoveryAction={recover} />);

    fireEvent.click(screen.getByRole("button", { name: "Mở trạng thái profiling" }));

    expect(recover).toHaveBeenCalledWith("open_profiling_status");
    expect(view.container.querySelector('[aria-label="Thử lại yêu cầu này"]')).toBeNull();
  });

  it("binds feedback once to the completed assistant message", () => {
    const feedback = vi.fn();
    render(<ChatMessageActions message={assistant} onFeedback={feedback} />);

    fireEvent.click(screen.getByText("Thêm"));
    const helpful = screen.getByRole("button", { name: "Hữu ích" });
    fireEvent.click(helpful);
    fireEvent.click(helpful);

    expect(feedback).toHaveBeenCalledTimes(1);
    expect(feedback).toHaveBeenCalledWith("helpful");
  });

  it("offers edit-and-resend for a user question", () => {
    const edit = vi.fn();
    render(<ChatMessageActions message={{ id: "user-1", role: "user", text: "How many rows?" }} onEditUserQuestion={edit} />);

    const editButton = screen.getByRole("button", { name: "Chỉnh sửa và gửi lại câu hỏi" });
    editButton.focus();
    expect(document.activeElement).toBe(editButton);
    fireEvent.click(editButton);
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
