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
  narrow_question: "Narrow the question",
  clarify: "Clarify the question",
  open_profiling_status: "Open profile status",
  run_full_profile: "Choose a complete profile",
  switch_context: "Choose another context",
  switch_workspace: "Choose another workspace",
  refresh_session: "Refresh session",
};

export function answerCopyText(message: ChatMessage): string {
  const envelope = message.answerEnvelope;
  if (!envelope) return message.text;
  const sections: string[] = [];
  if (envelope.summary) sections.push(`Conclusion\n${envelope.summary}`);
  if (envelope.findings.length) {
    sections.push(`Key findings\n${envelope.findings.map((finding) => `- ${finding.text}`).join("\n")}`);
  }
  if (envelope.limitations.length) sections.push(`Limitations\n${envelope.limitations.map((item) => `- ${item}`).join("\n")}`);
  if (envelope.actions.length) sections.push(`Next steps\n${envelope.actions.map((item) => `- ${item}`).join("\n")}`);
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
        <button type="button" onClick={onEditUserQuestion} aria-label="Edit and resend this question">Edit &amp; resend</button>
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
    <div className="chat-message-actions" aria-label="Message actions">
      {canCopy && <button type="button" onClick={() => void copy()} disabled={busy} aria-label="Copy answer">{copied ? "Copied" : "Copy"}</button>}
      {failed && canRetry && <button type="button" onClick={() => activate(onRetry)} disabled={busy || actionPending} aria-label="Retry this request">Retry</button>}
      {failed && onRecoveryAction && directRecoveryActions.map((action) => <button key={action} type="button" onClick={() => onRecoveryAction(action)} disabled={busy}>
        {recoveryActionLabels[action]}
      </button>)}
      {(!failed && (onRegenerate || onAskDeeper || onFeedback || canRetry)) && (
        <details className="chat-message-action-menu">
          <summary aria-label="More message actions">More</summary>
          <div>
            {!failed && canRetry && <button type="button" onClick={() => activate(onRetry)} disabled={busy || actionPending}>Retry</button>}
            {!failed && onRegenerate && <button type="button" onClick={() => activate(onRegenerate)} disabled={busy || actionPending}>Regenerate</button>}
            {!failed && onAskDeeper && <button type="button" onClick={() => activate(onAskDeeper)} disabled={busy || actionPending}>Ask deeper</button>}
            {!failed && onFeedback && <span className="chat-feedback-actions" aria-label="Answer feedback">
              <select
                aria-label="Optional feedback reason"
                value={feedbackReason}
                onChange={(event) => setFeedbackReason(event.target.value)}
                disabled={busy || actionPending || Boolean(feedback)}
              >
                <option value="">Reason (optional)</option>
                <option value="incorrect">Incorrect</option>
                <option value="missing_detail">Missing detail</option>
                <option value="too_verbose">Too verbose</option>
                <option value="too_short">Too short</option>
                <option value="wrong_context">Wrong context</option>
                <option value="bad_citation">Bad citation</option>
                <option value="slow">Slow</option>
                <option value="did_not_answer">Did not answer</option>
                <option value="other">Other</option>
              </select>
              <button type="button" onClick={() => sendFeedback("helpful")} disabled={busy || actionPending || Boolean(feedback)} aria-pressed={feedback === "helpful"}>Helpful</button>
              <button type="button" onClick={() => sendFeedback("not_helpful")} disabled={busy || actionPending || Boolean(feedback)} aria-pressed={feedback === "not_helpful"}>Not helpful</button>
            </span>}
          </div>
        </details>
      )}
    </div>
  );
}
