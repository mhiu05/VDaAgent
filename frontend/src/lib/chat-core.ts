import type { AnswerSource } from "@/lib/types";
import type { ChatAnswerEnvelope, ChatLifecycle, ChatMessage, ChatSuggestion } from "@/lib/chat-history";
import type { SseEvent } from "@/lib/sse";

export type ChatStreamStage =
  | "preparing"
  | "classifying"
  | "reading_evidence"
  | "retrieving"
  | "running_tool"
  | "validating"
  | "preparing_answer"
  | "completed";

export type ChatStreamEvent = SseEvent & {
  data?: {
    schema_version?: "chat_stream.v1";
    request_id?: string;
    stage?: ChatStreamStage | string;
    detail?: string;
    text?: string;
    delivery?: "validated_replay" | string;
    sources?: AnswerSource[];
    source?: AnswerSource;
    answer_envelope?: ChatAnswerEnvelope;
    evidence_status?: "verified" | "profile_only" | "no_evidence";
    is_approximate?: boolean;
    agent_run_id?: string;
    message_id?: string;
    suggestions?: ChatSuggestion[];
    verification?: Record<string, unknown>;
    state?: "failed" | "cancelled" | "timeout";
    code?: string;
    recovery_actions?: string[];
    answer_detail?: "quick" | "standard" | "deep";
    answerability?: "answerable" | "needs_clarification" | "insufficient_evidence";
    clarification?: ChatAnswerEnvelope["clarification"];
  };
};

export type ChatStreamState = {
  requestId: string;
  text: string;
  sources: AnswerSource[];
  lifecycle: ChatLifecycle;
  statusDetail?: string;
  evidenceStatus?: "verified" | "profile_only" | "no_evidence";
  isApproximate?: boolean;
  agentRunId?: string;
  answerEnvelope?: ChatAnswerEnvelope;
  suggestions?: ChatSuggestion[];
  verification?: Record<string, unknown>;
  errorCode?: string;
  recoveryActions?: string[];
  seenEventIds: Set<string>;
};

const lifecycleForStage: Record<string, ChatLifecycle> = {
  preparing: "sending",
  classifying: "routing",
  reading_evidence: "retrieving",
  retrieving: "retrieving",
  running_tool: "computing",
  validating: "validating",
  preparing_answer: "answering",
  completed: "completed",
};

const defaultStatus: Record<string, string> = {
  preparing: "Preparing",
  classifying: "Classifying question",
  reading_evidence: "Reading profile evidence",
  retrieving: "Retrieving sources",
  running_tool: "Running calculation",
  validating: "Validating evidence",
  preparing_answer: "Preparing answer",
  completed: "Completed",
};

export function newChatMessage(
  role: ChatMessage["role"],
  text: string,
  options: Omit<ChatMessage, "id" | "role" | "text"> = {},
): ChatMessage {
  return { id: crypto.randomUUID(), role, text, ...options };
}

export function initialChatStream(requestId: string): ChatStreamState {
  return {
    requestId,
    text: "",
    sources: [],
    lifecycle: "sending",
    seenEventIds: new Set(),
  };
}

function sourcesFromEvent(data: NonNullable<ChatStreamEvent["data"]>, current: AnswerSource[]): AnswerSource[] {
  if (Array.isArray(data.sources)) return data.sources;
  if (data.source && typeof data.source === "object") {
    const sourceCitationId = "citation_id" in data.source ? data.source.citation_id : undefined;
    const duplicate = current.some((item) => (
      "citation_id" in item && item.citation_id && item.citation_id === sourceCitationId
    ));
    return duplicate ? current : [...current, data.source];
  }
  return current;
}

/** Shared, idempotent SSE reducer for the page and floating widget. */
export function reduceChatStream(state: ChatStreamState, raw: SseEvent): ChatStreamState {
  const event = raw as ChatStreamEvent;
  if (event.id && state.seenEventIds.has(event.id)) return state;
  const seenEventIds = new Set(state.seenEventIds);
  if (event.id) seenEventIds.add(event.id);
  const data = event.data && typeof event.data === "object" ? event.data : {};
  if (data.request_id && data.request_id !== state.requestId) return state;
  const next = { ...state, seenEventIds };

  if (event.event === "status") {
    const stage = String(data.stage || "");
    return {
      ...next,
      lifecycle: lifecycleForStage[stage] || state.lifecycle,
      statusDetail: data.detail || defaultStatus[stage] || state.statusDetail,
    };
  }
  if (event.event === "token") {
    return {
      ...next,
      text: state.text + String(data.text || ""),
      lifecycle: "answering",
      statusDetail: undefined,
    };
  }
  if (event.event === "source") {
    return { ...next, sources: sourcesFromEvent(data, state.sources) };
  }
  if (event.event === "meta") {
    return {
      ...next,
      agentRunId: data.agent_run_id || state.agentRunId,
      evidenceStatus: data.evidence_status || state.evidenceStatus,
      isApproximate: typeof data.is_approximate === "boolean" ? data.is_approximate : state.isApproximate,
      verification: data.verification || state.verification,
    };
  }
  if (event.event === "suggestions") {
    return {
      ...next,
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : state.suggestions,
    };
  }
  if (event.event === "done") {
    const envelope = data.answer_envelope;
    return {
      ...next,
      lifecycle: envelope?.evidence_status === "no_evidence" ? "no_evidence" : "completed",
      statusDetail: undefined,
      sources: sourcesFromEvent(data, state.sources),
      agentRunId: data.agent_run_id || envelope?.provenance?.agent_run_id || state.agentRunId,
      evidenceStatus: data.evidence_status || envelope?.evidence_status || state.evidenceStatus,
      isApproximate: typeof data.is_approximate === "boolean" ? data.is_approximate : envelope?.is_approximate ?? state.isApproximate,
      answerEnvelope: envelope || state.answerEnvelope,
      errorCode: undefined,
      recoveryActions: undefined,
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : state.suggestions,
      verification: data.verification || state.verification,
    };
  }
  if (event.event === "error") {
    const failure = data.state || "failed";
    return {
      ...next,
      lifecycle: failure === "cancelled" ? "cancelled" : failure === "timeout" ? "timeout" : "failed",
      statusDetail: typeof data.detail === "string" ? data.detail : "The agent could not complete the response.",
      errorCode: typeof data.code === "string" ? data.code : state.errorCode,
      recoveryActions: Array.isArray(data.recovery_actions)
        ? data.recovery_actions.filter((item): item is string => typeof item === "string")
        : state.recoveryActions,
    };
  }
  return next;
}

export function chatMessagePatch(state: ChatStreamState): Partial<ChatMessage> {
  const terminalError = ["failed", "timeout"].includes(state.lifecycle);
  return {
    text: state.text,
    sources: state.sources,
    lifecycle: state.lifecycle,
    status: terminalError ? "error" : state.lifecycle === "cancelled" ? "cancelled" : state.lifecycle === "completed" || state.lifecycle === "no_evidence" ? undefined : "streaming",
    statusDetail: state.statusDetail,
    requestId: state.requestId,
    agentRunId: state.agentRunId,
    evidenceStatus: state.evidenceStatus,
    isApproximate: state.isApproximate,
    answerEnvelope: state.answerEnvelope,
    suggestions: state.suggestions,
    verification: state.verification,
    errorCode: state.errorCode,
    recoveryActions: state.recoveryActions,
  };
}

export function chatHistory(messages: ChatMessage[], limit = 12): Array<{ role: "user" | "agent"; text: string; profile_run_id?: string; context_version_id?: string }> {
  return messages
    .filter((message) => (message.role === "user" || message.role === "agent") && message.text.trim())
    .slice(-limit)
    .map((message) => {
      const provenance = message.answerEnvelope?.provenance;
      const profileRunId = provenance?.profile_run_id || message.context?.profileRunId;
      const contextVersionId = provenance?.context_version_id || message.context?.contextVersionId;
      return {
        role: message.role,
        text: message.text.slice(0, 2000),
        ...(profileRunId ? { profile_run_id: profileRunId } : {}),
        ...(contextVersionId ? { context_version_id: contextVersionId } : {}),
      };
    });
}
