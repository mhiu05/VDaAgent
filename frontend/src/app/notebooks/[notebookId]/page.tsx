"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  archiveNotebook,
  askQuestion,
  createNotebookCell,
  deleteNotebookCell,
  downloadNotebook,
  getNotebook,
  shareNotebook,
  updateNotebook,
  updateNotebookCell,
} from "@/lib/api";
import type { NotebookCell } from "@/lib/notebook-types";
import { ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

export default function NotebookPage() {
  const params = useParams<{ notebookId: string }>();
  const router = useRouter();
  const notebook = useQuery({ queryKey: ["notebook", params.notebookId], queryFn: ({ signal }) => getNotebook(params.notebookId, signal), enabled: Boolean(params.notebookId) });
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  if (notebook.isLoading) return <LoadingBlock label="Đang mở phiên phân tích…" />;
  if (notebook.isError || !notebook.data) return <ErrorNotice error={notebook.error || new Error("Không tìm thấy phiên phân tích.")} retry={() => notebook.refetch()} />;

  const data = notebook.data;
  const cells = data.cells || [];

  async function refresh() {
    await notebook.refetch();
  }

  async function addCell(kind: "markdown" | "prompt") {
    setError(null);
    try {
      await createNotebookCell(data.id, { kind, source: kind === "prompt" ? "Hãy phân tích profile này và nêu ra các điểm cần chú ý." : "Ghi chú mới…", title: kind === "prompt" ? "Câu hỏi Agent" : "Ghi chú" });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể thêm cell."));
    }
  }

  async function saveCell(cell: NotebookCell, source: string) {
    if (source.trim() === cell.source.trim()) return;
    setError(null);
    try {
      await updateNotebookCell(data.id, cell.id, { source });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể lưu cell."));
    }
  }

  async function runPrompt(cell: NotebookCell) {
    setBusyCell(cell.id);
    setError(null);
    try {
      // Persist the edited prompt together with the running state. This keeps
      // the exported notebook source identical to the prompt actually sent
      // to the Agent when the user clicks Run before blur finishes.
      await updateNotebookCell(data.id, cell.id, { source: cell.source, status: "running" });
      const response = await askQuestion({ question: cell.source, profile_run_id: data.profile_run_id });
      await updateNotebookCell(data.id, cell.id, { status: "completed", result: { answer: response.answer, sources: response.sources as Array<Record<string, unknown>>, agent_run_id: response.agent_run_id } });
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Agent không thể chạy cell.";
      try { await updateNotebookCell(data.id, cell.id, { status: "failed", result: { error: message } }); } catch { /* preserve the original error */ }
      setError(new Error(message));
    } finally {
      setBusyCell(null);
    }
  }

  async function removeCell(cell: NotebookCell) {
    if (!window.confirm("Xóa cell này khỏi notebook?")) return;
    try {
      await deleteNotebookCell(data.id, cell.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể xóa cell."));
    }
  }

  async function toggleShare() {
    try {
      await shareNotebook(data.id, data.visibility === "workspace" ? "private" : "workspace");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể cập nhật chia sẻ."));
    }
  }

  async function exportJson() {
    try {
      const blob = await downloadNotebook(data.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `phien-phan-tich-${data.id}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể xuất phiên phân tích."));
    }
  }

  async function archive() {
    if (!window.confirm("Lưu trữ phiên phân tích này? Phiên không bị xóa và có thể khôi phục trong Kho lưu trữ.")) return;
    try {
      await archiveNotebook(data.id);
      router.push("/notebooks");
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể lưu trữ phiên phân tích."));
    }
  }

  return <main className="notebook-page">
    <PageHeader
      eyebrow={`PHIÊN PHÂN TÍCH · ${data.profile_run_name || `Phiên bản v${data.profile_run_version ?? "—"}`}`}
      title={data.title}
      description={data.description || "Lưu ghi chú và câu hỏi Agent có cấu trúc trên đúng nguồn profiling đã chọn."}
      action={<div className="inline-actions"><Link className="button secondary" href="/notebooks">← Danh sách phiên</Link><span className={`notebook-visibility ${data.visibility}`}>{data.visibility === "workspace" ? "Đã chia sẻ workspace" : "Riêng tư"}</span></div>}
    />
    {error && <ErrorNotice error={error} />}

    <section className="panel notebook-toolbar">
      <div><p className="eyebrow">NGUỒN PROFILING</p><b>{data.profile_run_name || `Phiên bản v${data.profile_run_version ?? "—"}`}</b><small>Cập nhật {formatDate(data.updated_at)} · Kết quả Agent được lưu theo từng cell. Chia sẻ chỉ cho thành viên workspace cùng xem hoặc bàn giao.</small></div>
      <div className="inline-actions"><button className="button secondary" type="button" title="Cho phép thành viên trong workspace cùng xem phiên phân tích này" onClick={() => void toggleShare()}>{data.visibility === "workspace" ? "Thu hồi chia sẻ" : "Chia sẻ với workspace"}</button><button className="button secondary" type="button" onClick={() => void exportJson()}>Xuất JSON</button><button className="button primary" type="button" onClick={() => window.print()}>In / lưu PDF</button><button className="button danger-outline" type="button" onClick={() => void archive()}>Lưu trữ</button></div>
    </section>

    <section className="notebook-canvas">
      <div className="notebook-canvas-heading"><div><p className="eyebrow">DÒNG PHÂN TÍCH</p><h2>Ghi chú và câu hỏi</h2><p>Ghi chú để lưu lập luận; Câu hỏi Agent để khai thác đúng phiên profiling đã chọn. Nội dung được lưu khi bạn rời khỏi ô.</p></div><div className="inline-actions"><button className="button secondary" type="button" onClick={() => void addCell("markdown")}>+ Ghi chú</button><button className="button primary" type="button" onClick={() => void addCell("prompt")}>+ Câu hỏi Agent</button></div></div>
      {!cells.length && <Notice tone="info">Thêm một cell Prompt Agent để bắt đầu.</Notice>}
      <div className="notebook-cell-list">
        {cells.map((cell, index) => <NotebookCellView key={cell.id} cell={cell} index={index} busy={busyCell === cell.id} onSave={saveCell} onRun={runPrompt} onDelete={removeCell} />)}
      </div>
    </section>
  </main>;
}

function NotebookCellView({ cell, index, busy, onSave, onRun, onDelete }: { cell: NotebookCell; index: number; busy: boolean; onSave: (cell: NotebookCell, source: string) => Promise<void>; onRun: (cell: NotebookCell) => Promise<void>; onDelete: (cell: NotebookCell) => Promise<void> }) {
  const [source, setSource] = useState(cell.source);
  const result = cell.result;
  return <article className={`notebook-cell notebook-cell-${cell.kind}`}>
    <div className="notebook-cell-gutter"><span>{String(index + 1).padStart(2, "0")}</span><i aria-hidden="true">{cell.kind === "prompt" ? "✦" : "¶"}</i></div>
    <div className="notebook-cell-body">
      <div className="notebook-cell-header"><div><span className="notebook-cell-kind">{cell.kind === "prompt" ? "PROMPT AGENT" : "MARKDOWN"}</span><b>{cell.title || "Cell không tên"}</b></div><span className={`status status-${cell.status}`}>{cell.status === "completed" ? "Đã chạy" : cell.status === "running" ? "Đang chạy" : cell.status === "failed" ? "Lỗi" : "Bản nháp"}</span></div>
      <textarea className="notebook-cell-editor" value={source} onChange={(event) => setSource(event.target.value)} onBlur={() => void onSave(cell, source)} aria-label={`Nội dung cell ${index + 1}`} />
      <div className="notebook-cell-actions"><button className="button ghost" type="button" onClick={() => void onSave(cell, source)}>Lưu ngay</button>{cell.kind === "prompt" && <button className="button primary" type="button" disabled={busy} onClick={() => void onRun({ ...cell, source })}>{busy ? "Agent đang suy nghĩ…" : "Chạy Agent"}</button>}<button className="button danger-outline" type="button" onClick={() => void onDelete(cell)}>Xóa</button></div>
      {result?.answer && <div className="notebook-cell-result"><div className="notebook-result-label">KẾT QUẢ AGENT</div><MarkdownContent text={result.answer} className="report report-markdown" />{result.sources?.length ? <small>{result.sources.length} nguồn evidence · chỉ gồm metadata/aggregate, không có raw rows</small> : null}</div>}
      {result?.error && <Notice tone="warning">{result.error}</Notice>}
    </div>
  </article>;
}
