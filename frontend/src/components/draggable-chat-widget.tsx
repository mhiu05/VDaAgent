"use client";

import React, { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { ApiError, getChatSuggestions, getProfile, streamQuestion, submitChatFeedback } from "@/lib/api";
import type { AnswerSource, Profile } from "@/lib/types";
import { createConversation, getConversationSnapshot, updateConversationSnapshot, listConversations, type ChatContextSnapshot, type ChatConversation, type ChatMessage, type ChatSuggestion } from "@/lib/chat-history";
import { ChatAnswer } from "@/components/chat-answer";
import { ChatMessageActions } from "@/components/chat-message-actions";
import { ChatProgress } from "@/components/chat-progress";
import { MarkdownContent } from "@/components/markdown";
import { chatHistory, chatMessagePatch, initialChatStream, reduceChatStream } from "@/lib/chat-core";
import { ProfileRunPicker } from "@/components/profile-run-picker";

const starters = [
  "Tóm tắt chất lượng dữ liệu hiện tại",
  "Cột nào có rủi ro PII hoặc null cao?",
  "Có cột nào phù hợp làm candidate key không?",
];
const WIDGET_SIZE = 56;
const WIDGET_MARGIN = 16;

function widgetContext(datasetId: string, profileRunId: string, profile?: Profile | null): ChatContextSnapshot | undefined {
  if (!profileRunId) return undefined;
  return {
    datasetId: datasetId || undefined,
    datasetName: profile?.dataset_name || undefined,
    profileRunId,
    profileRunLabel: profile?.run_name || (profile?.version ? `Version ${profile.version}` : undefined),
    scanMode: profile?.scan_mode || undefined,
    rowScope: profile?.is_approximate ? "sample" : profile ? "full" : undefined,
    rowCount: profile?.row_count ?? undefined,
    profiledAt: profile?.updated_at || profile?.created_at || undefined,
    proposalStatus: profile ? (profile.pending_proposals ? "review required" : "reviewed") : undefined,
  };
}

function clampWidgetPosition(position: { x: number; y: number }, viewportWidth: number, viewportHeight: number) {
  return {
    x: Math.max(WIDGET_MARGIN, Math.min(viewportWidth - WIDGET_SIZE - WIDGET_MARGIN, position.x)),
    y: Math.max(WIDGET_MARGIN, Math.min(viewportHeight - WIDGET_SIZE - WIDGET_MARGIN, position.y)),
  };
}

function DataAnalyticsIcon({ size = 26 }: { size?: number; color?: string }) {
  return (
    <Image
      src="/img/logo.png"
      alt="VDaAgent Icon"
      width={size}
      height={size}
      unoptimized
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

function makeMessage(
  role: ChatMessage["role"],
  text: string,
  label?: string,
  sources?: AnswerSource[],
  status?: ChatMessage["status"],
  statusDetail?: string,
): ChatMessage {
  return { id: `${Date.now()}-${Math.random()}`, role, text, label, sources, status, statusDetail };
}

export function DraggableChatWidget({
  conversations,
  onRemoveConversation,
}: {
  conversations: ChatConversation[];
  onRemoveConversation: (conv: ChatConversation) => boolean | void | Promise<boolean | void>;
}) {
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"chat" | "history">("chat");
  const [convList, setConvList] = useState<ChatConversation[]>(conversations);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const positionRef = useRef(position);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number; hasMoved: boolean }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
    hasMoved: false,
  });

  // Copilot QA State
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [isSelectedRunReady, setIsSelectedRunReady] = useState(false);
  const [answerDetail, setAnswerDetail] = useState<"quick" | "standard" | "deep">("standard");
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const activeProfile = useQuery({
    queryKey: ["profile", selectedRunId],
    queryFn: ({ signal }) => getProfile(selectedRunId, signal),
    enabled: Boolean(selectedRunId && isSelectedRunReady),
    retry: false,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  useEffect(() => {
    if (!selectedRunId || isThinking) return;
    let cancelled = false;
    void getChatSuggestions(selectedRunId).then((items) => {
      if (!cancelled) setSuggestions(items);
    }).catch(() => {
      if (!cancelled) setSuggestions([]);
    });
    return () => { cancelled = true; };
  }, [selectedRunId, isThinking]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamSequenceRef = useRef(0);

  const replaceMessages = (nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
  };

  const updateMessages = (updater: (currentMessages: ChatMessage[]) => ChatMessage[]) => {
    replaceMessages(updater(messagesRef.current));
  };

  const cancelActiveStream = () => {
    streamSequenceRef.current += 1;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    updateMessages((current) => current.map((message) => message.status === "streaming"
      ? { ...message, lifecycle: "cancelled", status: "cancelled", statusDetail: "Request stopped" }
      : message));
    setIsThinking(false);
  };

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => () => {
    streamSequenceRef.current += 1;
    streamAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Sync convList
  useEffect(() => {
    setConvList(listConversations());
  }, [conversations, isOpen]);

  // A workspace switch changes the scoped conversation list while this
  // widget stays mounted. Never keep showing context from the old workspace.
  useEffect(() => {
    const activeConversationStillExists = conversations.some((conversation) => conversation.id === activeConversationId)
      || listConversations().some((conversation) => conversation.id === activeConversationId);
    if (!activeConversationId || activeConversationStillExists) return;
    cancelActiveStream();
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setSelectedDatasetId("");
    setSelectedRunId("");
    setIsSelectedRunReady(false);
    replaceMessages([]);
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (!isOpen) setIsSelectedRunReady(false);
  }, [isOpen]);

  // Auto-scroll messages
  useEffect(() => {
    if (isOpen && viewMode === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: isThinking ? "auto" : "smooth" });
    }
  }, [messages.length, isThinking, isOpen, viewMode]);

  // If path is a profile run, try to pre-select it
  useEffect(() => {
    const profileMatch = pathname.match(/\/profiles\/([^/?]+)/);
    if (profileMatch && profileMatch[1]) {
      if (streamAbortRef.current) cancelActiveStream();
      setSelectedDatasetId("");
      setSelectedRunId(profileMatch[1]);
      setIsSelectedRunReady(false);
    }
  }, [pathname]);

  // Initialize position to bottom right
  useEffect(() => {
    const saved = localStorage.getItem("p170_chat_widget_pos");
    let nextPosition: { x: number; y: number } | null = null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          nextPosition = parsed;
        }
      } catch {
        // ignore
      }
    }
    const fallback = { x: window.innerWidth - WIDGET_SIZE - 20, y: window.innerHeight - WIDGET_SIZE - 30 };
    const setVisiblePosition = (candidate: { x: number; y: number }) => {
      const clamped = clampWidgetPosition(candidate, window.innerWidth, window.innerHeight);
      positionRef.current = clamped;
      setPosition(clamped);
      localStorage.setItem("p170_chat_widget_pos", JSON.stringify(clamped));
    };
    setVisiblePosition(nextPosition ?? fallback);

    const handleResize = () => setVisiblePosition(positionRef.current);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Initialize or load conversation
  useEffect(() => {
    if (!activeConversationId) {
      const profileMatch = pathname.match(/\/profiles\/([^/?]+)/);
      const routeProfileRunId = profileMatch?.[1] || "";
      const active = conversations[0];
      if (active) {
        activeConversationIdRef.current = active.id;
        setActiveConversationId(active.id);
        const snapshot = getConversationSnapshot(active.id);
        if (snapshot) {
          // A profile page represents an explicit run context. It must win
          // over an older conversation snapshot loaded during mount.
          setSelectedDatasetId(routeProfileRunId ? "" : snapshot.datasetId || "");
          setSelectedRunId(routeProfileRunId || snapshot.profileRunId || "");
          setAnswerDetail(snapshot.answerDetail || "standard");
          setIsSelectedRunReady(false);
          if (snapshot.messages.length > 0) {
            replaceMessages(snapshot.messages);
          } else {
            replaceMessages([
              makeMessage(
                "agent",
                "Đã mở đoạn chat. Hãy chọn dataset/phiên profiling và đặt câu hỏi cho tôi nhé!",
                "Sẵn sàng",
              ),
            ]);
          }
        } else {
          setSelectedDatasetId("");
          setSelectedRunId("");
          setIsSelectedRunReady(false);
          replaceMessages([
            makeMessage(
              "agent",
              "Xin chào! Tôi là Trợ lý AI Data Agent. Bạn có thể hỏi bất kỳ điều gì về dataset, thống kê cột, rủi ro PII, hay đề xuất biểu đồ ngay tại đây.",
              "Sẵn sàng"
            ),
          ]);
        }
      } else {
        replaceMessages([
          makeMessage(
            "agent",
            "Xin chào! Tôi là Trợ lý AI Data Agent. Bạn có thể vừa thao tác dữ liệu vừa hỏi đáp với tôi ở khung này.",
            "Sẵn sàng"
          ),
        ]);
      }
    }
  }, [activeConversationId, conversations, pathname]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const button = e.currentTarget;
    try {
      button.setPointerCapture?.(e.pointerId);
    } catch {
      // Pointer capture is unavailable in a few embedded browser contexts.
    }
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
      hasMoved: false,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragStartRef.current.hasMoved = true;
    }

    const nextPosition = clampWidgetPosition(
      { x: dragStartRef.current.posX + dx, y: dragStartRef.current.posY + dy },
      window.innerWidth,
      window.innerHeight,
    );
    positionRef.current = nextPosition;
    setPosition(nextPosition);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (!dragStartRef.current.hasMoved) {
      setIsOpen((prev) => !prev);
    } else {
      const windowW = window.innerWidth;
      const windowH = window.innerHeight;
      const currentX = positionRef.current.x;
      const currentY = positionRef.current.y;

      const isLeft = currentX + WIDGET_SIZE / 2 < windowW / 2;
      const isTop = currentY + WIDGET_SIZE / 2 < windowH / 2;

      const snapX = isLeft ? WIDGET_MARGIN : windowW - WIDGET_SIZE - WIDGET_MARGIN;
      const snapY = isTop ? WIDGET_MARGIN : windowH - WIDGET_SIZE - WIDGET_MARGIN;

      const snappedPosition = { x: snapX, y: snapY };
      positionRef.current = snappedPosition;
      setPosition(snappedPosition);

      localStorage.setItem("p170_chat_widget_pos", JSON.stringify(snappedPosition));
    }
  };

  const handleSend = async (questionText?: string, options: {
    retryOf?: string;
    regenerationOf?: string;
    parentMessageId?: string;
    includeUserMessage?: boolean;
    reuseRequestId?: string;
    profileOverride?: Profile;
    answerDetailOverride?: "quick" | "standard" | "deep";
  } = {}) => {
    const query = (questionText || input).trim();
    const targetProfile = options.profileOverride;
    const targetRunId = targetProfile?.profile_run_id || selectedRunId;
    const targetDatasetId = targetProfile?.dataset_id || selectedDatasetId;
    const targetAnswerDetail = options.answerDetailOverride || answerDetail;
    if (!query || isThinking) return;
    if (!targetRunId || (!targetProfile && !isSelectedRunReady)) {
      updateMessages((current) => [
        ...current,
        makeMessage("agent", "Hãy chọn một Profile Run đã hoàn tất trước khi hỏi để tôi trả lời đúng theo evidence của dữ liệu.", "Cần chọn Profile Run"),
      ]);
      return;
    }

    let conversationId = activeConversationIdRef.current;
    if (!conversationId) {
      const conversation = createConversation("Cuộc trò chuyện mới");
      conversationId = conversation.id;
      activeConversationIdRef.current = conversation.id;
      setActiveConversationId(conversation.id);
      setConvList(listConversations());
    }

    setInput("");
    const context = widgetContext(targetDatasetId, targetRunId, targetProfile);
    const userMessage = {
      ...makeMessage("user", query),
      context,
      conversationId,
      parentMessageId: options.parentMessageId,
      answerDetail: targetAnswerDetail,
    };
    const priorMessages = messagesRef.current;
    const newHistory = options.includeUserMessage === false ? priorMessages : [...priorMessages, userMessage];
    const chatRequestId = options.reuseRequestId || crypto.randomUUID();
    let streamState = initialChatStream(chatRequestId);
    const assistantMessage = {
      ...makeMessage("agent", "", undefined, [], "streaming", "Preparing request"),
      lifecycle: "sending" as const,
      requestId: chatRequestId,
      startedAt: Date.now(),
      context,
      conversationId,
      parentMessageId: options.parentMessageId,
      retryOf: options.retryOf,
      regenerationOf: options.regenerationOf,
      answerDetail: targetAnswerDetail,
    };
    const initialMessages = [...newHistory, assistantMessage];
    replaceMessages(initialMessages);
    setIsThinking(true);

    const requestId = ++streamSequenceRef.current;
    const requestController = new AbortController();
    streamAbortRef.current = requestController;
    let botText = "";
    let botSources: AnswerSource[] = [];
    let latestAssistant: ChatMessage = assistantMessage;

    const saveSnapshot = (nextMessages: ChatMessage[]) => {
      updateConversationSnapshot(conversationId, {
        messages: nextMessages,
        profile: null,
        datasetId: selectedDatasetId || null,
        profileRunId: selectedRunId || null,
        answerDetail,
      });
    };

    // Persist the question and placeholder before the request starts. This also
    // gives an unsaved widget conversation a durable id before navigation.
    saveSnapshot(initialMessages);

    const isCurrentStream = () => (
      streamSequenceRef.current === requestId && activeConversationIdRef.current === conversationId
    );
    const updateAssistant = (changes: Partial<ChatMessage>) => {
      latestAssistant = { ...latestAssistant, ...changes };
      if (!isCurrentStream()) return;
      updateMessages((current) => current.map((message) => (
        message.id === assistantMessage.id ? latestAssistant : message
      )));
    };
    const historyPayload = chatHistory(priorMessages, 12);

    try {
      await streamQuestion(
        {
          question: query,
          request_id: chatRequestId,
          conversation_id: conversationId,
          message_id: userMessage.id,
          assistant_message_id: assistantMessage.id,
          persist_user_message: options.includeUserMessage !== false,
          parent_message_id: options.parentMessageId,
          retry_of: options.retryOf,
          regeneration_of: options.regenerationOf,
          profile_run_id: targetRunId,
          history: historyPayload,
          answer_detail: targetAnswerDetail,
        },
        (event) => {
          streamState = reduceChatStream(streamState, event);
          botText = streamState.text;
          botSources = streamState.sources;
          latestAssistant = { ...latestAssistant, ...chatMessagePatch(streamState) };
          if (isCurrentStream()) updateAssistant(chatMessagePatch(streamState));
          if (event.event === "error") {
            const data = event.data as { detail?: unknown; code?: unknown; recovery_actions?: unknown } | undefined;
            const failure = new Error(typeof data?.detail === "string" ? data.detail : "Agent response failed.") as Error & { chatCode?: string; recoveryActions?: string[] };
            failure.chatCode = typeof data?.code === "string" ? data.code : undefined;
            failure.recoveryActions = Array.isArray(data?.recovery_actions)
              ? data.recovery_actions.filter((item): item is string => typeof item === "string")
              : undefined;
            throw failure;
          }
          if (event.event === "suggestions") {
            const payload = event.data as { suggestions?: unknown } | undefined;
            if (Array.isArray(payload?.suggestions)) setSuggestions(payload.suggestions as ChatSuggestion[]);
          }
        },
        requestController.signal,
      );

      latestAssistant = {
        ...latestAssistant,
        text: botText || "Agent chưa trả về nội dung. Hãy thử lại.",
        sources: botSources,
        status: botText ? undefined : "error",
        statusDetail: undefined,
      };
    } catch (reason) {
      const wasCancelled = requestController.signal.aborted || streamSequenceRef.current !== requestId;
      const errorMessage = wasCancelled
        ? "Phiên trả lời đã dừng khi bạn chuyển đoạn chat hoặc workspace."
        : reason instanceof Error
          ? reason.message
          : "Đã xảy ra lỗi khi kết nối với AI Agent.";
      latestAssistant = {
        ...latestAssistant,
        text: botText ? `${botText}\n\n⚠️ ${errorMessage}` : `⚠️ ${errorMessage}`,
        sources: botSources,
        label: wasCancelled ? "Đã dừng" : "Lỗi kết nối",
        lifecycle: wasCancelled ? "cancelled" : "failed",
        status: wasCancelled ? "cancelled" : "error",
        statusDetail: wasCancelled ? "Request stopped" : undefined,
      };
      if (!wasCancelled) {
        const failure = reason as Error & { chatCode?: string; recoveryActions?: string[] };
        latestAssistant = {
          ...latestAssistant,
          text: botText || errorMessage,
          lifecycle: failure.chatCode === "CHAT_TIMEOUT" ? "timeout" : "failed",
          status: "error",
          statusDetail: errorMessage,
          errorCode: failure.chatCode || (reason instanceof ApiError ? reason.code || (reason.status === 0 ? "CHAT_NETWORK" : undefined) : undefined),
          recoveryActions: failure.recoveryActions || (reason instanceof ApiError ? reason.recoveryActions : undefined),
        };
      }
    } finally {
      const finalMessages = initialMessages.map((message) => (
        message.id === assistantMessage.id ? latestAssistant : message
      ));
      saveSnapshot(finalMessages);
      if (isCurrentStream()) replaceMessages(finalMessages);
      if (streamAbortRef.current === requestController) streamAbortRef.current = null;
      if (streamSequenceRef.current === requestId) setIsThinking(false);
    }
  };

  const previousUserMessage = (messageId: string): ChatMessage | undefined => {
    const index = messagesRef.current.findIndex((message) => message.id === messageId);
    return [...messagesRef.current.slice(0, index)].reverse().find((message) => message.role === "user");
  };

  const profileForMessage = async (message: ChatMessage): Promise<Profile | null> => {
    const profileRunId = message.answerEnvelope?.provenance.profile_run_id || message.context?.profileRunId;
    if (!profileRunId) return null;
    try {
      const historicalProfile = await getProfile(profileRunId);
      if (historicalProfile.status !== "completed" || historicalProfile.pending_proposals) {
        updateMessages((current) => [...current, makeMessage("agent", "The original Profile Run is not ready for a safe retry.", "Context")]);
        return null;
      }
      return historicalProfile;
    } catch {
      updateMessages((current) => [...current, makeMessage("agent", "The original Profile Run is unavailable in this workspace, so this answer cannot be retried safely.", "Context")]);
      return null;
    }
  };

  const retryAssistantMessage = async (message: ChatMessage) => {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    const reconnect = message.errorCode === "REQUEST_IN_PROGRESS" || message.errorCode === "CHAT_NETWORK";
    void handleSend(userMessage.text, {
      parentMessageId: userMessage.id,
      includeUserMessage: false,
      retryOf: message.requestId,
      reuseRequestId: reconnect ? message.requestId : undefined,
      profileOverride: targetProfile,
      answerDetailOverride: message.answerDetail || message.answerEnvelope?.answer_detail,
    });
  };

  const regenerateAssistantMessage = async (message: ChatMessage) => {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    void handleSend(userMessage.text, {
      parentMessageId: userMessage.id,
      includeUserMessage: false,
      regenerationOf: message.id,
      profileOverride: targetProfile,
      answerDetailOverride: message.answerDetail || message.answerEnvelope?.answer_detail,
    });
  };

  const askDeeper = async (message: ChatMessage) => {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    void handleSend(`Please provide a deeper, evidence-backed explanation of: ${userMessage.text}`, {
      parentMessageId: message.id,
      profileOverride: targetProfile,
      answerDetailOverride: "deep",
    });
  };

  const chooseClarification = async (message: ChatMessage, option: { id: string; label: string }) => {
    const userMessage = previousUserMessage(message.id);
    if (!userMessage) return;
    const targetProfile = await profileForMessage(message);
    if (!targetProfile) return;
    void handleSend(`${userMessage.text}\n\nClarification: ${option.label}`, {
      parentMessageId: message.id,
      profileOverride: targetProfile,
      answerDetailOverride: message.answerDetail || message.answerEnvelope?.answer_detail,
    });
  };

  const sendFeedback = (message: ChatMessage, polarity: "helpful" | "not_helpful", reasonCode?: string) => {
    if (!message.agentRunId) return;
    void submitChatFeedback({ agent_run_id: message.agentRunId, message_id: message.id, polarity, reason_code: reasonCode }).catch(() => {
      // Feedback is intentionally best-effort and never changes an answer.
    });
  };

  const handleRecoveryAction = (message: ChatMessage, recoveryAction: string) => {
    const originalQuestion = previousUserMessage(message.id)?.text || "";
    if (recoveryAction === "narrow_question" || recoveryAction === "clarify") {
      setInput(originalQuestion);
      return;
    }
    if (recoveryAction === "refresh_session") {
      window.location.reload();
      return;
    }
    if (recoveryAction === "open_profiling_status") {
      const profileRunId = message.answerEnvelope?.provenance.profile_run_id || message.context?.profileRunId;
      if (profileRunId) window.location.assign(`/profiles/${encodeURIComponent(profileRunId)}/review`);
      return;
    }
    document.getElementById("widget-profile-run")?.focus();
  };

  useEffect(() => {
    const handleMessageAction = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as {
        messageId?: string;
        action?: string;
        polarity?: "helpful" | "not_helpful";
        reasonCode?: string;
        option?: { id: string; label: string };
        recoveryAction?: string;
      } : undefined;
      const message = detail?.messageId ? messagesRef.current.find((item) => item.id === detail.messageId) : undefined;
      if (!message || message.role !== "agent") return;
      if (detail?.action === "retry") void retryAssistantMessage(message);
      if (detail?.action === "regenerate") void regenerateAssistantMessage(message);
      if (detail?.action === "deepen") void askDeeper(message);
      if (detail?.action === "clarify" && detail.option) void chooseClarification(message, detail.option);
      if (detail?.action === "feedback" && detail.polarity) sendFeedback(message, detail.polarity, detail.reasonCode);
      if (detail?.action === "recovery" && detail.recoveryAction) handleRecoveryAction(message, detail.recoveryAction);
    };
    window.addEventListener("p170-chat-message-action", handleMessageAction);
    return () => window.removeEventListener("p170-chat-message-action", handleMessageAction);
  }, []);

  const handleStartNewChat = () => {
    cancelActiveStream();
    const newConversation = createConversation("Cuộc trò chuyện mới");
    const profileMatch = pathname.match(/\/profiles\/([^/?]+)/);
    const greeting = makeMessage(
      "agent",
      "Đã tạo cuộc trò chuyện mới. Hãy chọn dataset/phiên profiling và đặt câu hỏi cho tôi nhé!",
      "Mới",
    );
    activeConversationIdRef.current = newConversation.id;
    setSelectedDatasetId("");
    setSelectedRunId(profileMatch?.[1] || "");
    setIsSelectedRunReady(false);
    setAnswerDetail("standard");
    setSuggestions([]);
    setActiveConversationId(newConversation.id);
    setConvList(listConversations());
    replaceMessages([greeting]);
    updateConversationSnapshot(newConversation.id, {
      messages: [greeting],
      profile: null,
      datasetId: null,
      profileRunId: profileMatch?.[1] || null,
      answerDetail: "standard",
    });
    setViewMode("chat");
  };

  const handleSelectConversation = (conversation: ChatConversation) => {
    cancelActiveStream();
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    const snapshot = getConversationSnapshot(conversation.id);
    setSelectedDatasetId(snapshot?.datasetId || "");
    setSelectedRunId(snapshot?.profileRunId || "");
    setIsSelectedRunReady(false);
    setAnswerDetail(snapshot?.answerDetail || "standard");
    if (snapshot && snapshot.messages.length > 0) {
      replaceMessages(snapshot.messages);
    } else {
      replaceMessages([
        makeMessage("agent", `Đã mở đoạn chat "${conversation.title}". Hãy tiếp tục câu hỏi của bạn!`, "Sẵn sàng"),
      ]);
    }
    setViewMode("chat");
  };

  const handleDeleteConv = async (event: MouseEvent, conversation: ChatConversation) => {
    event.stopPropagation();
    const removed = await onRemoveConversation(conversation);
    if (removed === false) return;
    if (activeConversationIdRef.current === conversation.id) cancelActiveStream();
    const updated = listConversations();
    setConvList(updated);
    if (activeConversationIdRef.current === conversation.id) {
      if (updated.length > 0) {
        handleSelectConversation(updated[0]);
      } else {
        handleStartNewChat();
      }
    }
  };

  if (position.x === -1) return null;

  // DYNAMIC DRAWER POSITIONING FOLLOWING THE DRAGGED ICON
  const drawerWidth = 440;
  const drawerHeight = 620;
  const isLeft = position.x < (typeof window !== "undefined" ? window.innerWidth / 2 : 600);
  const isTop = position.y < (typeof window !== "undefined" ? window.innerHeight / 2 : 400);

  const windowW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const windowH = typeof window !== "undefined" ? window.innerHeight : 800;

  const drawerLeft = isLeft
    ? Math.max(16, Math.min(windowW - drawerWidth - 16, position.x))
    : Math.max(16, position.x + 56 - drawerWidth);

  const drawerTop = isTop
    ? Math.min(windowH - drawerHeight - 16, Math.max(16, position.y + 64))
    : Math.max(16, position.y - drawerHeight - 10);

  return (
    <>
      {/* FLOATING DRAGGABLE BUBBLE */}
      <div
        style={{
          position: "fixed",
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 9999,
          touchAction: "none",
          userSelect: "none",
          transition: isDragging ? "none" : "left 0.3s ease-out, top 0.3s ease-out",
        }}
      >
        <button
          type="button"
          className={isOpen ? "draggable-chat-widget-button is-open" : "draggable-chat-widget-button"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          aria-label="Mở Trợ lý AI Copilot"
          title="Kéo thả để di chuyển — Bấm để mở Chat Copilot"
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "#ffffff",
            boxShadow: isOpen
              ? "0 0 0 4px rgba(37, 99, 235, 0.2), 0 12px 28px rgba(0, 0, 0, 0.15)"
              : "0 10px 25px -4px rgba(0, 0, 0, 0.14), 0 0 0 1px rgba(0, 0, 0, 0.05)",
            border: "2px solid #e2e8f0",
            color: "#2563eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: isDragging ? "grabbing" : "grab",
            transition: isDragging ? "none" : "transform 0.15s ease, box-shadow 0.15s ease",
            transform: isDragging ? "scale(1.08)" : "scale(1)",
          }}
        >
          {isOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <DataAnalyticsIcon size={26} color="#2563eb" />
              <span
                style={{
                  position: "absolute",
                  top: "-4px",
                  right: "-4px",
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: "#10b981",
                  border: "2px solid #ffffff",
                  boxShadow: "0 0 6px #10b981",
                }}
              />
            </div>
          )}
        </button>
      </div>

      {/* FLOATING COPILOT DRAWER (DYNAMICALLY POSITIONED NEAR ICON) */}
      {isOpen && (
        <aside
          style={{
            position: "fixed",
            left: `${drawerLeft}px`,
            top: `${drawerTop}px`,
            width: "440px",
            maxWidth: "calc(100vw - 2rem)",
            height: "620px",
            maxHeight: "calc(100vh - 5rem)",
            background: "#ffffff",
            color: "#0f172a",
            border: "1px solid #cbd5e1",
            borderRadius: "16px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.06)",
            display: "flex",
            flexDirection: "column",
            zIndex: 9998,
            overflow: "hidden",
            animation: "widgetFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          aria-label="VDaAgent"
        >
          {/* HEADER */}
          <header
            style={{
              padding: "0.85rem 1.15rem",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#2563eb",
                }}
              >
                <DataAnalyticsIcon size={18} color="#2563eb" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "#0f172a" }}>
                  {viewMode === "history" ? "Lịch sử trò chuyện" : "VDaAgent"}
                </h3>
                <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
                  {viewMode === "history" ? "Lưu trong 30 ngày" : "Vừa xem tính năng vừa hỏi đáp"}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {viewMode === "chat" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setViewMode("history")}
                    style={{
                      padding: "5px 9px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: "#f1f5f9",
                      color: "#475569",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                    title="Xem lịch sử đoạn chat"
                  >
                    📜 Lịch sử
                  </button>
                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    style={{
                      padding: "5px 9px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: "#eff6ff",
                      color: "#2563eb",
                      border: "1px solid #bfdbfe",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                    title="Tạo cuộc trò chuyện mới"
                  >
                    + Chat mới
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setViewMode("chat")}
                  style={{
                    padding: "5px 10px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  ← Quay lại Chat
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: "1.25rem",
                  padding: "2px 6px",
                  lineHeight: 1,
                }}
                title="Thu gọn"
              >
                ✕
              </button>
            </div>
          </header>

          {/* VIEW: HISTORY LIST */}
          {viewMode === "history" ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem", background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Danh sách đoạn chat ({convList.length})
                </span>
                <button
                  type="button"
                  onClick={handleStartNewChat}
                  style={{
                    padding: "4px 8px",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    background: "#eff6ff",
                    color: "#2563eb",
                    border: "1px solid #bfdbfe",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  + Tạo đoạn chat mới
                </button>
              </div>

              {convList.length === 0 ? (
                <div style={{ padding: "2rem 1rem", textAlign: "center", color: "#64748b", fontSize: "0.85rem" }}>
                  Chưa có lịch sử đoạn chat nào.<br />Bấm <b>+ Chat mới</b> để bắt đầu hỏi đáp dữ liệu!
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {convList.map((conv) => {
                    const isActive = activeConversationId === conv.id;
                    return (
                      <div
                        key={conv.id}
                        onClick={() => handleSelectConversation(conv)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          background: isActive ? "#eff6ff" : "#ffffff",
                          border: isActive ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
                          borderRadius: "10px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          boxShadow: isActive ? "0 2px 8px rgba(59, 130, 246, 0.15)" : "0 1px 3px rgba(0,0,0,0.04)",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0, paddingRight: "8px" }}>
                          <div style={{ fontSize: "0.88rem", fontWeight: 600, color: isActive ? "#1d4ed8" : "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            💬 {conv.title}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "#64748b", marginTop: "2px" }}>
                            {new Date(conv.updatedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleDeleteConv(e, conv)}
                          aria-label={`Xóa ${conv.title}`}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#94a3b8",
                            cursor: "pointer",
                            padding: "4px 8px",
                            fontSize: "1.1rem",
                            borderRadius: "4px",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* VIEW: CHAT CONVERSATION */
            <>
              {/* DATASET + PROFILE RUN SELECTOR */}
              <div
                style={{
                  padding: "0.6rem 1rem",
                  background: "#f1f5f9",
                  borderBottom: "1px solid #e2e8f0",
                  fontSize: "0.75rem",
                }}
              >
                <ProfileRunPicker
                  id="widget-profile-run"
                  label="Profile Run dùng làm evidence"
                  value={selectedRunId}
                  datasetId={selectedDatasetId}
                  onDatasetChange={setSelectedDatasetId}
                  onValidityChange={setIsSelectedRunReady}
                  onChange={setSelectedRunId}
                  helpText="Chọn bộ dữ liệu trước, sau đó chọn phiên Profile Run đã hoàn tất."
                  disabled={isThinking}
                />
                {activeProfile.data && <div className="chat-active-context" aria-label="Active answer context">
                  <b>Answering against</b>
                  <span>{activeProfile.data.dataset_name || "Dataset"}</span>
                  <span>{activeProfile.data.run_name || `Version ${activeProfile.data.version ?? "—"}`}</span>
                  <span>{activeProfile.data.scan_mode || "unknown"} scan</span>
                  <span>{activeProfile.data.is_approximate ? "sample scope" : "full scope"}</span>
                  {activeProfile.data.row_count !== null && activeProfile.data.row_count !== undefined && <span>{activeProfile.data.row_count.toLocaleString()} rows</span>}
                  {(activeProfile.data.updated_at || activeProfile.data.created_at) && <span>Profiled {new Date(activeProfile.data.updated_at || activeProfile.data.created_at || "").toLocaleDateString()}</span>}
                  <span>{activeProfile.data.pending_proposals ? "review required" : "reviewed"}</span>
                </div>}
              </div>

              {/* MESSAGES SCROLL AREA */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.85rem",
                  background: "#ffffff",
                }}
              >
                {messages.map((m) => {
                  const isUser = m.role === "user";
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isUser ? "flex-end" : "flex-start",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "88%",
                          padding: "0.75rem 1rem",
                          borderRadius: isUser ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                          background: isUser ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)" : "#f1f5f9",
                          color: isUser ? "#ffffff" : "#1e293b",
                          border: isUser ? "none" : "1px solid #e2e8f0",
                          fontSize: "0.85rem",
                          lineHeight: "1.5",
                          whiteSpace: isUser ? "pre-wrap" : "normal",
                          wordBreak: "break-word",
                          boxShadow: isUser ? "0 2px 8px rgba(37,99,235,0.2)" : "none",
                        }}
                      >
                        {isUser ? (
                          <>{m.text}<ChatMessageActions message={m} busy={isThinking} onEditUserQuestion={() => setInput(m.text)} /></>
                        ) : m.text ? (
                          <ChatAnswer message={m} fallback={<MarkdownContent text={m.text} className="widget-markdown-message" />} />
                        ) : (
                          <span className={m.status === "error" ? "widget-response-error" : "widget-response-status"}>
                            {m.status === "error" ? "Không thể nhận phản hồi từ Agent." : m.status === "cancelled" ? "Request stopped." : <ChatProgress message={m} fallback="Preparing request" />}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div ref={messagesEndRef} />
              </div>
              {isThinking && <div className="sr-only" role="status" aria-live="polite">{messages.at(-1)?.statusDetail || "Processing request"}</div>}

              {/* QUICK STARTERS (IF FEW MESSAGES) */}
              {messages.length <= 2 && (
                <div style={{ padding: "0.5rem 1rem", display: "flex", flexWrap: "wrap", gap: "4px", background: "#f8fafc", borderTop: "1px solid #f1f5f9" }}>
                  {(suggestions.length ? suggestions.map((suggestion) => suggestion.question) : starters).map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSend(s)}
                      disabled={!isSelectedRunReady || isThinking}
                      style={{
                        padding: "4px 8px",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: "6px",
                        color: "#1d4ed8",
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        textAlign: "left",
                        fontWeight: 500,
                      }}
                    >
                      💡 {s}
                    </button>
                  ))}
                </div>
              )}

              {/* INPUT FORM */}
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  handleSend();
                }}
                style={{
                  padding: "0.75rem 1rem",
                  background: "#f8fafc",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  gap: "8px",
                }}
              >
                <label className="chat-detail-control">
                  <span className="sr-only">Answer detail</span>
                  <select value={answerDetail} onChange={(event) => setAnswerDetail(event.target.value as "quick" | "standard" | "deep")} disabled={isThinking} aria-label="Answer detail">
                    <option value="quick">Nhanh</option>
                    <option value="standard">Tiêu chuẩn</option>
                    <option value="deep">Chuyên sâu</option>
                  </select>
                </label>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isSelectedRunReady ? "Hỏi AI về Profile Run đã chọn…" : "Chọn Profile Run để bắt đầu hỏi…"}
                  disabled={!isSelectedRunReady || isThinking}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    color: "#0f172a",
                    fontSize: "0.85rem",
                    outline: "none",
                  }}
                />
                {isThinking && <button type="button" onClick={cancelActiveStream} aria-label="Stop answer" style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#334155", fontWeight: 600 }}>Stop</button>}
                <button
                  type="submit"
                  disabled={!input.trim() || !isSelectedRunReady || isThinking}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: input.trim() && isSelectedRunReady && !isThinking ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)" : "#cbd5e1",
                    color: "#ffffff",
                    border: "none",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: input.trim() && isSelectedRunReady && !isThinking ? "pointer" : "not-allowed",
                    boxShadow: input.trim() && isSelectedRunReady && !isThinking ? "0 2px 6px rgba(37,99,235,0.25)" : "none",
                  }}
                >
                  Gửi
                </button>
              </form>
            </>
          )}
        </aside>
      )}
    </>
  );
}
