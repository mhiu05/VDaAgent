"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { downloadCombinedReport, getProfileReportDraft, reorderReportDraft, snapshotReportDraft, unpinReportDraftItem, updateReportDraftItem } from "@/lib/api";
import { useState } from "react";
import { EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { ChartEvidenceView } from "./chart-evidence-view";

export function ReportTab({ runId }: { runId: string }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const client = useQueryClient();
  const key = ["command-center", runId, "report-draft"];
  const draft = useQuery({ queryKey: key, queryFn: () => getProfileReportDraft(runId) });
  const reorder = useMutation({ mutationFn: (itemIds: string[]) => {
    if (!draft.data) throw new Error("Report draft is not ready.");
    return reorderReportDraft(draft.data.id, itemIds, draft.data.draft_version);
  }, onSuccess: (next) => client.setQueryData(key, next) });
  const snapshot = useMutation({ mutationFn: () => {
    if (!draft.data) throw new Error("Report draft is not ready.");
    return snapshotReportDraft(draft.data.id);
  }, onSuccess: (next) => client.setQueryData(key, next) });
  const unpin = useMutation({ mutationFn: (itemId: string) => {
    if (!draft.data) throw new Error("Report draft is not ready.");
    return unpinReportDraftItem(draft.data.id, itemId);
  }, onSuccess: (next) => client.setQueryData(key, next) });
  const updateItem = useMutation({ mutationFn: ({ itemId, title, note }: { itemId: string; title?: string; note?: string }) => {
    if (!draft.data) throw new Error("Report draft is not ready.");
    return updateReportDraftItem(draft.data.id, itemId, { title, note });
  }, onSuccess: (next) => client.setQueryData(key, next) });
  if (draft.isLoading) return <LoadingBlock label="Đang tải Report Draft…" />;
  if (draft.isError) return <ErrorNotice error={draft.error} retry={() => draft.refetch()} />;
  if (!draft.data) return <EmptyState title="Chưa có Report Draft" detail="Ghim một kết quả Official từ Explorer để bắt đầu." />;
  const data = draft.data;
  function move(index: number, direction: -1 | 1) {
    const next = data.items.map((item) => item.id);
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next);
  }
  async function exportPdf() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await downloadCombinedReport(runId, undefined, data.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vdaagent-${runId}-snapshot.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Không thể xuất PDF.");
    } finally { setExporting(false); }
  }
  return <section className="command-report">
    <header className="panel-title"><div><h2>{data.title}</h2><p className="muted">PDF luôn dùng snapshot gần nhất đã đóng băng. Nếu bạn thay đổi thứ tự hoặc nội dung đã ghim, hãy tạo snapshot mới trước khi xuất.</p></div><div className="inline-actions"><button className="button primary" type="button" onClick={() => snapshot.mutate()} disabled={snapshot.isPending || data.items.length === 0 || data.stale_reasons.length > 0}>{snapshot.isPending ? "Đang đóng băng…" : "Tạo snapshot"}</button>{data.snapshot_hash && <button className="button secondary" type="button" onClick={() => void exportPdf()} disabled={exporting}>{exporting ? "Đang xuất…" : "Xuất PDF"}</button>}</div></header>
    {data.stale_reasons.length > 0 && <Notice tone="warning"><b>Draft đã lỗi thời.</b><p>{data.stale_reasons.join(", ")}. Hãy chạy lại và ghim lại evidence trước khi xuất.</p></Notice>}
    {exportError && <Notice tone="warning">{exportError}</Notice>}
    {snapshot.isError && <ErrorNotice error={snapshot.error} retry={() => snapshot.reset()} />}
    {data.snapshot_hash && <Notice tone="info">Snapshot hash: <code>{data.snapshot_hash}</code></Notice>}
    {data.items.length === 0 ? <EmptyState title="Chưa có mục nào trong báo cáo" detail="Kết quả Preview không thể ghim. Hãy xác nhận kết quả trong Explorer, sau đó dùng Pin vào báo cáo." /> : <ol className="command-report-items">{data.items.map((item, index) => <li className={`panel command-report-item ${item.item_type === "chart" ? "with-chart" : ""}`} key={item.id}>
      <div className="command-report-copy"><small>{item.item_type}</small><h3>{item.title || (item.item_type === "chart" ? "Chart evidence" : "Giải thích từ Agent")}</h3>{item.query_spec && <p className="muted">{item.query_spec.aggregate} · hash {item.result_hash?.slice(0, 12)}</p>}{item.limitations?.length ? <p className="muted">{item.limitations.join(" ")}</p> : null}</div>
      {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && <div className="command-report-chart"><ChartEvidenceView chartSpec={item.content_json.chart_spec} result={item.content_json.result} querySpec={item.query_spec} title={item.title || undefined} /></div>}
      {item.item_type === "chart" && item.content_json?.insight && <section className="chart-insight-panel command-report-insight"><span className="eyebrow">INSIGHT ĐÃ DUYỆT</span><MarkdownContent text={item.content_json.insight} className="report report-markdown" /></section>}
      <details className="command-report-editor"><summary>Chỉnh tiêu đề / ghi chú</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); updateItem.mutate({ itemId: item.id, title: String(form.get("title") || ""), note: String(form.get("note") || "") }); }}><label>Tiêu đề<input name="title" defaultValue={item.title || ""} maxLength={255} /></label><label>Ghi chú<textarea name="note" defaultValue={item.note || ""} maxLength={20000} rows={4} /></label><button className="button secondary" type="submit" disabled={updateItem.isPending}>{updateItem.isPending ? "Đang lưu…" : "Lưu chỉnh sửa"}</button></form></details>
      <div className="inline-actions"><button className="button secondary" type="button" onClick={() => move(index, -1)} disabled={index === 0 || reorder.isPending} aria-label={`Chuyển mục ${index + 1} lên`}>Lên</button><button className="button secondary" type="button" onClick={() => move(index, 1)} disabled={index === data.items.length - 1 || reorder.isPending} aria-label={`Chuyển mục ${index + 1} xuống`}>Xuống</button><button className="button danger" type="button" onClick={() => unpin.mutate(item.id)} disabled={unpin.isPending}>Bỏ ghim</button></div>
    </li>)}</ol>}
  </section>;
}
