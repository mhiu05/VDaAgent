import React from "react";
import { Bot, MessageSquareText, PanelRightClose, PanelRightOpen, ShieldCheck } from "lucide-react";

export function AgentPanel({ collapsed, setCollapsed, chatMessages, chatInput, setChatInput, sendChat, findings }) {
  const firstHitl = findings.find((finding) => finding.message?.includes("HITL"));
  if (collapsed) {
    return (
      <button className="agent-restore-button" onClick={() => setCollapsed(false)}>
        <Bot size={18} />
        <span>Agent</span>
        <PanelRightOpen size={16} />
      </button>
    );
  }

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        <div>
          <strong><Bot size={17} /> Agent</strong>
          <span>Profiling assistant</span>
        </div>
        <div className="assistant-actions">
          <span className="status-pill">HITL ready</span>
          <button className="panel-icon-button" onClick={() => setCollapsed(true)} aria-label="Hide agent panel">
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>
      <div className="chat-messages">
        {chatMessages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
            {message.text}
          </div>
        ))}
      </div>
      <div className="hitl-card">
        <strong><ShieldCheck size={16} /> Pending confirmation</strong>
        <p>{firstHitl?.message || "No key, PII, or relationship candidate selected yet."}</p>
        <div className="button-row">
          <button className="secondary-button">Reject</button>
          <button className="primary-button">Confirm</button>
        </div>
      </div>
      <form className="chat-form" onSubmit={sendChat}>
        <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask about this profile..." />
        <button className="primary-button" type="submit"><MessageSquareText size={16} /></button>
      </form>
    </aside>
  );
}
