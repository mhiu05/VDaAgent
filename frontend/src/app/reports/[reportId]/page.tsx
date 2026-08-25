"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadPublishedReportPdf, getReportExportSource, getProfileReportDraft, updateReportDraftItem, unpinReportDraftItem, reorderReportDraft, snapshotReportDraft } from "@/lib/api";
import { ErrorNotice, LoadingBlock, EmptyState } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { ChartEvidenceView } from "@/components/command-center/chart-evidence-view";
import { TopValues, Distribution, MetricChart, CorrelationPanel } from "@/components/report-components";

const driftTypeLabels: Record<string, string> = {
  column_added: "Cột mới",
  column_removed: "Cột bị thiếu",
  dtype_changed: "Thay đổi kiểu dữ liệu",
  null_rate_shift: "Thay đổi tỷ lệ thiếu",
  numeric_shift: "Thay đổi chỉ số số",
  distribution_shift: "Thay đổi phân phối",
};
const driftSeverityLabels: Record<string, string> = { major: "Nghiêm trọng", minor: "Cần theo dõi" };

function driftDisplayValue(value: unknown): string {
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(value);
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function driftEvidenceLabel(finding: any): string {
  if (typeof finding?.psi === "number") return `PSI ${driftDisplayValue(finding.psi)}`;
  if (finding?.metric === "null_pct") return "Tỷ lệ thiếu";
  return finding?.metric || driftTypeLabels[finding?.drift_type] || finding?.drift_type || "—";
}

function groupedDriftFindings(reports: any[]) {
  const groups = new Map<string, any[]>();
  reports.flatMap((report) => Array.isArray(report?.drift_columns) ? report.drift_columns : []).forEach((finding) => {
    const name = finding?.column_name || "Dataset";
    groups.set(name, [...(groups.get(name) || []), finding]);
  });
  return [...groups.entries()].map(([name, findings]) => ({
    name,
    findings,
    severity: findings.some((finding) => finding.severity === "major") ? "major" : "minor",
  }));
}

function DriftEvidenceDetails({ reports }: { reports: any[] }) {
  const columns = groupedDriftFindings(reports);
  const findings = columns.flatMap((column) => column.findings);
  const major = findings.filter((finding) => finding.severity === "major").length;
  const minor = findings.filter((finding) => finding.severity === "minor").length;
  return <div className="report-drift-details" style={{ marginTop: "1.5rem" }}>
    <div className="compare-summary-grid" style={{ marginBottom: "1rem" }}>
      <article><span>Nghiêm trọng</span><b>{major}</b><small>Signal major</small></article>
      <article><span>Cần theo dõi</span><b>{minor}</b><small>Signal minor</small></article>
      <article><span>Cột có evidence</span><b>{columns.length}</b><small>{findings.length} signal</small></article>
    </div>
    <div style={{ overflowX: "auto" }}><table className="compare-table" style={{ width: "100%" }}><thead><tr><th>Cột</th><th>Severity</th><th>Evidence</th><th>Signal</th></tr></thead><tbody>
      {columns.map((column) => <tr key={column.name}><td><b>{column.name}</b></td><td><span className={`compare-severity compare-severity-${column.severity}`}>{driftSeverityLabels[column.severity]}</span></td><td>{driftEvidenceLabel(column.findings[0])}</td><td>{column.findings.length} signal</td></tr>)}
    </tbody></table></div>
    <div style={{ display: "grid", gap: "1rem", marginTop: "1.25rem" }}>{columns.map((column) => <article key={column.name} className="panel compare-detail-panel" style={{ padding: "1.25rem", boxShadow: "none" }}>
      <div className="compare-detail-heading"><div><p className="eyebrow">EVIDENCE CỘT</p><h3 style={{ margin: 0 }}>{column.name}</h3><p>{column.findings.length} signal từ backend</p></div><span className={`compare-severity compare-severity-${column.severity}`}>{driftSeverityLabels[column.severity]}</span></div>
      <div className="compare-evidence-list">{column.findings.map((finding: any, index: number) => <article key={`${finding.drift_type}-${index}`} className="compare-evidence-item"><div><b>{driftTypeLabels[finding.drift_type] || finding.drift_type}</b><span className={`compare-severity compare-severity-${finding.severity}`}>{driftSeverityLabels[finding.severity]}</span></div><p>{finding.detail}</p><dl><div><dt>Evidence</dt><dd>{driftEvidenceLabel(finding)}</dd></div>{(finding.baseline_value !== undefined || finding.current_value !== undefined) && <><div><dt>Baseline</dt><dd>{driftDisplayValue(finding.baseline_value)}</dd></div><div><dt>Current</dt><dd>{driftDisplayValue(finding.current_value)}</dd></div></>}</dl></article>)}</div>
    </article>)}</div>
  </div>;
}

// --- Inline Editor Component ---
function InlineDraftItem({ item, index, totalItems, runId, draftId, onExit }: { item: any; index: number; totalItems: number; runId: string; draftId: string; onExit: () => void }) {
  const client = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const key = ["command-center", runId, "report-draft"];
  
  const updateItem = useMutation({
    mutationFn: ({ title, note }: { title: string; note: string }) => updateReportDraftItem(draftId, item.id, { title, note }),
    onSuccess: (next) => { client.setQueryData(key, next); setIsEditing(false); }
  });
  
  const unpin = useMutation({
    mutationFn: () => unpinReportDraftItem(draftId, item.id),
    onSuccess: (next) => client.setQueryData(key, next)
  });
  
  const move = useMutation({
    mutationFn: (direction: -1 | 1) => {
      const draft = client.getQueryData(key) as any;
      if (!draft) return Promise.reject();
      const next = draft.items.map((i: any) => i.id);
      const target = index + direction;
      if (target < 0 || target >= next.length) return Promise.reject();
      [next[index], next[target]] = [next[target], next[index]];
      return reorderReportDraft(draftId, next, draft.draft_version);
    },
    onSuccess: (next) => client.setQueryData(key, next)
  });

  return (
    <article className="panel report-detail-section" style={{ padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05)", position: "relative" }}>
      <div style={{ position: "absolute", top: "1rem", right: "1rem", display: "flex", gap: "0.5rem", zIndex: 10 }}>
        {!isEditing ? (
          <>
            <button type="button" className="button secondary" onClick={() => move.mutate(-1)} disabled={index === 0 || move.isPending} title="Lên" style={{ padding: "4px 8px" }}>↑</button>
            <button type="button" className="button secondary" onClick={() => move.mutate(1)} disabled={index === totalItems - 1 || move.isPending} title="Xuống" style={{ padding: "4px 8px" }}>↓</button>
            <button type="button" className="button secondary" onClick={() => setIsEditing(true)} style={{ padding: "4px 12px" }}>✏️ Edit</button>
            <button type="button" className="button danger" onClick={() => unpin.mutate()} disabled={unpin.isPending} style={{ padding: "4px 12px" }}>Bỏ ghim</button>
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
            updateItem.mutate({ title: String(form.get("title") || ""), note: String(form.get("note") || "") });
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
              <button type="submit" className="button primary" disabled={updateItem.isPending}>{updateItem.isPending ? "Đang lưu..." : "Lưu thay đổi"}</button>
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
  const draftQuery = useQuery({
    queryKey: ["command-center", runId, "report-draft"],
    queryFn: () => getProfileReportDraft(runId)
  });
  const snapshot = useMutation({
    mutationFn: () => snapshotReportDraft(draftQuery.data!.id),
    onSuccess: () => onSnapshotCreated()
  });

  if (draftQuery.isPending) return <LoadingBlock label="Đang tải Report Draft..." />;
  if (draftQuery.isError) return <ErrorNotice error={draftQuery.error} />;
  
  const draft = draftQuery.data;
  if (!draft || draft.items.length === 0) {
    return <div className="panel" style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>Chưa có biểu đồ nào được ghim vào báo cáo này.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", marginTop: "1rem", padding: "1.5rem", background: "#f8fafc", borderRadius: "12px", border: "1px dashed #cbd5e1" }}>
      <div style={{ paddingBottom: "1rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0, color: "#0f172a" }}>Chế độ chỉnh sửa báo cáo</h3>
          <p className="muted" style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>Thay đổi vị trí, sửa tiêu đề, thêm ghi chú. Nhớ lưu lại thành snapshot mới khi hoàn tất.</p>
        </div>
        <button className="button primary" onClick={() => snapshot.mutate()} disabled={snapshot.isPending}>
          {snapshot.isPending ? "Đang lưu..." : "📸 Hoàn tất & Cập nhật"}
        </button>
      </div>
      {draft.items.map((item: any, index: number) => (
        <InlineDraftItem key={item.id} item={item} index={index} totalItems={draft.items.length} runId={runId} draftId={draft.id} onExit={() => {}} />
      ))}
    </div>
  );
}

function ReportSkeletonLoader() {
  return (
    <main className="page" style={{ animation: "fadeIn 0.2s ease" }}>
      <header className="report-full-header" style={{ marginBottom: "1.5rem" }}>
        <div style={{ flex: 1 }}>
          <div style={{ width: "160px", height: "14px", background: "#e2e8f0", borderRadius: "4px", marginBottom: "8px", animation: "pulse 1.5s infinite ease-in-out" }} />
          <div style={{ width: "380px", height: "28px", background: "#cbd5e1", borderRadius: "6px", marginBottom: "8px", animation: "pulse 1.5s infinite ease-in-out" }} />
          <div style={{ width: "260px", height: "16px", background: "#e2e8f0", borderRadius: "4px", animation: "pulse 1.5s infinite ease-in-out" }} />
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <div style={{ width: "130px", height: "36px", background: "#cbd5e1", borderRadius: "6px", animation: "pulse 1.5s infinite ease-in-out" }} />
          <div style={{ width: "120px", height: "36px", background: "#e2e8f0", borderRadius: "6px", animation: "pulse 1.5s infinite ease-in-out" }} />
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="panel" style={{ padding: "1.25rem", borderRadius: "10px", background: "#ffffff" }}>
            <div style={{ width: "80px", height: "12px", background: "#e2e8f0", borderRadius: "4px", marginBottom: "10px", animation: "pulse 1.5s infinite ease-in-out" }} />
            <div style={{ width: "120px", height: "24px", background: "#cbd5e1", borderRadius: "4px", animation: "pulse 1.5s infinite ease-in-out" }} />
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1.5rem" }}>
        <div className="panel" style={{ padding: "2rem", borderRadius: "12px", background: "#ffffff" }}>
          <div style={{ width: "220px", height: "20px", background: "#cbd5e1", borderRadius: "4px", marginBottom: "1.5rem", animation: "pulse 1.5s infinite ease-in-out" }} />
          <div style={{ width: "100%", height: "16px", background: "#f1f5f9", borderRadius: "4px", marginBottom: "10px", animation: "pulse 1.5s infinite ease-in-out" }} />
          <div style={{ width: "90%", height: "16px", background: "#f1f5f9", borderRadius: "4px", marginBottom: "10px", animation: "pulse 1.5s infinite ease-in-out" }} />
          <div style={{ width: "75%", height: "16px", background: "#f1f5f9", borderRadius: "4px", marginBottom: "20px", animation: "pulse 1.5s infinite ease-in-out" }} />
          <div style={{ width: "100%", height: "260px", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #e2e8f0", animation: "pulse 1.5s infinite ease-in-out" }} />
        </div>
      </div>
    </main>
  );
}

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();

  const reportQuery = useQuery({
    queryKey: ["report-export-source", params.reportId],
    queryFn: () => getReportExportSource(params.reportId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
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
    } catch (error) {
      console.error(error);
      setExportError(error instanceof Error ? error : new Error("Lỗi khi xuất PDF"));
    } finally {
      setExporting(false);
    }
  }

  if (reportQuery.isPending) {
    return <ReportSkeletonLoader />;
  }

  if (reportQuery.isError || !reportQuery.data) {
    return <main className="page"><div className="panel" style={{ padding: "2rem" }}><ErrorNotice error={reportQuery.error} /><div style={{ marginTop: "1rem" }}><Link className="button secondary" href="/reports">← Quay lại</Link></div></div></main>;
  }

  const { profile, report_snapshot } = reportQuery.data as any;
  const items = report_snapshot?.items ?? [];
  const run = profile.run;
  const datasetName = profile.dataset?.name || "Tập dữ liệu chưa đặt tên";
  const driftReports = profile.drift_reports || [];
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
  if (formattedItems.length > 0 || isEditing) {
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
    addToc("part-3", "PHẦN 3: SO SÁNH DỮ LIỆU", true);
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
            <button type="button" className={`button ${isEditing ? 'primary' : 'secondary'}`} onClick={() => setIsEditing(!isEditing)} style={{ fontWeight: 600 }}>
              {isEditing ? "Hủy chỉnh sửa" : "✏️ Chỉnh sửa biểu đồ đã ghim"}
            </button>
            {run.id && (
              <button type="button" className="button primary" onClick={() => void exportFullPdf(run.id)} disabled={exporting || isEditing} style={{ background: isEditing ? "#94a3b8" : "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)", boxShadow: isEditing ? "none" : "0 4px 12px rgba(37,99,235,0.25)", fontWeight: 700 }}>
                {exporting ? "Đang tạo PDF…" : "Xuất báo cáo PDF"}
              </button>
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
        <div id="part-1" style={{ marginTop: "3rem", marginBottom: "1.5rem", borderBottom: "3px solid #2563eb", paddingBottom: "0.5rem" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 900, color: "#1e293b", textTransform: "uppercase", margin: 0 }}>Phần 1: Hồ sơ kỹ thuật & Chất lượng dữ liệu</h2>
        </div>
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



        {/* PHẦN 2: TỪ CHARTS */}
        {(formattedItems.length > 0 || isEditing) && (
          <>
            <div id="part-2" style={{ marginTop: "4rem", marginBottom: "1.5rem", borderBottom: "3px solid #8b5cf6", paddingBottom: "0.5rem" }}>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 900, color: "#1e293b", textTransform: "uppercase", margin: 0 }}>Phần 2: Biểu đồ trực quan & Phân tích chuyên sâu</h2>
            </div>
            <section id="sec-charts" style={{ marginTop: "1rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <span className="eyebrow" style={{ color: "#2563eb", fontWeight: 700, textTransform: "uppercase", fontSize: "0.8rem" }}>CHUYÊN ĐỀ PHÂN TÍCH CHUYÊN SÂU</span>
                <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", margin: "0.25rem 0" }}>{tocItems.find(t => t.id === 'sec-charts')?.title} ({formattedItems.length} mục đã ghim)</h2>
              </div>
            
            {isEditing ? (
              <EditableChartsSection runId={run.id} onSnapshotCreated={() => { setIsEditing(false); queryClient.invalidateQueries({ queryKey: ["report-export-source", params.reportId] }); }} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                {formattedItems.map((item: any, index: number) => (
                  <article key={item.id} className="panel report-detail-section" style={{ padding: "2rem", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05)" }}>
                    <header style={{ marginBottom: "1.25rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="eyebrow" style={{ textTransform: "uppercase", fontSize: "0.75rem", color: "#2563eb", fontWeight: 700 }}>
                          {item.item_type === "chart" ? `CÂU HỎI #${index + 1}` : `GHI CHÚ #${index + 1}`}
                        </span>
                        {item.query_spec && (
                          <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: "4px" }}>
                            {item.query_spec.aggregate} · {item.query_spec.analysis_kind}
                          </span>
                        )}
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
            )}
          </section>
          </>
        )}

        {/* PHẦN 3: SO SÁNH DỮ LIỆU */}
        {driftReports.length > 0 && (
          <>
            <div id="part-3" style={{ marginTop: "4rem", marginBottom: "1.5rem", borderBottom: "3px solid #10b981", paddingBottom: "0.5rem" }}>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 900, color: "#1e293b", textTransform: "uppercase", margin: 0 }}>Phần 3: So sánh biến động dữ liệu (Data Drift)</h2>
            </div>
            <section id="sec-drift" className="panel report-detail-section" style={{ padding: "2rem", marginTop: "1rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.35rem", marginBottom: "1rem", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>{tocItems.find(t => t.id === 'sec-drift')?.title}</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                    <th style={{ padding: "0.75rem" }}>Profile A</th>
                    <th style={{ padding: "0.75rem" }}>Profile B</th>
                    <th style={{ padding: "0.75rem" }}>Tóm tắt</th>
                  </tr>
                </thead>
                <tbody>
                  {driftReports.map((drift: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "0.75rem", color: "#475569" }}>{drift.profile_run_id_a}</td>
                      <td style={{ padding: "0.75rem", color: "#475569" }}>{drift.profile_run_id_b}</td>
                      <td style={{ padding: "0.75rem", color: "#1e293b" }}>{drift.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DriftEvidenceDetails reports={driftReports} />
          </section>
          </>
        )}
      </main>

      {tocItems.length > 0 && (
        <aside className="report-toc-sidebar">
          <div className="report-toc-container">
            <h3 className="report-toc-title" style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0f172a", marginBottom: "0.85rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "0.6rem" }}>📑 Mục Lục Báo Cáo</h3>
            <ul className="report-toc-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {tocItems.map((item) => (
                <li key={item.id} style={{ marginLeft: item.isSubSection ? "2rem" : item.isSection ? "1rem" : "0", marginTop: item.isPart ? "0.85rem" : "0" }}>
                  <a href={`#${item.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" }); }} style={{ color: item.isPart ? "#0f172a" : item.isSubSection ? "#475569" : "#2563eb", textDecoration: "none", display: "block", padding: "4px 0", fontWeight: item.isPart ? 800 : (item.isSection ? 600 : 500), fontSize: item.isPart ? "1.05rem" : item.isSubSection ? "0.9rem" : "0.95rem" }}>
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
