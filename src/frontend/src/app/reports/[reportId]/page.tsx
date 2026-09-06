"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { ApiError, downloadPublishedReportPdf, getReportExportSource, getProfileReportDraft, reorderReportDraft, snapshotReportDraft, unpinReportDraftItem, updateReportDraftItem, updateReportDraftTitle, type ReportDraft } from "@/lib/api";
import { ErrorNotice, LoadingBlock, LoadingButton, EmptyState, useToast } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { ChartEvidenceView } from "@/components/command-center/chart-evidence-view";
import { TopValues, Distribution, MetricChart, CorrelationPanel } from "@/components/report-components";
import { DRIFT_PART_TITLE, driftDetailText, driftDisplayValue, driftEvidenceLabel, driftSeverityLabel, driftSeverityLabels, driftSignalLabel, driftTypeLabel, groupDriftFindings } from "@/lib/drift-evidence";

function ReportAccordion({
  id,
  eyebrow,
  title,
  description,
  children,
  className = "",
  forceOpen = false,
}: {
  id: string;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  forceOpen?: boolean;
}) {
  return (
    <details id={id} className={`report-accordion ${className}`.trim()} open={forceOpen || undefined}>
      <summary className="report-accordion-summary">
        <span className="report-accordion-chevron" aria-hidden="true" />
        <span className="report-accordion-copy">
          <span className="report-accordion-eyebrow">{eyebrow}</span>
          <span className="report-accordion-title" role="heading" aria-level={2}>{title}</span>
          {description && <span className="report-accordion-description">{description}</span>}
        </span>
        <span className="report-accordion-action">Xem chi tiết</span>
      </summary>
      <div className="report-accordion-content">{children}</div>
    </details>
  );
}

function DriftEvidenceDetails({ reports }: { reports: any[] }) {
  const columns = groupDriftFindings(reports);
  const findings = columns.flatMap((column) => column.findings);
  const major = findings.filter((finding) => finding.severity === "major").length;
  const minor = findings.filter((finding) => finding.severity === "minor").length;
  return <div className="report-drift-details" style={{ marginTop: "1.5rem" }}>
    <div className="compare-summary-grid" style={{ marginBottom: "1rem" }}>
      <article><span>{driftSeverityLabels.major}</span><b>{major}</b><small>Signal major</small></article>
      <article><span>{driftSeverityLabels.minor}</span><b>{minor}</b><small>Signal minor</small></article>
      <article><span>Cột có evidence</span><b>{columns.length}</b><small>{driftSignalLabel(findings.length)}</small></article>
    </div>
    {columns.length > 0 && <div style={{ overflowX: "auto" }}><table className="compare-table" style={{ width: "100%" }}><thead><tr><th>Cột</th><th>Severity</th><th>Evidence</th><th>Signal</th></tr></thead><tbody>
      {columns.map((column) => <tr key={column.name}><td><b>{column.name}</b></td><td><span className={`compare-severity compare-severity-${column.severity}`}>{driftSeverityLabels[column.severity]}</span></td><td>{driftEvidenceLabel(column.findings[0])}</td><td>{driftSignalLabel(column.findings.length)}</td></tr>)}
    </tbody></table></div>}
      <div className="report-drift-column-list">{columns.map((column) => <details key={column.name} className="report-drift-column">
        <summary className="report-drift-column-summary">
          <span className="report-accordion-chevron" aria-hidden="true" />
          <span className="report-drift-column-copy">
            <span className="eyebrow">EVIDENCE CỘT</span>
            <span className="report-drift-column-name" role="heading" aria-level={3}>{column.name}</span>
            <span className="report-drift-column-meta">{driftSignalLabel(column.findings.length)} từ backend</span>
          </span>
          <span className={`compare-severity compare-severity-${column.severity}`}>{driftSeverityLabels[column.severity]}</span>
          <span className="report-drift-column-action">Xem metrics</span>
        </summary>
        <div className="report-drift-column-content">
          <div className="compare-evidence-list">{column.findings.map((finding: any, index: number) => <article key={`${finding.drift_type}-${index}`} className="compare-evidence-item"><div><b>{driftTypeLabel(finding.drift_type)}</b><span className={`compare-severity compare-severity-${finding.severity}`}>{driftSeverityLabel(finding.severity)}</span></div><p>{driftDetailText(finding.detail)}</p><dl><div><dt>Evidence</dt><dd>{driftEvidenceLabel(finding)}</dd></div>{(finding.baseline_value !== undefined || finding.current_value !== undefined) && <><div><dt>Baseline</dt><dd>{driftDisplayValue(finding.baseline_value)}</dd></div><div><dt>Current</dt><dd>{driftDisplayValue(finding.current_value)}</dd></div></>}</dl></article>)}</div>
        </div>
      </details>)}</div>
  </div>;
}

const reportDraftQueryKey = (runId: string) => ["command-center", runId, "report-draft"] as const;
const activeReportDraftWrites = new Set<string>();

function startReportDraftWrite(runId: string) {
  if (activeReportDraftWrites.has(runId)) return false;
  activeReportDraftWrites.add(runId);
  return true;
}

function finishReportDraftWrite(runId: string) {
  activeReportDraftWrites.delete(runId);
}

function scrollToReportSection(id: string) {
  const target = document.getElementById(id);
  const accordion = target?.closest("details");
  if (accordion instanceof HTMLDetailsElement) accordion.open = true;
  target?.scrollIntoView({ behavior: "smooth" });
}

function ReportItemActions({
  item,
  reportId,
  runId,
  draftItemId,
}: {
  item: any;
  reportId: string;
  runId: string;
  draftItemId: string | null;
}) {
  const client = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const draftMutationCount = useIsMutating({ mutationKey: ["report-draft-write", runId] });
  const exportSourceKey = ["report-export-source", reportId] as const;
  const draftKey = reportDraftQueryKey(runId);
  const itemLabel = item.title || (item.item_type === "chart" ? "Biểu đồ Phân tích" : "Kết luận từ Agent");
  const canMutate = Boolean(draftItemId) && draftMutationCount === 0;

  const updateItem = useMutation({
    mutationKey: ["report-draft-write", runId],
    mutationFn: async ({ title, note }: { title: string; note: string }) => {
      if (!draftItemId) throw new Error("Không xác định được mục hiện tại trong Report Draft.");
      await updateReportDraftItem(reportId, draftItemId, { title, note });
      return snapshotReportDraft(reportId);
    },
    onSuccess: async () => {
      setIsEditing(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: exportSourceKey }),
        client.invalidateQueries({ queryKey: draftKey }),
      ]);
    },
    onSettled: () => finishReportDraftWrite(runId),
  });

  const deleteItem = useMutation({
    mutationKey: ["report-draft-write", runId],
    mutationFn: async () => {
      if (!draftItemId) throw new Error("Không xác định được mục hiện tại trong Report Draft.");
      await unpinReportDraftItem(reportId, draftItemId);
      return snapshotReportDraft(reportId);
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: exportSourceKey }),
        client.invalidateQueries({ queryKey: draftKey }),
      ]);
    },
    onSettled: () => finishReportDraftWrite(runId),
  });

  function handleDelete() {
    if (!canMutate || !window.confirm(`Xóa mục “${itemLabel}” khỏi báo cáo cuối cùng?`)) return;
    if (startReportDraftWrite(runId)) deleteItem.mutate();
  }

  if (isEditing) {
    return (
      <div className="report-item-actions report-item-editing" aria-busy={updateItem.isPending}>
        <form
          className="report-item-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canMutate) return;
            const form = new FormData(event.currentTarget);
            if (startReportDraftWrite(runId)) {
              updateItem.mutate({
                title: String(form.get("title") || ""),
                note: String(form.get("note") || ""),
              });
            }
          }}
        >
          <label>
            <span>Tiêu đề</span>
            <input name="title" defaultValue={item.title || ""} aria-label={`Tiêu đề mục ${itemLabel}`} disabled={draftMutationCount > 0} />
          </label>
          <label>
            <span>Ghi chú</span>
            <textarea name="note" defaultValue={item.note || ""} rows={2} aria-label={`Ghi chú mục ${itemLabel}`} disabled={draftMutationCount > 0} />
          </label>
          <div className="report-item-edit-form-actions">
            <button className="button primary" type="submit" disabled={!canMutate || updateItem.isPending}>{updateItem.isPending ? "Đang lưu…" : "Lưu thay đổi"}</button>
            <button className="button secondary" type="button" onClick={() => setIsEditing(false)} disabled={updateItem.isPending}>Hủy</button>
          </div>
        </form>
        {updateItem.isError && <ErrorNotice error={updateItem.error} />}
      </div>
    );
  }

  return (
    <div className="report-item-actions" aria-busy={deleteItem.isPending}>
      <button type="button" className="button secondary" onClick={() => setIsEditing(true)} disabled={!canMutate} title={!draftItemId ? "Đang tải Report Draft" : undefined}>Chỉnh sửa</button>
      <button type="button" className="button danger" onClick={handleDelete} disabled={!canMutate || deleteItem.isPending}>{deleteItem.isPending ? "Đang xóa…" : "Xóa"}</button>
      {(updateItem.isError || deleteItem.isError) && <ErrorNotice error={updateItem.error || deleteItem.error} />}
    </div>
  );
}

function resolveReportDraftItemId(item: any, index: number, draft: ReportDraft | undefined, isDraftFallback: boolean): string | null {
  if (!draft) return isDraftFallback && typeof item.id === "string" ? item.id : null;
  const directMatch = draft.items.find((draftItem) => draftItem.id === item.id);
  if (directMatch) return directMatch.id;
  const executionMatch = item.query_execution_id
    ? draft.items.find((draftItem) => draftItem.query_execution_id === item.query_execution_id)
    : undefined;
  if (executionMatch) return executionMatch.id;
  const agentMatch = item.agent_run_id
    ? draft.items.find((draftItem: any) => draftItem.agent_run_id === item.agent_run_id && draftItem.item_type === item.item_type)
    : undefined;
  if (agentMatch) return agentMatch.id;
  const position = typeof item.position === "number" ? item.position : index;
  return draft.items.find((draftItem) => draftItem.position === position && draftItem.item_type === item.item_type)?.id || null;
}

// --- Inline Editor Component ---
function InlineDraftItem({ item, index, totalItems, runId, draftId, onExit }: { item: any; index: number; totalItems: number; runId: string; draftId: string; onExit: () => void }) {
  const client = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const key = reportDraftQueryKey(runId);
  const draftMutationCount = useIsMutating({ mutationKey: ["report-draft-write", runId] });
  
  const updateItem = useMutation({
    mutationKey: ["report-draft-write", runId],
    mutationFn: ({ title, note }: { title: string; note: string }) => updateReportDraftItem(draftId, item.id, { title, note }),
    onMutate: async ({ title, note }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ReportDraft>(key);
      client.setQueryData<ReportDraft>(key, (old) => old ? {
        ...old,
        items: old.items.map((draftItem) => draftItem.id === item.id ? { ...draftItem, title, note } : draftItem),
      } : old);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
    },
    onSuccess: () => setIsEditing(false),
    onSettled: () => {
      finishReportDraftWrite(runId);
      return client.invalidateQueries({ queryKey: key });
    },
  });
  
  const unpin = useMutation({
    mutationKey: ["report-draft-write", runId],
    mutationFn: () => unpinReportDraftItem(draftId, item.id),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ReportDraft>(key);
      client.setQueryData<ReportDraft>(key, (old) => old ? {
        ...old,
        items: old.items.filter((draftItem) => draftItem.id !== item.id),
      } : old);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
    },
    onSettled: () => {
      finishReportDraftWrite(runId);
      return client.invalidateQueries({ queryKey: key });
    },
  });
  
  const move = useMutation({
    mutationKey: ["report-draft-write", runId],
    mutationFn: ({ itemIds, expectedDraftVersion }: { itemIds: string[]; expectedDraftVersion: number }) => reorderReportDraft(draftId, itemIds, expectedDraftVersion),
    onMutate: async ({ itemIds }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ReportDraft>(key);
      client.setQueryData<ReportDraft>(key, (old) => {
        if (!old) return old;
        const byId = new Map(old.items.map((draftItem) => [draftItem.id, draftItem]));
        return {
          ...old,
          items: itemIds.map((id, position) => byId.get(id) ? { ...byId.get(id)!, position } : undefined).filter((draftItem): draftItem is ReportDraft["items"][number] => Boolean(draftItem)),
        };
      });
      return { previous };
    },
    onSuccess: (next) => client.setQueryData(key, next),
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      if (error instanceof ApiError && error.status === 409) {
        // The server draft version is authoritative. Reconciliation below
        // discards this order and refetches the canonical draft.
        onExit();
        void client.invalidateQueries({ queryKey: key });
      }
    },
    onSettled: () => {
      finishReportDraftWrite(runId);
      return client.invalidateQueries({ queryKey: key });
    },
  });

  function startMove(direction: -1 | 1) {
    if (!startReportDraftWrite(runId)) return;
    const draft = client.getQueryData<ReportDraft>(key);
    if (!draft) {
      finishReportDraftWrite(runId);
      return;
    }
    const currentIndex = draft.items.findIndex((draftItem) => draftItem.id === item.id);
    const target = currentIndex + direction;
    if (currentIndex < 0 || target < 0 || target >= draft.items.length) {
      finishReportDraftWrite(runId);
      return;
    }
    const itemIds = draft.items.map((draftItem) => draftItem.id);
    [itemIds[currentIndex], itemIds[target]] = [itemIds[target], itemIds[currentIndex]];
    move.mutate({ itemIds, expectedDraftVersion: draft.draft_version });
  }

  return (
    <article className="panel report-detail-section" style={{ padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05)", position: "relative" }}>
      <div style={{ position: "absolute", top: "1rem", right: "1rem", display: "flex", gap: "0.5rem", zIndex: 10 }}>
        {!isEditing ? (
          <>
            <button type="button" className="button secondary" onClick={() => startMove(-1)} disabled={index === 0 || draftMutationCount > 0} title="Lên" style={{ padding: "4px 8px" }}>↑</button>
            <button type="button" className="button secondary" onClick={() => startMove(1)} disabled={index === totalItems - 1 || draftMutationCount > 0} title="Xuống" style={{ padding: "4px 8px" }}>↓</button>
            <button type="button" className="button secondary" onClick={() => setIsEditing(true)} disabled={draftMutationCount > 0} style={{ padding: "4px 12px" }}>✏️ Edit</button>
            <button type="button" className="button danger" onClick={() => { if (startReportDraftWrite(runId)) unpin.mutate(); }} disabled={draftMutationCount > 0} style={{ padding: "4px 12px" }}>Bỏ ghim</button>
          </>
        ) : (
          <button type="button" className="button secondary" onClick={() => setIsEditing(false)} style={{ padding: "4px 12px" }}>Hủy</button>
        )}
      </div>

      <header style={{ marginBottom: "1.25rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingRight: "150px" }}>
          <span className="eyebrow" style={{ textTransform: "uppercase", fontSize: "0.75rem", color: "#2563eb", fontWeight: 700 }}>
            {item.item_type === "chart" ? `CÂU HỎI #${index + 1}` : `GHI CHÚ #${index + 1}`}
          </span>
          {item.query_spec && (
            <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: "4px" }}>
              {item.query_spec.aggregate} · {item.query_spec.analysis_kind}
            </span>
          )}
        </div>
        
        {isEditing ? (
          <form onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            if (startReportDraftWrite(runId)) {
              updateItem.mutate({ title: String(form.get("title") || ""), note: String(form.get("note") || "") });
            }
          }} style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <b>Tiêu đề:</b>
              <input name="title" defaultValue={item.title || ""} style={{ padding: "8px", borderRadius: "4px", border: "1px solid #cbd5e1" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <b>Ghi chú:</b>
              <textarea name="note" defaultValue={item.note || ""} rows={3} style={{ padding: "8px", borderRadius: "4px", border: "1px solid #cbd5e1" }} />
            </label>
            <div>
              <button type="submit" className="button primary" disabled={draftMutationCount > 0}>{updateItem.isPending ? "Đang lưu..." : "Lưu thay đổi"}</button>
            </div>
          </form>
        ) : (
          <h3 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0.5rem 0", color: "#1e293b" }}>
            {item.title || (item.item_type === "chart" ? "Biểu đồ Phân tích" : "Kết luận từ Agent")}
          </h3>
        )}
      </header>

      {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && (
        <div className="report-chart-box" style={{ margin: "1.5rem 0", background: "#ffffff", padding: "1rem", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
          <ChartEvidenceView chartSpec={item.content_json.chart_spec} result={item.content_json.result} querySpec={item.query_spec} title={item.title || undefined} />
        </div>
      )}

      {item.content_json?.insight && (
        <div className="report-insight-box" style={{ background: "rgba(99, 102, 241, 0.04)", borderLeft: "4px solid #6366f1", padding: "1.25rem 1.5rem", borderRadius: "0 8px 8px 0", marginTop: "1.25rem" }}>
          <span className="eyebrow" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#4f46e5", display: "block", marginBottom: "0.5rem" }}>💡 INSIGHT ĐÃ DUYỆT</span>
          <MarkdownContent text={item.content_json.insight} className="report report-markdown" />
        </div>
      )}

      {!isEditing && item.note && (
        <div className="report-note-box" style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "#fefce8", border: "1px solid #fef08a", borderRadius: "6px", fontStyle: "italic", color: "#854d0e", fontSize: "0.85rem" }}>
          <b>Ghi chú người dùng:</b> {item.note}
        </div>
      )}
    </article>
  );
}

function EditableChartsSection({ runId, onSnapshotCreated }: { runId: string, onSnapshotCreated: () => void }) {
  const client = useQueryClient();
  const queryKey = reportDraftQueryKey(runId);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [reorderConflict, setReorderConflict] = useState<string | null>(null);
  const draftMutationCount = useIsMutating({ mutationKey: ["report-draft-write", runId] });
  const draftQuery = useQuery({
    queryKey,
    queryFn: () => getProfileReportDraft(runId)
  });
  const titleUpdate = useMutation({
    mutationKey: ["report-draft-write", runId],
    mutationFn: ({ reportId, title }: { reportId: string; title: string }) => updateReportDraftTitle(reportId, title),
    onMutate: async ({ title }) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<ReportDraft>(queryKey);
      client.setQueryData<ReportDraft>(queryKey, (old) => old ? { ...old, title } : old);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) client.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      finishReportDraftWrite(runId);
      return client.invalidateQueries({ queryKey });
    },
  });
  const snapshot = useMutation({
    mutationKey: ["report-draft-write", runId],
    mutationFn: () => snapshotReportDraft(draftQuery.data!.id),
    onSuccess: () => onSnapshotCreated(),
    onSettled: () => {
      finishReportDraftWrite(runId);
      return client.invalidateQueries({ queryKey });
    },
  });

  if (draftQuery.isPending) return <LoadingBlock label="Đang tải Report Draft..." />;
  if (draftQuery.isError) return <ErrorNotice error={draftQuery.error} />;
  
  const draft = draftQuery.data;
  if (!draft) {
    return <div className="panel" style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>Chưa có biểu đồ nào được ghim vào báo cáo này.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", marginTop: "1rem", padding: "1.5rem", background: "#f8fafc", borderRadius: "12px", border: "1px dashed #cbd5e1" }}>
      <div style={{ paddingBottom: "1rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0, color: "#0f172a" }}>Chế độ chỉnh sửa báo cáo</h3>
          <p className="muted" style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>Thay đổi vị trí, sửa tiêu đề, thêm ghi chú. Nhớ lưu lại thành snapshot mới khi hoàn tất.</p>
          {isEditingTitle ? <form onSubmit={(event) => {
            event.preventDefault();
            const title = String(new FormData(event.currentTarget).get("report-title") || "").trim();
            if (title.length >= 3 && draftMutationCount === 0 && startReportDraftWrite(runId)) {
              titleUpdate.mutate({ reportId: draft.id, title }, { onSuccess: () => setIsEditingTitle(false) });
            }
          }} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <input name="report-title" defaultValue={draft.title} aria-label="Tiêu đề báo cáo" disabled={draftMutationCount > 0} />
            <button className="button primary" type="submit" disabled={draftMutationCount > 0}>Lưu tiêu đề</button>
            <button className="button secondary" type="button" disabled={draftMutationCount > 0} onClick={() => setIsEditingTitle(false)}>Hủy</button>
          </form> : <div style={{ marginTop: "0.75rem" }}><b>{draft.title}</b><button className="button secondary" type="button" disabled={draftMutationCount > 0} onClick={() => setIsEditingTitle(true)} style={{ marginLeft: "0.75rem", padding: "4px 8px" }}>Sửa tiêu đề</button></div>}
        </div>
        <button className="button primary" onClick={() => { if (startReportDraftWrite(runId)) snapshot.mutate(); }} disabled={snapshot.isPending || draftMutationCount > 0}>
          {snapshot.isPending ? "Đang lưu..." : "📸 Hoàn tất & Cập nhật"}
        </button>
      </div>
      {reorderConflict && <div className="notice warning" role="alert"><p>{reorderConflict}</p></div>}
      {titleUpdate.isError && <ErrorNotice error={titleUpdate.error} retry={() => titleUpdate.reset()} />}
      {snapshot.isError && <ErrorNotice error={snapshot.error} retry={() => snapshot.reset()} />}
      {draft.items.length === 0 && <div className="panel" style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>Chưa có biểu đồ nào được ghim vào báo cáo này.</div>}
      {draft.items.map((item: any, index: number) => (
        <InlineDraftItem key={item.id} item={item} index={index} totalItems={draft.items.length} runId={runId} draftId={draft.id} onExit={() => setReorderConflict("Thứ tự báo cáo đã thay đổi ở phiên khác. Đã tải lại thứ tự chính thức từ backend.")} />
      ))}
    </div>
  );
}

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  const reportQuery = useQuery({
    queryKey: ["report-export-source", params.reportId],
    queryFn: () => getReportExportSource(params.reportId),
  });
  const reportDraftRunId = (reportQuery.data as any)?.profile?.run?.id as string | undefined;
  const reportDraftQuery = useQuery({
    queryKey: reportDraftRunId ? reportDraftQueryKey(reportDraftRunId) : ["report-draft-unavailable", params.reportId],
    queryFn: () => getProfileReportDraft(reportDraftRunId!),
    enabled: Boolean(reportDraftRunId && (reportQuery.data as any)?.report_snapshot?.items?.length),
  });

  async function exportFullPdf(profileRunId: string) {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await downloadPublishedReportPdf(profileRunId, params.reportId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `data-profiling-report-${params.reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("PDF đã được tạo và tải xuống.");
    } catch (error) {
      console.error(error);
      setExportError(error instanceof Error ? error : new Error("Lỗi khi xuất PDF"));
    } finally {
      setExporting(false);
    }
  }

  if (reportQuery.isPending) {
    return <main className="page"><div className="panel" style={{ padding: "2rem", textAlign: "center" }}><p className="muted">⏳ Đang tải báo cáo hoàn chỉnh...</p></div></main>;
  }

  if (reportQuery.isError || !reportQuery.data) {
    return <main className="page"><div className="panel" style={{ padding: "2rem" }}><ErrorNotice error={reportQuery.error} /><div style={{ marginTop: "1rem" }}><Link className="button secondary" href="/reports">← Quay lại</Link></div></div></main>;
  }

  const { profile, report_snapshot } = reportQuery.data as any;
  const items = report_snapshot?.items ?? [];
  const run = profile.run;
  const datasetName = profile.dataset?.name || "Tập dữ liệu chưa đặt tên";
  const driftReports = Array.isArray(profile.drift_reports) ? profile.drift_reports : [];
  const columns = profile.column_stats || [];

  let tocNumber = 1;
  const tocItems: Array<{ id: string; title: string; isPart?: boolean; isSection?: boolean; isSubSection?: boolean }> = [];

  const addToc = (id: string, title: string, isPart = false, isSection = false, isSubSection = false) => {
    if (isSection) {
      tocItems.push({ id, title: `${tocNumber}. ${title}`, isSection });
      tocNumber++;
    } else {
      tocItems.push({ id, title, isPart, isSubSection });
    }
  };

  addToc("part-1", "PHẦN 1: HỒ SƠ & CHẤT LƯỢNG", true);
  addToc("sec-overview", "Tổng quan Dataset", false, true);
  if (run.risk_warnings?.length > 0) addToc("sec-quality", "Rủi ro và giới hạn", false, true);
  let narrativeReportText = run.narrative_report ? (run.narrative_report as string).replace(/^---\s*$/gm, '') : "";

  if (run.narrative_report) {
    addToc("sec-narrative", "Tóm tắt từ Agent", false, true);
    const parentNum = tocNumber - 1;
    let lastTopLevel = 0;
    let lastSubLevel = 0;
    
    narrativeReportText = narrativeReportText.split(/\r?\n/).map((line: string) => {
      const rawLine = line.replace(/^\s*[-*+]\s+/, "").replace(/^[#\s]+/, "").replace(/\*\*/g, "");
      const match = rawLine.match(/^(\d+)[.)]\s+/);
      if (match) {
        const num = parseInt(match[1], 10);
        let prefix = "";
        let isLevel3 = false;

        if (num === lastTopLevel + 1) {
          lastTopLevel = num;
          lastSubLevel = 0;
          prefix = `${parentNum}.${num}`;
          isLevel3 = true;
        } else if (num === lastSubLevel + 1 || num === 1) {
          lastSubLevel = num;
          prefix = `${parentNum}.${lastTopLevel}.${num}`;
          isLevel3 = false;
        } else {
          prefix = `${parentNum}.${num}`;
          isLevel3 = true;
        }

        const titleText = rawLine.trim();
        const formattedTitle = titleText.replace(/^(\d+)[.)]\s+/, `${prefix}. `);
        const cleanId = formattedTitle.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
        
        if (cleanId && isLevel3) addToc(`heading-${cleanId}`, formattedTitle, false, false, true);
        return line.replace(/^(\s*(?:[-*+]\s+)?(?:#+\s+)?(?:\*\*)?)(\d+)[.)](\s+)/, `$1${prefix}.$3`);
      }
      return line;
    }).join('\n');
  }
  if (columns.length > 0) addToc("sec-columns", "Hồ sơ kỹ thuật", false, true);

  const formattedItems = JSON.parse(JSON.stringify(items));
  if (formattedItems.length > 0) {
    addToc("part-2", "PHẦN 2: CHUYÊN ĐỀ PHÂN TÍCH", true);
    addToc("sec-charts", "Biểu đồ đã ghim", false, true);
    const parentNum = tocNumber - 1;
    
    formattedItems.forEach((item: any) => {
      if (item.item_type === "agent_answer" && item.content_json?.answer) {
        let lastTopLevel = 0;
        let lastSubLevel = 0;
        
        item.content_json.answer = item.content_json.answer.split(/\r?\n/).map((line: string) => {
          const rawLine = line.replace(/^\s*[-*+]\s+/, "").replace(/^[#\s]+/, "").replace(/\*\*/g, "");
          const match = rawLine.match(/^(\d+)[.)]\s+/);
          if (match) {
            const num = parseInt(match[1], 10);
            let prefix = "";
            let isLevel3 = false;

            if (num === lastTopLevel + 1) {
              lastTopLevel = num;
              lastSubLevel = 0;
              prefix = `${parentNum}.${num}`;
              isLevel3 = true;
            } else if (num === lastSubLevel + 1 || num === 1) {
              lastSubLevel = num;
              prefix = `${parentNum}.${lastTopLevel}.${num}`;
              isLevel3 = false;
            } else {
              prefix = `${parentNum}.${num}`;
              isLevel3 = true;
            }

            const titleText = rawLine.trim();
            const formattedTitle = titleText.replace(/^(\d+)[.)]\s+/, `${prefix}. `);
            const cleanId = formattedTitle.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
            
            if (cleanId && isLevel3) addToc(`heading-${cleanId}`, formattedTitle, false, false, true);
            return line.replace(/^(\s*(?:[-*+]\s+)?(?:#+\s+)?(?:\*\*)?)(\d+)[.)](\s+)/, `$1${prefix}.$3`);
          }
          return line;
        }).join('\n');
      }
    });
  }

  if (driftReports.length > 0) {
    addToc("part-3", DRIFT_PART_TITLE, true);
    addToc("sec-drift", "Data Drift", false, true);
  }

  return (
    <>
      <main className="page report-detail-page" style={{ maxWidth: "1000px", margin: "0 auto", paddingBottom: "5rem" }}>
        <div className="report-detail-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Link className="button secondary" href="/reports">← Danh sách báo cáo</Link>
            <span className="chip success">Bản tổng hợp hoàn chỉnh</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {run.id && (
              <LoadingButton type="button" className="button primary" busy={exporting} onClick={() => void exportFullPdf(run.id)} style={{ background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)", boxShadow: "0 4px 12px rgba(37,99,235,0.25)", fontWeight: 700 }}>
                {exporting ? "Đang tạo PDF…" : "Xuất báo cáo PDF"}
              </LoadingButton>
            )}
          </div>
        </div>

        {exportError !== null && <ErrorNotice error={exportError} />}

        <div className="panel report-hero-banner" style={{ background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", color: "#ffffff", padding: "2.5rem", borderRadius: "16px", marginBottom: "2rem" }}>
          <span style={{ fontSize: "0.85rem", letterSpacing: "0.05em", color: "#93c5fd", textTransform: "uppercase", fontWeight: 700 }}>HỒ SƠ DỮ LIỆU & BÁO CÁO PHÂN TÍCH TOÀN DIỆN</span>
          <h1 style={{ fontSize: "2rem", margin: "0.5rem 0 1rem 0", color: "#ffffff", fontWeight: 800 }}>{report_snapshot?.title || `Báo cáo phân tích: ${datasetName}`}</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", fontSize: "0.9rem", color: "#cbd5e1", borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "1rem" }}>
            <div>📊 <b>Tập dữ liệu:</b> {datasetName}</div>
            <div>🔢 <b>Quy mô:</b> {run.row_count ? run.row_count.toLocaleString("vi-VN") : "0"} dòng</div>
            <div>⚡ <b>Scan:</b> {run.scan_mode === "full" ? "Full Scan" : "Sample Scan"}</div>
            <div>🕒 <b>Ngày tạo:</b> {run.created_at ? new Date(run.created_at).toLocaleDateString("vi-VN") : "—"}</div>
          </div>
        </div>

        {/* PHẦN 1: TỪ PROFILE */}
        <ReportAccordion
          id="part-1"
          eyebrow="PHẦN 1 · PROFILE"
          title="Phần 1: Hồ sơ kỹ thuật & Chất lượng dữ liệu"
          description="Mở để xem tổng quan, cảnh báo chất lượng, tóm tắt từ Agent và hồ sơ kỹ thuật."
          className="report-part-accordion report-part-1-accordion"
        >
        <section id="sec-overview" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>{tocItems.find(t => t.id === 'sec-overview')?.title}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", margin: "1rem 0" }}>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Tổng số dòng</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b", marginTop: "0.25rem" }}>{run.row_count ? run.row_count.toLocaleString("vi-VN") : "—"}</div>
            </div>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Số lượng cột</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b", marginTop: "0.25rem" }}>{columns.length} cột</div>
            </div>
            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>Trạng thái hồ sơ</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#059669", marginTop: "0.25rem" }}>{run.status === "completed" ? "Hoàn tất" : run.status || "Sẵn sàng"}</div>
            </div>
          </div>
        </section>

        {run.risk_warnings && run.risk_warnings.length > 0 && (
          <section id="sec-quality" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>{tocItems.find(t => t.id === 'sec-quality')?.title}</h2>
            <div style={{ background: "rgba(59, 130, 246, 0.04)", borderLeft: "4px solid #3b82f6", padding: "1.25rem", borderRadius: "0 8px 8px 0" }}>
              <MarkdownContent text={run.risk_warnings.map((w: string) => `- ⚠️ ${w.replace(/'([^']+)'/g, '\`$1\`')}`).join('\n')} className="report report-markdown" />
            </div>
          </section>
        )}

        {run.narrative_report && (
          <section id="sec-narrative" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>{tocItems.find(t => t.id === 'sec-narrative')?.title}</h2>
            <div style={{ background: "rgba(59, 130, 246, 0.04)", borderLeft: "4px solid #3b82f6", padding: "1.25rem", borderRadius: "0 8px 8px 0" }}>
              <MarkdownContent text={narrativeReportText} className="report report-markdown" />
            </div>
          </section>
        )}

        {columns.length > 0 && (
          <section id="sec-columns" className="panel report-detail-section" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>{tocItems.find(t => t.id === 'sec-columns')?.title}</h2>
            
            <div className="table-wrap" style={{ marginBottom: "2rem" }}>
              <table>
                <thead>
                  <tr><th>Cột</th><th>Kiểu</th><th>Null</th><th>Cardinality</th><th>Uniqueness</th><th>Giá trị phổ biến</th></tr>
                </thead>
                <tbody>
                  {columns.map((stat: any) => (
                    <tr key={stat.column_name}>
                      <td><b>{stat.column_name}</b>{stat.pii_masked && <><br /><span className="chip pii">Đã ẩn PII</span></>}</td>
                      <td>{stat.inferred_type || stat.dtype || "—"}</td>
                      <td>{stat.null_percentage !== undefined ? (stat.null_percentage * 100).toFixed(1) + "%" : stat.null_pct !== undefined ? (stat.null_pct * 100).toFixed(1) + "%" : "0%"}</td>
                      <td>{stat.distinct_count || stat.cardinality ? (stat.distinct_count || stat.cardinality).toLocaleString("vi-VN") : "—"}</td>
                      <td>{stat.uniqueness_ratio !== undefined ? (stat.uniqueness_ratio * 100).toFixed(1) + "%" : "—"}</td>
                      <td><TopValues stat={stat} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid two" style={{ marginTop: 18 }}>
              <MetricChart title="Tỷ lệ null theo cột" columns={columns} metric="null_pct" warning />
              <MetricChart title="Tỷ lệ unique theo cột" columns={columns} metric="uniqueness_ratio" ratio />
            </div>

            <div className="grid two" style={{ marginTop: 18 }}>
              <section className="panel" style={{ border: "1px solid #e2e8f0", boxShadow: "none" }}>
                <div className="panel-title"><h2>Phân phối</h2><small>Top-k non-PII</small></div>
                {columns.filter((stat: any) => !stat.pii_masked).slice(0, 3).map((stat: any) => (
                  <div className="distribution-column" key={stat.column_name}>
                    <h3 style={{ fontSize: "1rem", marginTop: "1rem" }}>{stat.column_name}</h3>
                    <Distribution stat={stat} totalRows={run.row_count} />
                  </div>
                ))}
              </section>
              {profile.correlation_matrix && (
                <section className="panel" style={{ border: "1px solid #e2e8f0", boxShadow: "none" }}>
                  <div className="panel-title"><h2>Tương quan</h2><small>Pearson r</small></div>
                  <CorrelationPanel matrix={profile.correlation_matrix} />
                </section>
              )}
            </div>
          </section>
        )}

        </ReportAccordion>



        {/* PHẦN 2: TỪ CHARTS */}
        {formattedItems.length > 0 && (
          <ReportAccordion
            id="part-2"
            eyebrow="PHẦN 2 · CHARTS"
            title="Phần 2: Biểu đồ trực quan & Phân tích chuyên sâu"
            description={`${formattedItems.length} mục phân tích đã ghim vào báo cáo.`}
            className="report-part-accordion report-part-2-accordion"
          >
            <section id="sec-charts" style={{ marginTop: "1rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <span className="eyebrow" style={{ color: "#2563eb", fontWeight: 700, textTransform: "uppercase", fontSize: "0.8rem" }}>CHUYÊN ĐỀ PHÂN TÍCH CHUYÊN SÂU</span>
                <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", margin: "0.25rem 0" }}>{tocItems.find(t => t.id === 'sec-charts')?.title} ({formattedItems.length} mục đã ghim)</h2>
              </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                {formattedItems.map((item: any, index: number) => (
                  <article key={item.id} className="panel report-detail-section" style={{ padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05)" }}>
                    <header style={{ marginBottom: "1.25rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "1rem" }}>
                      <div className="report-item-header-row">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", minWidth: 0 }}>
                          <span className="eyebrow" style={{ textTransform: "uppercase", fontSize: "0.75rem", color: "#2563eb", fontWeight: 700 }}>
                            {item.item_type === "chart" ? `CÂU HỎI #${index + 1}` : `GHI CHÚ #${index + 1}`}
                          </span>
                          {item.query_spec && (
                            <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: "4px" }}>
                              {item.query_spec.aggregate} · {item.query_spec.analysis_kind}
                            </span>
                          )}
                        </div>
                        <ReportItemActions
                          item={item}
                          reportId={params.reportId}
                          runId={run.id}
                          draftItemId={resolveReportDraftItemId(item, index, reportDraftQuery.data, report_snapshot?.snapshot_hash === "draft")}
                        />
                      </div>
                      <h3 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0.5rem 0", color: "#1e293b" }}>{item.title || (item.item_type === "chart" ? "Biểu đồ Phân tích" : "Kết luận từ Agent")}</h3>
                    </header>
                    {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && (
                      <div className="report-chart-box" style={{ margin: "1.5rem 0", background: "#ffffff", padding: "1rem", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                        <ChartEvidenceView chartSpec={item.content_json.chart_spec} result={item.content_json.result} querySpec={item.query_spec} title={item.title || undefined} />
                      </div>
                    )}
                    {item.content_json?.insight && (
                      <div className="report-insight-box" style={{ background: "rgba(99, 102, 241, 0.04)", borderLeft: "4px solid #6366f1", padding: "1.25rem 1.5rem", borderRadius: "0 8px 8px 0", marginTop: "1.25rem" }}>
                        <span className="eyebrow" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#4f46e5", display: "block", marginBottom: "0.5rem" }}>💡 INSIGHT & KẾT LUẬN TỪ AI AGENT</span>
                        <MarkdownContent text={item.content_json.insight} className="report report-markdown" />
                      </div>
                    )}
                    {item.content_json?.answer && (
                      <div className="report-answer-box" style={{ marginTop: "1.5rem" }}>
                        <MarkdownContent text={item.content_json.answer} className="report report-markdown" />
                      </div>
                    )}
                    {item.note && (
                      <div className="report-note-box" style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "#fefce8", border: "1px solid #fef08a", borderRadius: "6px", fontStyle: "italic", color: "#854d0e", fontSize: "0.85rem" }}>
                        <b>Ghi chú người dùng:</b> {item.note}
                      </div>
                    )}
                  </article>
                ))}
              </div>
          </section>
          </ReportAccordion>
        )}

        {/* PHẦN 3: SO SÁNH DỮ LIỆU */}
        {driftReports.length > 0 && (
          <ReportAccordion
            id="part-3"
            eyebrow="PHẦN 3 · DATA DRIFT"
            title={DRIFT_PART_TITLE}
            description="Mở để xem các thay đổi đáng chú ý giữa những phiên dữ liệu."
            className="report-part-accordion report-part-3-accordion"
          >
            <section id="sec-drift" className="panel report-detail-section" style={{ padding: "2rem", marginTop: "1rem", marginBottom: "1.5rem" }}>
              <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>{tocItems.find(t => t.id === 'sec-drift')?.title}</h2>
              <DriftEvidenceDetails reports={driftReports} />
            </section>
          </ReportAccordion>
        )}
      </main>

      {tocItems.length > 0 && (
        <aside className="report-toc-sidebar">
          <div className="report-toc-container">
            <h3 className="report-toc-title" style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0f172a", marginBottom: "0.85rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "0.6rem" }}>📑 Mục Lục Báo Cáo</h3>
            <ul className="report-toc-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {tocItems.map((item) => (
                <li key={item.id} style={{ marginLeft: item.isSubSection ? "2rem" : item.isSection ? "1rem" : "0", marginTop: item.isPart ? "0.85rem" : "0" }}>
                  <a href={`#${item.id}`} onClick={(e) => { e.preventDefault(); scrollToReportSection(item.id); }} style={{ color: item.isPart ? "#0f172a" : item.isSubSection ? "#475569" : "#2563eb", textDecoration: "none", display: "block", padding: "4px 0", fontWeight: item.isPart ? 800 : (item.isSection ? 600 : 500), fontSize: item.isPart ? "1.05rem" : item.isSubSection ? "0.9rem" : "0.95rem" }}>
                    <span>{item.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </>
  );
}
