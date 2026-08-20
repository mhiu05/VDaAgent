"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { getProfileReportDraft, pinAgentAnswerToReport, streamQuestion, type QAHistoryMessage } from '@/lib/api';
import type { AnalysisExecution } from '@/lib/analysis-types';
import type { AnswerSource } from "@/lib/types";
import { AnswerSources } from "@/components/answer-sources";
import { ErrorNotice, Notice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";

type Message = { role: 'user' | 'agent'; text: string; sources?: AnswerSource[]; agentRunId?: string | null; evidenceStatus?: string; executionId?: string | null };

export function AgentTab({ runId, execution }: { runId: string; execution: AnalysisExecution | null }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const autoExplainedExecution = useRef<string | null>(null);
  useEffect(() => () => {
    controller.current?.abort();
    controller.current = null;
    // React Strict Mode intentionally mounts/cleans up effects twice in
    // development. Reset this marker so the second mount starts the real
    // automatic explanation instead of leaving only the user prompt behind.
    autoExplainedExecution.current = null;
  }, []);

  async function pinAnswer(message: Message) {
    if (!message.agentRunId || message.evidenceStatus !== 'verified') return;
    setPinningId(message.agentRunId);
    setError(null);
    try {
      const draft = await getProfileReportDraft(runId);
      await pinAgentAnswerToReport(draft.id, message.agentRunId, 'Giải thích từ Agent', message.text);
      setPinnedId(message.agentRunId);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error('Không thể ghim câu trả lời.'));
    } finally {
      setPinningId(null);
    }
  }

  async function ask(prompt: string) {
    if (!prompt || busy) return;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const history: QAHistoryMessage[] = messages.slice(-12).map((item) => ({ role: item.role, text: item.text.slice(0, 2000) }));
    setQuestion(""); setError(null); setBusy(true); setMessages((current) => [...current, { role: "user", text: prompt }]);
    let draft = ''; let sources: AnswerSource[] = []; let agentRunId: string | null = null;
    let evidenceStatus = execution ? 'verified' : 'profile_only';
    let executionId: string | null = execution?.id ?? null;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; nextController.abort(); }, 60_000);
    try {
      await streamQuestion({
        question: prompt,
        profile_run_id: runId,
        history,
        analysis_execution_id: execution?.id,
        workspace_context_version_id: execution?.execution_kind === 'official' ? execution.context_version_id : undefined,
      }, (event) => {
        if (event.event === "token" && typeof event.data === "object" && event.data) draft += String((event.data as { text?: unknown }).text || "");
        if (event.event === "source" && typeof event.data === "object" && event.data) sources = (event.data as { sources?: AnswerSource[] }).sources || [];
        if (event.event === 'done' && typeof event.data === 'object' && event.data) {
          const done = event.data as { agent_run_id?: unknown; evidence_status?: unknown; analysis_execution_id?: unknown };
          agentRunId = String(done.agent_run_id || '') || null;
          evidenceStatus = String(done.evidence_status || evidenceStatus);
          executionId = String(done.analysis_execution_id || executionId || '') || null;
        }
        if (event.event === "error") throw new Error(String((event.data as { detail?: unknown })?.detail || "Agent response failed."));
      }, nextController.signal);
      setMessages((current) => [...current, { role: 'agent', text: draft || 'Agent không trả về nội dung.', sources, agentRunId, evidenceStatus, executionId }]);
    } catch (reason) {
      if (timedOut) setError(new Error("Agent mất hơn 60 giây để phản hồi. Hãy thử lại hoặc đặt câu hỏi ngắn hơn."));
      else if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason : new Error("Agent request failed."));
    } finally { window.clearTimeout(timeoutId); if (controller.current === nextController) controller.current = null; setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await ask(question.trim());
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void ask(question.trim());
  }

  useEffect(() => {
    if (!execution || autoExplainedExecution.current === execution.id) return;
    const prompt = 'Hãy giải thích kết quả này, nêu insight chính và các giới hạn cần lưu ý.';
    autoExplainedExecution.current = execution.id;
    setQuestion(prompt);
    const start = window.setTimeout(() => void ask(prompt), 0);
    return () => {
      window.clearTimeout(start);
      if (autoExplainedExecution.current === execution.id) autoExplainedExecution.current = null;
    };
  // A click on “Giải thích” is an explicit request; only rerun when its
  // execution changes, not while streaming state updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution]);

  const pinnable = [...messages].reverse().find((item) => item.role === 'agent' && item.agentRunId && item.evidenceStatus === 'verified');

  return <section className="command-agent">
    <header><h2>Hỏi Agent</h2><p className='muted'>Agent được khóa vào Profile Run hiện tại. Agent chỉ diễn giải evidence đã tính, không truy cập raw rows hay tự tính lại metric.</p></header>
    {execution ? <Notice tone={busy ? 'warning' : 'success'}>{busy ? <>Agent đang tạo lời giải thích cho execution <code>{execution.id}</code>…</> : <>Agent đang dựa trên execution <code>{execution.id}</code> · hash <code>{execution.result_hash.slice(0, 12)}</code>.</>}</Notice> : <Notice tone='info'>Profile evidence: <code>{runId}</code>. Bấm nút “Giải thích” bên tab Khám phá dữ liệu để yêu cầu Agent phân tích một kết quả chính thức.</Notice>}
    <div className="agent-message-list" aria-live="polite">{messages.length === 0 && <p className="muted">{busy ? 'Đang gửi câu hỏi tới Agent…' : 'Bắt đầu bằng câu hỏi về quality, PII, schema hoặc metric trong profile này.'}</p>}{messages.map((message, index) => <article className={`agent-message ${message.role}`} key={`${message.role}-${index}`}><div className="message-avatar">{message.role === "agent" ? "AI" : "You"}</div><div className="message-body">{message.role === "agent" ? <MarkdownContent text={message.text} /> : <p>{message.text}</p>}{message.role === "agent" && <><AnswerSources sources={message.sources} />{message.agentRunId ? <small className="muted">{message.evidenceStatus === 'verified' ? <>Đã xác thực bằng evidence của Profile Run · Agent run: {message.agentRunId}</> : <>Agent run: {message.agentRunId} · Chưa có evidence đủ điều kiện ghim báo cáo.</>}</small> : <small className="muted">Không có minh chứng (evidence) xác thực từ agent; câu trả lời này không thể ghim vào báo cáo.</small>}</>}</div></article>)}</div>
    {pinnable && <div className='agent-evidence-actions'><span className='chip'>Evidence verified · {pinnable.executionId?.slice(0, 12)}</span><button className='button secondary' type='button' onClick={() => void pinAnswer(pinnable)} disabled={pinningId === pinnable.agentRunId || pinnedId === pinnable.agentRunId}>{pinnedId === pinnable.agentRunId ? 'Đã ghim vào báo cáo' : pinningId === pinnable.agentRunId ? 'Đang ghim…' : 'Pin câu trả lời vào báo cáo'}</button></div>}
    {error && <ErrorNotice error={error} retry={() => setError(null)} />}
    <form className='agent-composer' onSubmit={submit}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder='Đặt câu hỏi về Profile Run này…' rows={2} disabled={busy} /><small className='muted'>Enter để gửi · Shift + Enter để xuống dòng</small><button className='button primary' disabled={busy || !question.trim()}>{busy ? 'Đang hỏi…' : 'Gửi câu hỏi'}</button>{busy && <button className='button secondary' type='button' onClick={() => controller.current?.abort()}>Dừng</button>}</form>
  </section>;
}
