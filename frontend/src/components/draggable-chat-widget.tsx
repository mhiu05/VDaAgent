"use client";

import React, { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { streamQuestion, type QAHistoryMessage } from "@/lib/api";
import type { AnswerSource } from "@/lib/types";
import { createConversation, getConversationSnapshot, updateConversationSnapshot, listConversations, type ChatConversation, type ChatMessage } from "@/lib/chat-history";
import { AnswerSources } from "@/components/answer-sources";
import { MarkdownContent } from "@/components/markdown";
import { ProfileRunPicker } from "@/components/profile-run-picker";

const starters = [
  "Tóm tắt chất lượng dữ liệu hiện tại",
  "Cột nào có rủi ro PII hoặc null cao?",
  "Có cột nào phù hợp làm candidate key không?",
];
const WIDGET_SIZE = 56;
const WIDGET_MARGIN = 16;

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

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamSequenceRef = useRef(0);
  const streamFrameRef = useRef<number | null>(null);

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
    if (streamFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
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
    if (streamFrameRef.current !== null) window.cancelAnimationFrame(streamFrameRef.current);
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

  const handleSend = async (questionText?: string) => {
    const query = (questionText || input).trim();
    if (!query || isThinking) return;
    if (!selectedRunId || !isSelectedRunReady) {
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
    const userMessage = makeMessage("user", query);
    const priorMessages = messagesRef.current;
    const newHistory = [...priorMessages, userMessage];
    const assistantMessage = makeMessage("agent", "", undefined, [], "streaming", "Đang chuẩn bị phản hồi…");
    const initialMessages = [...newHistory, assistantMessage];
    replaceMessages(initialMessages);
    setIsThinking(true);

    const requestId = ++streamSequenceRef.current;
    const requestController = new AbortController();
    streamAbortRef.current = requestController;
    let botText = "";
    let botSources: AnswerSource[] = [];
    let latestAssistant = assistantMessage;
    let pendingFrame: number | null = null;

    const saveSnapshot = (nextMessages: ChatMessage[]) => {
      updateConversationSnapshot(conversationId, {
        messages: nextMessages,
        profile: null,
        datasetId: selectedDatasetId || null,
        profileRunId: selectedRunId || null,
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
    const flushResponse = () => {
      pendingFrame = null;
      streamFrameRef.current = null;
      updateAssistant({ text: botText, sources: botSources, status: "streaming" });
    };
    const scheduleResponseRender = () => {
      if (pendingFrame !== null) return;
      pendingFrame = window.requestAnimationFrame(flushResponse);
      streamFrameRef.current = pendingFrame;
    };

    const historyPayload: QAHistoryMessage[] = newHistory
      .filter((message) => message.role === "user" || message.role === "agent")
      .slice(-6)
      .map((message) => ({ role: message.role as "user" | "agent", text: message.text }));

    try {
      await streamQuestion(
        {
          question: query,
          profile_run_id: selectedRunId,
          history: historyPayload,
        },
        (event) => {
          if (event.event === "status" && event.data && typeof event.data === "object") {
            const status = event.data as { stage?: unknown; detail?: unknown };
            const stage = String(status.stage || "");
            const statusDetail = typeof status.detail === "string"
              ? status.detail
              : stage === "retrieving"
                ? "Đang tìm evidence…"
                : stage === "generating"
                  ? "Đang soạn câu trả lời…"
                  : "Đang chuẩn bị phản hồi…";
            updateAssistant({ status: "streaming", statusDetail });
            return;
          }
          if (event.event === "token" && event.data && typeof event.data === "object") {
            botText += String((event.data as { text?: unknown }).text || "");
            scheduleResponseRender();
            return;
          }
          if (event.event === "source" && event.data && typeof event.data === "object") {
            const sourceData = event.data as { source?: unknown; sources?: unknown };
            if (Array.isArray(sourceData.sources)) {
              botSources = sourceData.sources as AnswerSource[];
              updateAssistant({ sources: botSources });
            } else if (sourceData.source && typeof sourceData.source === "object") {
              botSources = [...botSources, sourceData.source as AnswerSource];
              updateAssistant({ sources: botSources });
            }
            return;
          }
          if (event.event === "error") {
            const data = event.data as { message?: unknown; detail?: unknown } | undefined;
            const errorDetail = typeof data?.message === "string"
              ? data.message
              : typeof data?.detail === "string"
                ? data.detail
                : "Agent không thể hoàn tất phản hồi.";
            throw new Error(errorDetail);
          }
          if (event.event === "done" && event.data && typeof event.data === "object") {
            const doneData = event.data as { sources?: unknown };
            if (Array.isArray(doneData.sources)) botSources = doneData.sources as AnswerSource[];
          }
        },
        requestController.signal,
      );

      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
        streamFrameRef.current = null;
      }
      latestAssistant = {
        ...latestAssistant,
        text: botText || "Agent chưa trả về nội dung. Hãy thử lại.",
        sources: botSources,
        status: botText ? undefined : "error",
        statusDetail: undefined,
      };
    } catch (reason) {
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
        streamFrameRef.current = null;
      }
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
        label: "Lỗi kết nối",
        status: "error",
        statusDetail: undefined,
      };
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
    setActiveConversationId(newConversation.id);
    setConvList(listConversations());
    replaceMessages([greeting]);
    updateConversationSnapshot(newConversation.id, {
      messages: [greeting],
      profile: null,
      datasetId: null,
      profileRunId: profileMatch?.[1] || null,
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
                          m.text
                        ) : m.text ? (
                          <MarkdownContent text={m.text} className="widget-markdown-message" />
                        ) : (
                          <span className={m.status === "error" ? "widget-response-error" : "widget-response-status"}>
                            {m.statusDetail || (m.status === "error" ? "Không thể nhận phản hồi từ Agent." : "Đang chuẩn bị phản hồi…")}
                          </span>
                        )}
                      </div>
                      {m.sources && m.sources.length > 0 && (
                        <div style={{ marginTop: "4px", width: "100%", maxWidth: "88%" }}>
                          <AnswerSources sources={m.sources} />
                        </div>
                      )}
                    </div>
                  );
                })}

                <div ref={messagesEndRef} />
              </div>

              {/* QUICK STARTERS (IF FEW MESSAGES) */}
              {messages.length <= 2 && (
                <div style={{ padding: "0.5rem 1rem", display: "flex", flexWrap: "wrap", gap: "4px", background: "#f8fafc", borderTop: "1px solid #f1f5f9" }}>
                  {starters.map((s, idx) => (
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
