"use client";

import React, { type MouseEvent, type ReactNode } from "react";

import { AnswerSources } from "@/components/answer-sources";
import { ChatMessageActions, type ChatMessageActionsProps } from "@/components/chat-message-actions";
import type { ChatMessage } from "@/lib/chat-history";

function EvidenceBadge({ message }: { message: ChatMessage }) {
  const status = message.evidenceStatus || message.answerEnvelope?.evidence_status;
  const approximate = message.isApproximate ?? message.answerEnvelope?.is_approximate;
  if (!status && !approximate) return null;
  const label = status === "verified"
    ? "Verified"
    : status === "profile_only"
      ? "Profile-based"
      : "Insufficient evidence";
  return (
    <div className="chat-trust-signals" aria-label={`Evidence status: ${label}`}>
      {status && <span className={`chat-trust-badge ${status}`}>{label}</span>}
      {approximate && <span className="chat-trust-badge approximate">Approximate</span>}
    </div>
  );
}

function CitationLinks({ citations }: { citations: NonNullable<ChatMessage["answerEnvelope"]>["findings"][number]["citations"] }) {
  if (!citations.length) return null;
  const openCitation = (event: MouseEvent<HTMLAnchorElement>, citationId: string) => {
    event.preventDefault();
    const target = document.getElementById(`citation-${citationId}`);
    const disclosure = target?.closest("details") as HTMLDetailsElement | null;
    const answerDisclosure = target?.closest(".chat-answer")?.querySelector(".chat-answer-details") as HTMLDetailsElement | null;
    if (answerDisclosure) answerDisclosure.open = true;
    if (disclosure) disclosure.open = true;
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  return <>{citations.map((citation) => (
    <a
      className="chat-claim-citation"
      href={`#citation-${citation.citation_id}`}
      key={`${citation.citation_id}-${citation.metric || citation.field || "source"}`}
      aria-label={`Open evidence ${citation.citation_id}`}
      onClick={(event) => openCitation(event, citation.citation_id)}
    >
      [{citation.citation_id}]
    </a>
  ))}</>;
}

export function ChatAnswer({
  message,
  fallback,
  actions,
  onClarificationOption,
}: {
  message: ChatMessage;
  fallback: ReactNode;
  actions?: Omit<ChatMessageActionsProps, "message">;
  onClarificationOption?: (option: { id: string; label: string }) => void;
}) {
  const envelope = message.answerEnvelope;
  const dispatchAction = (action: string, extra: Record<string, unknown> = {}) => {
    window.dispatchEvent(new CustomEvent("p170-chat-message-action", {
      detail: { messageId: message.id, action, ...extra },
    }));
  };
  const resolvedActions = actions || {
    onRetry: () => dispatchAction("retry"),
    onRegenerate: () => dispatchAction("regenerate"),
    onAskDeeper: () => dispatchAction("deepen"),
    onFeedback: (polarity: "helpful" | "not_helpful", reasonCode?: string) => dispatchAction("feedback", { polarity, reasonCode }),
    onRecoveryAction: (recoveryAction: string) => dispatchAction("recovery", { recoveryAction }),
  };
  if (!envelope || envelope.schema_version !== "v2") {
    return <>{fallback}<EvidenceBadge message={message} /><AnswerSources sources={message.sources} /><ChatMessageActions message={message} {...resolvedActions} /></>;
  }
  const noEvidence = envelope.evidence_status === "no_evidence";
  const answerRowCount = envelope.provenance.row_count ?? message.context?.rowCount;
  return (
    <section className="chat-answer" aria-label="Structured answer">
      <EvidenceBadge message={message} />
      {envelope.summary && <div className="chat-answer-summary"><h4>Conclusion</h4><p>{envelope.summary}</p></div>}
      {envelope.findings.length > 0 && <div className="chat-answer-findings"><h5>Key findings</h5><ol>{envelope.findings.map((finding, index) => (
        <li key={`${finding.text}-${index}`}>{finding.text.replace(/\s*\[S\d+\]/g, "")} <CitationLinks citations={finding.citations} /></li>
      ))}</ol></div>}
      {(message.sources?.length || envelope.limitations.length || envelope.actions.length) && <details className="chat-answer-details" open={noEvidence}>
        <summary>{noEvidence ? "What is missing and what to do next" : "Evidence and limitations"}</summary>
        {message.sources?.length ? <AnswerSources sources={message.sources} /> : null}
        {envelope.limitations.length > 0 && <div><h5>Limitations</h5><ul>{envelope.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {envelope.actions.length > 0 && <div><h5>Next steps</h5><ul>{envelope.actions.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      </details>}
      {(envelope.provenance.profile_run_id || message.context?.profileRunId) && <details className="chat-answer-context" open>
        <summary>Answer context</summary>
        <div className="chat-context-chips">
          {envelope.provenance.dataset_name || message.context?.datasetName ? <span>Dataset: {envelope.provenance.dataset_name || message.context?.datasetName}</span> : null}
          <span>Profile Run: {envelope.provenance.profile_run_label || envelope.provenance.profile_run_id || message.context?.profileRunLabel || message.context?.profileRunId}</span>
          {(envelope.provenance.row_scope || message.context?.rowScope) && <span>{envelope.provenance.row_scope || message.context?.rowScope} scope</span>}
          {answerRowCount !== null && answerRowCount !== undefined && <span>{answerRowCount.toLocaleString()} rows</span>}
          {(envelope.provenance.proposal_status || message.context?.proposalStatus) && <span>{envelope.provenance.proposal_status || message.context?.proposalStatus}</span>}
          {(envelope.provenance.profiled_at || message.context?.profiledAt) && <span>Profiled {new Date(envelope.provenance.profiled_at || message.context?.profiledAt || "").toLocaleDateString()}</span>}
        </div>
        {envelope.provenance.scan_mode && <span> · {envelope.provenance.scan_mode} scan</span>}
      </details>}
      {envelope.clarification && <section className="chat-clarification" aria-label="Clarification required">
        <h5>{envelope.clarification.question}</h5>
        <div>{envelope.clarification.options.map((option) => <button type="button" key={option.id} onClick={() => onClarificationOption ? onClarificationOption(option) : dispatchAction("clarify", { option })}>{option.label}</button>)}</div>
      </section>}
      <ChatMessageActions message={message} {...resolvedActions} />
    </section>
  );
}
