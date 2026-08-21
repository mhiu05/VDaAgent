"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfileReportDraft, reorderReportDraft, snapshotReportDraft, unpinReportDraftItem, updateReportDraftItem } from "@/lib/api";
import { EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { ChartEvidenceView } from "./chart-evidence-view";

export function ReportTab({ runId }: { runId: string }) {
  const router = useRouter();
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
  }, onSuccess: async (next) => {
    client.setQueryData(key, next);
    await client.invalidateQueries({ queryKey: ["published-reports"] });
  } });
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
  return <section className="command-report">
    <header className="report-workspace-hero" style={{
      background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
      border: "1px solid #e2e8f0",
      borderRadius: "14px",
      padding: "1.25rem 1.5rem",
      marginBottom: "1.5rem",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "1.5rem",
      flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 320px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <span className="eyebrow" style={{ color: "#4f46e5", fontWeight: 700, fontSize: "0.75rem", letterSpacing: "0.05em" }}>KHÔNG GIAN SOẠN THẢO BÁO CÁO</span>
          <span className="chip" style={{ fontSize: "0.72rem", padding: "2px 8px", background: data.snapshot_hash ? "#dcfce7" : "#e0e7ff", color: data.snapshot_hash ? "#15803d" : "#4338ca", fontWeight: 600 }}>
            {data.snapshot_hash ? "📸 Đã lưu snapshot" : "✨ Đang soạn thảo"}
          </span>
        </div>
        <h2 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#0f172a", margin: 0, lineHeight: 1.3 }}>{data.title}</h2>
        <p className="muted" style={{ fontSize: "0.85rem", color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.5 }}>
          Tổng hợp <b>{data.items.length}</b> bài phân tích và insight đã duyệt. Xem báo cáo trực tuyến hoặc xuất bản phiên bản mới vào thư viện.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        <button
          type="button"
          className="button secondary"
          onClick={() => snapshot.mutate()}
          disabled={snapshot.isPending || data.items.length === 0 || data.stale_reasons.length > 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            height: "40px",
            padding: "0 16px",
            fontSize: "0.85rem",
            fontWeight: 600,
            borderRadius: "8px",
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#334155",
            cursor: snapshot.isPending || data.items.length === 0 ? "not-allowed" : "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {snapshot.isPending ? "⏳ Đang tạo..." : "📸 Tạo snapshot / Xuất bản"}
        </button>

        <Link
          className="button primary"
          href={`/reports/${data.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            height: "40px",
            padding: "0 18px",
            fontSize: "0.85rem",
            fontWeight: 700,
            borderRadius: "8px",
            background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
            color: "#ffffff",
            boxShadow: "0 2px 4px rgba(37,99,235,0.2)",
            textDecoration: "none",
            transition: "all 0.15s ease",
          }}
        >
          <span>📖 Mở xem báo cáo</span>
          <span style={{ fontSize: "1rem" }}>→</span>
        </Link>
      </div>
    </header>
    {data.stale_reasons.length > 0 && <Notice tone="warning"><b>Draft đã lỗi thời.</b><p>{data.stale_reasons.join(", ")}. Hãy chạy lại và ghim lại evidence trước khi xuất.</p></Notice>}
    {snapshot.isError && <ErrorNotice error={snapshot.error} retry={() => snapshot.reset()} />}
    {data.snapshot_hash && <Notice tone="info">Snapshot hash: <code>{data.snapshot_hash}</code></Notice>}
    {data.items.length === 0 ? <EmptyState title="Chưa có mục nào trong báo cáo" detail="Ghim các biểu đồ kèm insight từ Workspace Biểu đồ để đưa vào báo cáo này." /> : <ol className="command-report-items">{data.items.map((item, index) => <li className={`panel command-report-item ${item.item_type === "chart" ? "with-chart" : ""}`} key={item.id}>
      <div className="command-report-copy"><small>{item.item_type}</small><h3>{item.title || (item.item_type === "chart" ? "Chart evidence" : "Giải thích từ Agent")}</h3>{item.query_spec && <p className="muted">{item.query_spec.aggregate} · hash {item.result_hash?.slice(0, 12)}</p>}{item.limitations?.length ? <p className="muted">{item.limitations.join(" ")}</p> : null}</div>
      {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && <div className="command-report-chart"><ChartEvidenceView chartSpec={item.content_json.chart_spec} result={item.content_json.result} querySpec={item.query_spec} title={item.title || undefined} /></div>}
      {item.content_json?.insight && <section className="chart-insight-panel command-report-insight"><span className="eyebrow">INSIGHT ĐÃ DUYỆT</span><MarkdownContent text={item.content_json.insight} className="report report-markdown" /></section>}
      <details className="command-report-editor"><summary>Chỉnh tiêu đề / ghi chú</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); updateItem.mutate({ itemId: item.id, title: String(form.get("title") || ""), note: String(form.get("note") || "") }); }}><label>Tiêu đề<input name="title" defaultValue={item.title || ""} maxLength={255} /></label><label>Ghi chú<textarea name="note" defaultValue={item.note || ""} maxLength={20000} rows={4} /></label><button className="button secondary" type="submit" disabled={updateItem.isPending}>{updateItem.isPending ? "Đang lưu…" : "Lưu chỉnh sửa"}</button></form></details>
      <div className="inline-actions"><button className="button secondary" type="button" onClick={() => move(index, -1)} disabled={index === 0 || reorder.isPending} aria-label={`Chuyển mục ${index + 1} lên`}>Lên</button><button className="button secondary" type="button" onClick={() => move(index, 1)} disabled={index === data.items.length - 1 || reorder.isPending} aria-label={`Chuyển mục ${index + 1} xuống`}>Xuống</button><button className="button danger" type="button" onClick={() => unpin.mutate(item.id)} disabled={unpin.isPending}>Bỏ ghim</button></div>
    </li>)}</ol>}
  </section>;
}
