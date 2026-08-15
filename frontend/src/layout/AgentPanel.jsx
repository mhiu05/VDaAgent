import React, { useEffect, useMemo, useState } from "react";
import { Bot, FileText, MessageSquareText, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { formatDateTime, getSourceName } from "../results/utils/reportMetrics.js";

export function AgentPanel({
  collapsed,
  setCollapsed,
  chatMessages,
  conversations = [],
  conversationId,
  selectConversation,
  startNewConversation,
  chatInput,
  setChatInput,
  sendChat,
  askAgent,
  loading,
  currentReport,
  profileReports = [],
  openStoredReport,
  openReviewCenter,
  onResizeStart,
}) {
  const currentRunId = currentReport?.agent_run?.run_id || currentReport?.profile_metadata?.run_id || "";
  const [selectedRunId, setSelectedRunId] = useState(currentRunId);
  const reportOptions = useMemo(() => {
    const unique = new Map();
    profileReports.map(toReportOption).filter((item) => item.runId).forEach((item) => unique.set(item.runId, item));
    return Array.from(unique.values()).slice(0, 25);
  }, [profileReports]);
  const selectedReport = reportOptions.find((report) => report.runId === selectedRunId) || null;

  useEffect(() => {
    if (!reportOptions.length) {
      setSelectedRunId("");
      return;
    }
    const currentSaved = reportOptions.find((report) => report.runId === currentRunId);
    setSelectedRunId((current) => {
      if (current && reportOptions.some((report) => report.runId === current)) return current;
      return currentSaved?.runId || reportOptions[0].runId;
    });
  }, [currentRunId, reportOptions]);

  async function selectReport(runId) {
    setSelectedRunId(runId);
    if (runId && runId !== currentRunId) {
      await openStoredReport?.(runId);
    }
  }

  async function submitChat(event) {
    event.preventDefault();
    if (!askAgent) {
      await sendChat?.(event);
      return;
    }
    await askAgent(chatInput, { runId: selectedRunId || null });
  }

  if (collapsed) {
    return (
      <button className="agent-restore-button" type="button" onClick={() => setCollapsed(false)}>
        <Bot size={18} />
        <span>Agent</span>
        <PanelRightOpen size={16} />
      </button>
    );
  }

  return (
    <aside className="assistant-panel">
      <button
        className="agent-resize-handle"
        type="button"
        onMouseDown={onResizeStart}
        aria-label="Resize Agent panel"
        title="Resize Agent panel"
      />
      <div className="assistant-header">
        <div>
          <strong><Bot size={17} /> Agent</strong>
        </div>
        <div className="assistant-actions">
          <button className="panel-icon-button" type="button" onClick={() => setCollapsed(true)} aria-label="Hide Agent panel">
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>

      <div className="chat-history-toolbar">
        <select
          aria-label="Conversation history"
          value={conversationId || ""}
          onChange={(event) => selectConversation?.(event.target.value)}
        >
          <option value="">New conversation</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
          ))}
        </select>
        <button
          className="panel-icon-button"
          type="button"
          onClick={startNewConversation}
          aria-label="Start new conversation"
          title="Start new conversation"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="agent-report-picker">
        <label>
          <span><FileText size={14} /> Report</span>
          <select
            value={selectedRunId || ""}
            onChange={(event) => selectReport(event.target.value)}
            disabled={!reportOptions.length || loading}
          >
            <option value="">{reportOptions.length ? "Select saved report" : "No saved reports"}</option>
            {reportOptions.map((report) => (
              <option key={report.runId} value={report.runId}>
                {report.label}
              </option>
            ))}
          </select>
        </label>
        <small title={selectedReport?.runId || ""}>
          {selectedReport
            ? `${selectedReport.rows} rows / ${selectedReport.columns} columns`
            : "Save or load a profiling report first."}
        </small>
      </div>

      <div className="chat-messages">
        {chatMessages.map((message, index) => (
          <div key={message.id || `${message.role}-${index}`} className={`chat-message ${message.role}`}>
            <FormattedMessage text={message.text} />
          </div>
        ))}
      </div>

      <form className="chat-form" onSubmit={submitChat}>
        <input
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          placeholder={selectedReport ? "Ask about this saved report..." : "Ask the agent..."}
        />
        <button className="primary-button" type="submit" aria-label="Send message" disabled={loading || !chatInput.trim()}>
          <MessageSquareText size={16} />
        </button>
      </form>
    </aside>
  );
}

function FormattedMessage({ text }) {
  const blocks = parseMessageBlocks(String(text || ""));
  return (
    <div className="chat-message-content">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}
            </ul>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

function parseMessageBlocks(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let code = [];
  let inCode = false;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    blocks.push({ type: "list", items: list });
    list = [];
  }

  function flushCode() {
    if (!code.length) return;
    blocks.push({ type: "code", text: code.join("\n") });
    code = [];
  }

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      code.push(line);
      return;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/) || trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      return;
    }
    if (list.length) flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  flushCode();
  return blocks.length ? blocks : [{ type: "paragraph", text }];
}

function toReportOption(report) {
  const runId = report.run_id || report.agent_run?.run_id || report.profile_metadata?.run_id || "";
  const generated = report.generated_at ? formatDateTime(report.generated_at) : "";
  const name = report.source_name || getSourceName(report) || "Unnamed report";
  return {
    runId,
    name,
    label: ["Saved report", name, generated].filter(Boolean).join(" - "),
    rows: Number(report.row_count ?? report.dataset_summary?.row_count ?? 0).toLocaleString("en-US"),
    columns: Number(report.column_count ?? report.dataset_summary?.column_count ?? 0).toLocaleString("en-US"),
    generated,
  };
}
