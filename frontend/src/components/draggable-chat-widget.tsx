"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listDatasets, listRuns, streamQuestion, type QAHistoryMessage } from "@/lib/api";
import type { AnswerSource } from "@/lib/types";
import { createConversation, getConversationSnapshot, updateConversationSnapshot, listConversations, type ChatConversation, type ChatMessage } from "@/lib/chat-history";
import { AnswerSources } from "@/components/answer-sources";
import { profileRunOptionLabel } from "@/components/profile-run-picker";

const starters = [
  "Tóm tắt chất lượng dữ liệu hiện tại",
  "Cột nào có rủi ro PII hoặc null cao?",
  "Có cột nào phù hợp làm candidate key không?",
];

function DataAnalyticsIcon({ size = 26 }: { size?: number; color?: string }) {
  return (
    <img
      src="/img/logo.png"
      alt="VDaAgent Icon"
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

function makeMessage(role: ChatMessage["role"], text: string, label?: string, sources?: AnswerSource[]): ChatMessage {
  return { id: `${Date.now()}-${Math.random()}`, role, text, label, sources };
}

export function DraggableChatWidget({
  conversations,
  onRemoveConversation,
}: {
  conversations: ChatConversation[];
  onNewChat?: () => void;
  onRemoveConversation: (conv: ChatConversation) => void;
}) {
  const pathname = usePathname();

  // Hide on full chat page
  const isFullChatPage = pathname === "/chat";

  const [isOpen, setIsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"chat" | "history">("chat");
  const [convList, setConvList] = useState<ChatConversation[]>(conversations);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
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

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync convList
  useEffect(() => {
    setConvList(listConversations());
  }, [conversations, isOpen]);

  // Auto-scroll messages
  useEffect(() => {
    if (isOpen && viewMode === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isThinking, isOpen, viewMode]);

  // Load Datasets
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: () => listDatasets() });
  const runs = useQuery({
    queryKey: ["runs", selectedDatasetId],
    queryFn: () => listRuns(selectedDatasetId),
    enabled: Boolean(selectedDatasetId),
  });

  // If path is a profile run, try to pre-select it
  useEffect(() => {
    const profileMatch = pathname.match(/\/profiles\/([^/?]+)/);
    if (profileMatch && profileMatch[1]) {
      setSelectedRunId(profileMatch[1]);
    }
  }, [pathname]);

  // Set default dataset & run if not set
  useEffect(() => {
    if (!selectedDatasetId && datasets.data && datasets.data.length > 0) {
      setSelectedDatasetId(datasets.data[0].id);
    }
  }, [datasets.data, selectedDatasetId]);

  useEffect(() => {
    if (runs.data && runs.data.length > 0 && !selectedRunId) {
      const completed = runs.data.find((r) => r.status === "completed") || runs.data[0];
      setSelectedRunId(completed.id);
    }
  }, [runs.data, selectedRunId]);

  // Initialize position to bottom right
  useEffect(() => {
    const saved = localStorage.getItem("p170_chat_widget_pos");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          setPosition(parsed);
          return;
        }
      } catch {
        // ignore
      }
    }
    const defaultX = Math.max(20, window.innerWidth - 76);
    const defaultY = Math.max(20, window.innerHeight - 86);
    setPosition({ x: defaultX, y: defaultY });
  }, []);

  // Initialize or load conversation
  useEffect(() => {
    if (!activeConversationId) {
      const active = conversations[0];
      if (active) {
        setActiveConversationId(active.id);
        const snapshot = getConversationSnapshot(active.id);
        if (snapshot && snapshot.messages.length > 0) {
          setMessages(snapshot.messages);
          if (snapshot.datasetId) setSelectedDatasetId(snapshot.datasetId);
          if (snapshot.profileRunId) setSelectedRunId(snapshot.profileRunId);
        } else {
          setMessages([
            makeMessage(
              "agent",
              "Xin chào! Tôi là Trợ lý AI Data Agent. Bạn có thể hỏi bất kỳ điều gì về dataset, thống kê cột, rủi ro PII, hay đề xuất biểu đồ ngay tại đây.",
              "Sẵn sàng"
            ),
          ]);
        }
      } else {
        setMessages([
          makeMessage(
            "agent",
            "Xin chào! Tôi là Trợ lý AI Data Agent. Bạn có thể vừa thao tác dữ liệu vừa hỏi đáp với tôi ở khung này.",
            "Sẵn sàng"
          ),
        ]);
      }
    }
  }, [activeConversationId, conversations]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const button = e.currentTarget;
    button.setPointerCapture(e.pointerId);
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

    const nextX = Math.max(16, Math.min(window.innerWidth - 70, dragStartRef.current.posX + dx));
    const nextY = Math.max(16, Math.min(window.innerHeight - 70, dragStartRef.current.posY + dy));
    setPosition({ x: nextX, y: nextY });
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
      localStorage.setItem("p170_chat_widget_pos", JSON.stringify(position));
    }
  };

  const handleSend = async (questionText?: string) => {
    const query = (questionText || input).trim();
    if (!query || isThinking) return;

    setInput("");
    const userMsg = makeMessage("user", query);
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setIsThinking(true);

    const botMsgId = `${Date.now()}-${Math.random()}`;
    let botText = "";
    let botSources: AnswerSource[] = [];

    // History payload
    const historyPayload: QAHistoryMessage[] = newHistory
      .filter((m) => m.role === "user" || m.role === "agent")
      .slice(-6)
      .map((m) => ({ role: m.role as "user" | "agent", text: m.text }));

    try {
      await streamQuestion(
        {
          question: query,
          profile_run_id: selectedRunId || undefined,
          history: historyPayload,
        },
        (event) => {
          if (event.event === "token" && event.data && typeof event.data === "object") {
            const token = String((event.data as { text?: unknown }).text || "");
            botText += token;
            setMessages((prev) => {
              const withoutLast = prev.filter((m) => m.id !== botMsgId);
              return [...withoutLast, { id: botMsgId, role: "agent", text: botText, sources: botSources }];
            });
          }
          if (event.event === "done" && event.data && typeof event.data === "object") {
            const doneData = event.data as { sources?: AnswerSource[] };
            if (Array.isArray(doneData.sources)) {
              botSources = doneData.sources;
            }
            setMessages((prev) => {
              const withoutLast = prev.filter((m) => m.id !== botMsgId);
              return [...withoutLast, { id: botMsgId, role: "agent", text: botText, sources: botSources }];
            });
          }
        }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Đã xảy ra lỗi khi kết nối với AI Agent.";
      setMessages((prev) => [
        ...prev,
        { id: botMsgId, role: "agent", text: `⚠️ ${errMsg}`, label: "Lỗi kết nối" },
      ]);
    } finally {
      setIsThinking(false);
      if (activeConversationId) {
        updateConversationSnapshot(activeConversationId, {
          messages: [...newHistory, { id: botMsgId, role: "agent", text: botText, sources: botSources }],
          profile: null,
          datasetId: selectedDatasetId || null,
          profileRunId: selectedRunId || null,
        });
      }
    }
  };

  const handleStartNewChat = () => {
    const newConv = createConversation("Cuộc trò chuyện mới");
    setActiveConversationId(newConv.id);
    setConvList(listConversations());
    setMessages([
      makeMessage(
        "agent",
        "Đã tạo cuộc trò chuyện mới. Hãy chọn dataset/phiên profiling và đặt câu hỏi cho tôi nhé!",
        "Mới"
      ),
    ]);
    setViewMode("chat");
  };

  const handleSelectConversation = (conv: ChatConversation) => {
    setActiveConversationId(conv.id);
    const snap = getConversationSnapshot(conv.id);
    if (snap && snap.messages.length > 0) {
      setMessages(snap.messages);
      if (snap.datasetId) setSelectedDatasetId(snap.datasetId);
      if (snap.profileRunId) setSelectedRunId(snap.profileRunId);
    } else {
      setMessages([
        makeMessage("agent", `Đã mở đoạn chat "${conv.title}". Hãy tiếp tục câu hỏi của bạn!`, "Sẵn sàng"),
      ]);
    }
    setViewMode("chat");
  };

  const handleDeleteConv = (e: MouseEvent, conv: ChatConversation) => {
    e.stopPropagation();
    onRemoveConversation(conv);
    const updated = listConversations();
    setConvList(updated);
    if (activeConversationId === conv.id) {
      if (updated.length > 0) {
        handleSelectConversation(updated[0]);
      } else {
        handleStartNewChat();
      }
    }
  };

  if (isFullChatPage || position.x === -1) return null;

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
              {/* SCOPE SELECTORS */}
              <div
                style={{
                  padding: "0.6rem 1rem",
                  background: "#f1f5f9",
                  borderBottom: "1px solid #e2e8f0",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  fontSize: "0.75rem",
                }}
              >
                <div>
                  <label style={{ display: "block", color: "#475569", marginBottom: "2px", fontWeight: 600 }}>
                    Dataset:
                  </label>
                  <select
                    value={selectedDatasetId}
                    onChange={(e) => {
                      setSelectedDatasetId(e.target.value);
                      setSelectedRunId("");
                    }}
                    style={{
                      width: "100%",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      background: "#ffffff",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      fontSize: "0.75rem",
                    }}
                  >
                    {datasets.data?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", color: "#475569", marginBottom: "2px", fontWeight: 600 }}>
                    Profile Run:
                  </label>
                  <select
                    value={selectedRunId}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      background: "#ffffff",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      fontSize: "0.75rem",
                    }}
                  >
                    {runs.data?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {profileRunOptionLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
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
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          boxShadow: isUser ? "0 2px 8px rgba(37,99,235,0.2)" : "none",
                        }}
                      >
                        {isUser ? (
                          m.text
                        ) : (
                          <div className="markdown-message-widget">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({node, ...props}) => <h1 style={{fontSize: "1.25rem", margin: "0.5rem 0", fontWeight: 700}} {...props} />,
                                h2: ({node, ...props}) => <h2 style={{fontSize: "1.1rem", margin: "0.5rem 0", fontWeight: 700}} {...props} />,
                                h3: ({node, ...props}) => <h3 style={{fontSize: "1rem", margin: "0.5rem 0", fontWeight: 700}} {...props} />,
                                h4: ({node, ...props}) => <h4 style={{fontSize: "0.95rem", margin: "0.5rem 0", fontWeight: 700}} {...props} />,
                                p: ({node, ...props}) => <p style={{margin: "0.25rem 0"}} {...props} />,
                                ul: ({node, ...props}) => <ul style={{margin: "0.5rem 0", paddingLeft: "1.2rem"}} {...props} />,
                                ol: ({node, ...props}) => <ol style={{margin: "0.5rem 0", paddingLeft: "1.2rem"}} {...props} />,
                                li: ({node, ...props}) => <li style={{margin: "0.25rem 0"}} {...props} />,
                                table: ({node, ...props}) => <div style={{overflowX: "auto", margin: "0.5rem 0"}}><table style={{width: "100%", borderCollapse: "collapse", fontSize: "0.8rem"}} {...props} /></div>,
                                th: ({node, ...props}) => <th style={{border: "1px solid #cbd5e1", padding: "4px 8px", background: "#f8fafc", textAlign: "left", fontWeight: 600}} {...props} />,
                                td: ({node, ...props}) => <td style={{border: "1px solid #cbd5e1", padding: "4px 8px"}} {...props} />,
                                code: ({node, ...props}) => <code style={{background: "rgba(0,0,0,0.05)", padding: "2px 4px", borderRadius: "4px", fontSize: "0.9em"}} {...props} />,
                                pre: ({node, ...props}) => <pre style={{background: "#f1f5f9", padding: "8px", borderRadius: "8px", overflowX: "auto", fontSize: "0.8rem", margin: "0.5rem 0"}} {...props} />,
                              }}
                            >
                              {m.text}
                            </ReactMarkdown>
                          </div>
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

                {isThinking && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#64748b", fontSize: "0.8rem", padding: "4px 8px" }}>
                    <span className="dashboard-loading-mark" style={{ width: "14px", height: "14px" }} />
                    AI Agent đang suy nghĩ & truy vấn bằng chứng…
                  </div>
                )}
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
                  placeholder="Hỏi AI về dataset, biểu đồ..."
                  disabled={isThinking}
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
                  disabled={!input.trim() || isThinking}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: input.trim() && !isThinking ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)" : "#cbd5e1",
                    color: "#ffffff",
                    border: "none",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: input.trim() && !isThinking ? "pointer" : "not-allowed",
                    boxShadow: input.trim() && !isThinking ? "0 2px 6px rgba(37,99,235,0.25)" : "none",
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
