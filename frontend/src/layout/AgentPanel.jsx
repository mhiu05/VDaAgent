import React from "react";
import { Bot, MessageSquareText, PanelRightClose, PanelRightOpen, Plus, ShieldCheck } from "lucide-react";

export function AgentPanel({ collapsed, setCollapsed, chatMessages, conversations = [], conversationId, selectConversation, startNewConversation, chatInput, setChatInput, sendChat, findings, hitlRecords = [], decideHitl }) {
  const firstHitl = hitlRecords.find((record) => record.status === "pending");
  const pendingCount = hitlRecords.filter((record) => record.status === "pending").length;
  if (collapsed) {
    return (
      <button className="agent-restore-button" onClick={() => setCollapsed(false)}>
        <Bot size={18} /><span>Agent</span><PanelRightOpen size={16} />
      </button>
    );
  }

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        <div><strong><Bot size={17} /> Agent</strong><span>Profiling assistant</span></div>
        <div className="assistant-actions">
          <span className={`status-pill ${pendingCount ? "attention" : ""}`}>{pendingCount ? `${pendingCount} HITL pending` : "Ready"}</span>
          <button className="panel-icon-button" onClick={() => setCollapsed(true)} aria-label="Hide agent panel"><PanelRightClose size={16} /></button>
        </div>
      </div>
      <div className="chat-history-toolbar">
        <select aria-label="Conversation history" value={conversationId || ""} onChange={(event) => selectConversation?.(event.target.value)}>
          <option value="">New conversation</option>
          {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
        </select>
        <button className="panel-icon-button" type="button" onClick={startNewConversation} aria-label="Start new conversation" title="Start new conversation"><Plus size={16} /></button>
      </div>
      <div className="chat-messages">
        {chatMessages.map((message, index) => (
          <div key={message.id || `${message.role}-${index}`} className={`chat-message ${message.role}`}>{message.text}</div>
        ))}
      </div>
      {firstHitl ? (
        <div className="hitl-card">
          <strong><ShieldCheck size={16} /> Pending confirmation</strong>
          <p>{firstHitl.evidence || findings.find((finding) => finding.message?.includes("HITL"))?.message}</p>
          <small className="muted-text">{firstHitl.type} / {firstHitl.source}</small>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => decideHitl?.(firstHitl.id, "reject")}>Reject</button>
            <button className="primary-button" type="button" onClick={() => decideHitl?.(firstHitl.id, "approve")}>Confirm</button>
          </div>
        </div>
      ) : (
        <div className="hitl-empty-status"><ShieldCheck size={15} /><span>No pending reviews</span></div>
      )}
      <form className="chat-form" onSubmit={sendChat}>
        <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask about this profile..." />
        <button className="primary-button" type="submit" aria-label="Send message"><MessageSquareText size={16} /></button>
      </form>
    </aside>
  );
}
