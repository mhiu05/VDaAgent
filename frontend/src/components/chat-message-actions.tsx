"use client";

import React, { useState } from "react";

import type { ChatMessage } from "@/lib/chat-history";

export type ChatMessageActionsProps = {
  message: ChatMessage;
  busy?: boolean;
  onRetry?: () => void;
  onRegenerate?: () => void;
  onAskDeeper?: () => void;
  onFeedback?: (polarity: "helpful" | "not_helpful", reasonCode?: string) => void;
  onEditUserQuestion?: () => void;
  onRecoveryAction?: (action: string) => void;
};

const recoveryActionLabels: Record<string, string> = {
  narrow_question: "Thu hẹp câu hỏi",
  clarify: "Làm rõ câu hỏi",
  open_profiling_status: "Mở trạng thái profiling",
  run_full_profile: "Chọn Profile Run hoàn chỉnh",
  switch_context: "Chọn ngữ cảnh khác",
  switch_workspace: "Chọn workspace khác",
  refresh_session: "Làm mới phiên đăng nhập",
};

export function answerCopyText(message: ChatMessage): string {
  const envelope = message.answerEnvelope;
  if (!envelope) return message.text;
  const sections: string[] = [];
  if (envelope.summary) sections.push(`Kết luận\n${envelope.summary}`);
  if (envelope.findings.length) {
    sections.push(`Phát hiện chính\n${envelope.findings.map((finding) => `- ${finding.text}`).join("\n")}`);
  }
  if (envelope.limitations.length) sections.push(`Giới hạn\n${envelope.limitations.map((item) => `- ${item}`).join("\n")}`);
  if (envelope.actions.length) sections.push(`Bước tiếp theo\n${envelope.actions.map((item) => `- ${item}`).join("\n")}`);
  return sections.join("\n\n") || message.text;
}

export function ChatMessageActions({
  message,
  busy = false,
  onRetry,
  onRegenerate,
  onAskDeeper,
  onFeedback,
  onEditUserQuestion,
  onRecoveryAction,
}: ChatMessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [actionPending, setActionPending] = useState(false);

  if (message.role === "user") {
    return onEditUserQuestion ? (
      <div className="chat-message-actions user-actions">
        <button type="button" onClick={onEditUserQuestion} aria-label="Chỉnh sửa và gửi lại câu hỏi">Chỉnh sửa &amp; gửi lại</button>
      </div>
    ) : null;
  }

  const failed = message.status === "error" || message.status === "cancelled";
  const canCopy = !failed && Boolean(message.text.trim());
  const allowedRecovery = new Set(message.recoveryActions || (failed ? ["retry"] : []));
  const canRetry = Boolean(onRetry) && (!failed || allowedRecovery.has("retry") || allowedRecovery.has("reconnect"));
  const directRecoveryActions = [...allowedRecovery].filter((action) => action !== "retry" && action !== "reconnect" && recoveryActionLabels[action]);
  const copy = async () => {
    if (!canCopy || busy) return;
    try {
      await navigator.clipboard?.writeText(answerCopyText(message));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be unavailable in an embedded browser. The
      // button remains non-destructive and no internal JSON is exposed.
      setCopied(false);
    }
  };
  const sendFeedback = (polarity: "helpful" | "not_helpful") => {
    if (busy || actionPending || feedback || !onFeedback) return;
    setActionPending(true);
    setFeedback(polarity);
    if (polarity === "not_helpful" && feedbackReason) onFeedback(polarity, feedbackReason);
    else onFeedback(polarity);
  };
  const activate = (action?: () => void) => {
    if (busy || actionPending || !action) return;
    setActionPending(true);
    action();
  };

  return (
    <div className="chat-message-actions" aria-label="Thao tác với tin nhắn">
      {canCopy && <button type="button" onClick={() => void copy()} disabled={busy} aria-label="Sao chép câu trả lời">{copied ? "Đã sao chép" : "Sao chép"}</button>}
      {failed && canRetry && <button type="button" onClick={() => activate(onRetry)} disabled={busy || actionPending} aria-label="Thử lại yêu cầu này">Thử lại</button>}
      {failed && onRecoveryAction && directRecoveryActions.map((action) => <button key={action} type="button" onClick={() => onRecoveryAction(action)} disabled={busy}>
        {recoveryActionLabels[action]}
      </button>)}
      {(!failed && (onRegenerate || onAskDeeper || onFeedback || canRetry)) && (
        <details className="chat-message-action-menu">
          <summary aria-label="Thêm thao tác với tin nhắn">Thêm</summary>
          <div>
            {!failed && canRetry && <button type="button" onClick={() => activate(onRetry)} disabled={busy || actionPending}>Thử lại</button>}
            {!failed && onRegenerate && <button type="button" onClick={() => activate(onRegenerate)} disabled={busy || actionPending}>Tạo lại câu trả lời</button>}
            {!failed && onAskDeeper && <button type="button" onClick={() => activate(onAskDeeper)} disabled={busy || actionPending}>Phân tích sâu hơn</button>}
            {!failed && onFeedback && <span className="chat-feedback-actions" aria-label="Đánh giá câu trả lời">
              <select
                aria-label="Lý do đánh giá không bắt buộc"
                value={feedbackReason}
                onChange={(event) => setFeedbackReason(event.target.value)}
                disabled={busy || actionPending || Boolean(feedback)}
              >
                <option value="">Lý do (không bắt buộc)</option>
                <option value="incorrect">Không chính xác</option>
                <option value="missing_detail">Thiếu chi tiết</option>
                <option value="too_verbose">Quá dài</option>
                <option value="too_short">Quá ngắn</option>
                <option value="wrong_context">Sai ngữ cảnh</option>
                <option value="bad_citation">Citation không phù hợp</option>
                <option value="slow">Phản hồi chậm</option>
                <option value="did_not_answer">Chưa trả lời câu hỏi</option>
                <option value="other">Khác</option>
              </select>
              <button type="button" onClick={() => sendFeedback("helpful")} disabled={busy || actionPending || Boolean(feedback)} aria-pressed={feedback === "helpful"}>Hữu ích</button>
              <button type="button" onClick={() => sendFeedback("not_helpful")} disabled={busy || actionPending || Boolean(feedback)} aria-pressed={feedback === "not_helpful"}>Chưa hữu ích</button>
            </span>}
          </div>
        </details>
      )}
    </div>
  );
}
