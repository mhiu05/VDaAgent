import React, { useEffect, useMemo, useState } from "react";
import { Bot, FileText, MessageSquareText, Plus, Search, Upload, X } from "lucide-react";
import { formatDateTime, getSourceName } from "../results/utils/reportMetrics.js";

const QUICK_PROMPTS = [
  {
    label: "Summarize report",
    prompt: "Summarize this report: key issues, notable columns, and recommended next steps.",
  },
  {
    label: "Find PII",
    prompt: "Review PII signals in this report and suggest which fields need masking or HITL review.",
  },
  {
    label: "Profiling setup",
    prompt: "If I want to profile this dataset more deeply, suggest which profiling options should be enabled.",
  },
  {
    label: "Statistical tests",
    prompt: "Based on this report, which statistical tests should I run and which columns should I choose?",
  },
];

const CONFIG_CHOICES = [
  "Upload file",
  "Connect database",
  "Enable PII masking",
  "Run correlations",
  "Run statistical tests",
];

export function AgentWorkspaceView({
  currentReport,
  profileReports = [],
  openStoredReport,
  chatMessages,
  conversations = [],
  conversationId,
  selectConversation,
  startNewConversation,
  chatInput,
  setChatInput,
  askAgent,
  hitlRecords = [],
  loading,
  onOpenReports,
  knowledgeDocs = [],
  uploadKnowledgeDocs,
}) {
  const currentRunId = currentReport?.agent_run?.run_id || currentReport?.profile_metadata?.run_id || "";
  const [selectedRunId, setSelectedRunId] = useState(currentRunId);
  const [reportQuery, setReportQuery] = useState("");
  const [documents, setDocuments] = useState([]);
  const pendingHitl = hitlRecords.filter((record) => record.status === "pending");

  useEffect(() => {
    if (currentRunId) setSelectedRunId(currentRunId);
  }, [currentRunId]);

  const reportOptions = useMemo(() => {
    const summaries = [];
    if (currentReport) summaries.push(toReportOption(currentReport));
    profileReports.forEach((report) => summaries.push(toReportOption(report)));
    const unique = new Map();
    summaries.filter((item) => item.runId).forEach((item) => unique.set(item.runId, item));
    const query = reportQuery.trim().toLowerCase();
    return Array.from(unique.values()).filter((item) => {
      if (!query) return true;
      return [item.name, item.runId, item.type].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [currentReport, profileReports, reportQuery]);

  const selectedReport = reportOptions.find((report) => report.runId === selectedRunId) || null;
  const allDocuments = knowledgeDocs.length ? knowledgeDocs : documents;
  const docsContext = useMemo(() => buildDocsContext(allDocuments), [allDocuments]);

  async function selectReport(runId) {
    setSelectedRunId(runId);
    if (runId && runId !== currentRunId) {
      await openStoredReport?.(runId);
    }
  }

  async function attachDocuments(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (uploadKnowledgeDocs) {
      await uploadKnowledgeDocs(files);
      event.target.value = "";
      return;
    }
    const nextDocs = await Promise.all(files.map(readAgentDocument));
    setDocuments((current) => current.concat(nextDocs));
    event.target.value = "";
  }

  function removeDocument(id) {
    setDocuments((current) => current.filter((document) => document.id !== id));
  }

  async function submitChat(event) {
    event.preventDefault();
    await askAgent(chatInput, {
      runId: selectedRunId || null,
      context: docsContext,
    });
  }

  async function sendQuickPrompt(prompt) {
    await askAgent(prompt, {
      runId: selectedRunId || null,
      context: docsContext,
    });
  }

  function chooseConfig(choice) {
    const next = `I choose: ${choice}. Ask me for any missing information needed to configure profiling correctly.`;
    setChatInput(next);
  }

  return (
    <section className="agent-workspace-page">
      <header className="agent-workspace-header">
        <div>
          <span className="fabric-kicker">Agent workspace</span>
          <h2>Ask questions and configure profiling with the Agent</h2>
          <p>Select an existing report, attach requirement documents, or chat directly so the Agent can help configure profiling.</p>
        </div>
        <button className="primary-button" type="button" onClick={onOpenReports}>
          Open Reports
        </button>
      </header>

      <div className="agent-workspace-grid">
        <aside className="agent-context-panel panel">
          <section className="agent-context-section">
            <div className="panel-title">
              <h3>Report context</h3>
              <span className="muted">{reportOptions.length} reports</span>
            </div>
            <label className="agent-search-box">
              <Search size={15} />
              <input value={reportQuery} onChange={(event) => setReportQuery(event.target.value)} placeholder="Search report..." />
            </label>
            <div className="agent-report-list">
              {reportOptions.length ? reportOptions.map((report) => (
                <button
                  key={report.runId}
                  className={selectedRunId === report.runId ? "selected" : ""}
                  type="button"
                  onClick={() => selectReport(report.runId)}
                >
                  <strong title={report.name}>{report.name}</strong>
                  <span>{report.rows} rows / {report.columns} columns</span>
                  <small>{report.generated || report.runId}</small>
                </button>
              )) : (
                <div className="agent-empty-box">No matching reports found.</div>
              )}
            </div>
          </section>

          <section className="agent-context-section">
            <div className="panel-title">
              <h3>Documents</h3>
              <span className="muted">{allDocuments.length} files</span>
            </div>
            <label className="agent-doc-upload">
              <Upload size={18} />
              <span>Upload docs, PDFs, or text requirements</span>
              <input type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.json,.csv" onChange={attachDocuments} />
            </label>
            <div className="agent-doc-list">
              {allDocuments.map((document) => (
                <div key={document.id} className="agent-doc-row">
                  <FileText size={15} />
                  <div>
                    <strong title={document.name}>{document.name}</strong>
                    <span>{document.status || document.summary}</span>
                  </div>
                  {!knowledgeDocs.length && <button type="button" onClick={() => removeDocument(document.id)} aria-label={`Remove ${document.name}`}>
                    <X size={14} />
                  </button>}
                </div>
              ))}
              {!allDocuments.length ? <div className="agent-empty-box compact">Attach business requirements, data dictionaries, or policy PDFs.</div> : null}
            </div>
          </section>

          <section className="agent-context-section">
            <div className="panel-title">
              <h3>Missing configuration?</h3>
            </div>
            <div className="agent-choice-grid">
              {CONFIG_CHOICES.map((choice) => (
                <button key={choice} type="button" onClick={() => chooseConfig(choice)}>{choice}</button>
              ))}
            </div>
          </section>
        </aside>

        <main className="agent-chat-panel panel">
          <div className="agent-chat-header">
            <div>
              <strong><Bot size={18} /> Chat Agent</strong>
              <span>{selectedReport ? `Using ${selectedReport.name}` : "No report selected"}</span>
            </div>
            <div className="agent-chat-actions">
              <select value={conversationId || ""} onChange={(event) => selectConversation?.(event.target.value)}>
                <option value="">New conversation</option>
                {conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
                ))}
              </select>
              <button className="panel-icon-button" type="button" onClick={startNewConversation} title="Start new conversation">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="agent-selected-context">
            <span>{selectedReport ? `${selectedReport.rows} rows / ${selectedReport.columns} columns` : "You can chat first; the Agent will ask for missing configuration."}</span>
            <span>{pendingHitl.length ? `${pendingHitl.length} HITL pending` : "No pending HITL"}</span>
            <span>{allDocuments.length ? `${allDocuments.length} docs attached` : "No docs attached"}</span>
          </div>

          <div className="agent-quick-prompts">
            {QUICK_PROMPTS.map((item) => (
              <button key={item.label} type="button" onClick={() => sendQuickPrompt(item.prompt)} disabled={loading}>
                {item.label}
              </button>
            ))}
          </div>

          <div className="agent-chat-messages">
            {chatMessages.map((message, index) => (
              <div key={message.id || `${message.role}-${index}`} className={`chat-message ${message.role}`}>
                {message.text}
              </div>
            ))}
          </div>

          <form className="agent-chat-form" onSubmit={submitChat}>
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask about this report, profiling requirements, PII rules, or statistical tests..."
              rows={3}
            />
            <button className="primary-button" type="submit" disabled={loading || !chatInput.trim()}>
              <MessageSquareText size={16} />
              Send
            </button>
          </form>
        </main>
      </div>
    </section>
  );
}

function toReportOption(report) {
  const runId = report.run_id || report.agent_run?.run_id || report.profile_metadata?.run_id || "";
  return {
    runId,
    name: report.source_name || getSourceName(report) || "Unnamed report",
    type: report.source_type || report.source?.type || "report",
    rows: Number(report.row_count ?? report.dataset_summary?.row_count ?? 0).toLocaleString("en-US"),
    columns: Number(report.column_count ?? report.dataset_summary?.column_count ?? 0).toLocaleString("en-US"),
    generated: report.generated_at ? formatDateTime(report.generated_at) : "",
  };
}

async function readAgentDocument(file) {
  const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const lowerName = file.name.toLowerCase();
  const textLike = [".txt", ".md", ".json", ".csv"].some((suffix) => lowerName.endsWith(suffix));
  if (!textLike) {
    return {
      id,
      name: file.name,
      type: file.type || "document",
      size: file.size,
      text: "",
      status: "Attached as file metadata",
    };
  }
  try {
    const text = await file.text();
    return {
      id,
      name: file.name,
      type: file.type || "text",
      size: file.size,
      text: text.slice(0, 6000),
      status: text.length > 6000 ? "Text attached, truncated" : "Text attached",
    };
  } catch {
    return {
      id,
      name: file.name,
      type: file.type || "document",
      size: file.size,
      text: "",
      status: "Attached, content unreadable",
    };
  }
}

function buildDocsContext(documents) {
  if (!documents.length) return "";
  return documents.map((document) => (
    [
      `Document: ${document.name}`,
      `Type: ${document.type || document.content_type || "document"}`,
      `Status: ${document.status}`,
      document.extracted_text || document.text
        ? `Content excerpt:\n${document.extracted_text || document.text}`
        : `Content excerpt: ${document.summary || "not available"}`,
    ].join("\n")
  )).join("\n\n---\n\n");
}
