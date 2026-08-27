"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadPublishedReportPdf, getReportExportSource, getProfileReportDraft, updateReportDraftItem, unpinReportDraftItem, reorderReportDraft, snapshotReportDraft, pinAgentAnswerToReport } from "@/lib/api";
import { ErrorNotice, LoadingBlock, LoadingButton, EmptyState, useToast } from "@/components/ui";
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
  return <div style={{ marginTop: "2rem", fontFamily: "var(--font-sans)" }}>
    <div style={{ marginBottom: "1.5rem", display: "flex", gap: "2rem", borderBottom: "1px solid #000", paddingBottom: "1rem" }}>
      <div><strong>Mức độ nghiêm trọng:</strong> {major}</div>
      <div><strong>Cần theo dõi:</strong> {minor}</div>
      <div><strong>Số cột có biến động:</strong> {columns.length} ({findings.length} tín hiệu)</div>
    </div>
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem" }}>
        <thead>
          <tr>
            <th style={{ borderBottom: "2px solid #000", padding: "0.5rem", textAlign: "left" }}>Cột</th>
            <th style={{ borderBottom: "2px solid #000", padding: "0.5rem", textAlign: "left" }}>Mức độ</th>
            <th style={{ borderBottom: "2px solid #000", padding: "0.5rem", textAlign: "left" }}>Bằng chứng</th>
            <th style={{ borderBottom: "2px solid #000", padding: "0.5rem", textAlign: "left" }}>Số tín hiệu</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.name}>
              <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.5rem" }}><strong>{column.name}</strong></td>
              <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.5rem" }}>{driftSeverityLabels[column.severity]}</td>
              <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.5rem" }}>{driftEvidenceLabel(column.findings[0])}</td>
              <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.5rem" }}>{column.findings.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {columns.map((column) => (
        <div key={column.name} style={{ border: "1px solid #d1d5db", padding: "1.5rem" }}>
          <div style={{ borderBottom: "1px solid #000", paddingBottom: "0.5rem", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <h4 style={{ margin: 0, fontSize: "1.1rem" }}>Cột: {column.name}</h4>
            <span style={{ fontWeight: "bold" }}>{driftSeverityLabels[column.severity]}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {column.findings.map((finding: any, index: number) => (
              <div key={`${finding.drift_type}-${index}`}>
                <div><strong>{driftTypeLabels[finding.drift_type] || finding.drift_type}</strong> - {driftSeverityLabels[finding.severity]}</div>
                <p style={{ margin: "0.25rem 0", color: "#374151" }}>{finding.detail}</p>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 2rem", fontSize: "0.9rem" }}>
                  <strong>Evidence:</strong> <span>{driftEvidenceLabel(finding)}</span>
                  {(finding.baseline_value !== undefined || finding.current_value !== undefined) && (
                    <>
                      <strong>Baseline:</strong> <span>{driftDisplayValue(finding.baseline_value)}</span>
                      <strong>Current:</strong> <span>{driftDisplayValue(finding.current_value)}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>;
}

// --- Inline Editor Component ---
function InlineDraftItem({ item, index, totalItems, runId, draftId, onExit }: { item: any; index: number; totalItems: number; runId: string; draftId: string; onExit: () => void }) {
  const client = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const key = ["command-center", runId, "report-draft"];
  
  const updateItem = useMutation({
    mutationFn: ({ title, note, content_json }: { title: string; note: string; content_json?: any }) => 
      updateReportDraftItem(draftId, item.id, { title, note, ...(content_json ? { content_json } : {}) }),
    onSuccess: (next) => { client.setQueryData(key, next); setIsEditing(false); }
  });
  
  const unpin = useMutation({
    mutationFn: () => unpinReportDraftItem(draftId, item.id),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key });
      const previousDraft = client.getQueryData(key) as any;
      if (previousDraft?.items) {
        client.setQueryData(key, {
          ...previousDraft,
          items: previousDraft.items.filter((i: any) => i.id !== item.id),
        });
      }
      return { previousDraft };
    },
    onError: (err, vars, context) => {
      if (context?.previousDraft) {
        client.setQueryData(key, context.previousDraft);
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
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
    onMutate: async (direction: -1 | 1) => {
      await client.cancelQueries({ queryKey: key });
      const previousDraft = client.getQueryData(key) as any;
      if (previousDraft?.items) {
        const nextItems = [...previousDraft.items];
        const target = index + direction;
        if (target >= 0 && target < nextItems.length) {
          [nextItems[index], nextItems[target]] = [nextItems[target], nextItems[index]];
          client.setQueryData(key, { ...previousDraft, items: nextItems });
        }
      }
      return { previousDraft };
    },
    onError: (err, vars, context) => {
      if (context?.previousDraft) {
        client.setQueryData(key, context.previousDraft);
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });

  return (
    <article style={{ border: isEditing ? "1.5px solid #64748b" : "1px solid #e2e8f0", padding: "2rem", position: "relative", backgroundColor: isEditing ? "#f8fafc" : "#fff", borderRadius: "6px", transition: "all 0.2s ease" }}>
      <div style={{ position: "absolute", top: "-14px", right: "1.5rem", display: "flex", alignItems: "center", gap: "0.25rem", zIndex: 10, background: "#ffffff", padding: "0.25rem 0.5rem", border: "1px solid #e2e8f0", borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
        {!isEditing ? (
          <>
            <button type="button" onClick={() => move.mutate(-1)} disabled={index === 0 || move.isPending} title="Lên trên" style={{ border: "none", background: "transparent", cursor: index === 0 ? "not-allowed" : "pointer", padding: "0.2rem 0.4rem", fontSize: "0.9rem", opacity: index === 0 ? 0.3 : 1 }}>⬆️</button>
            <button type="button" onClick={() => move.mutate(1)} disabled={index === totalItems - 1 || move.isPending} title="Xuống dưới" style={{ border: "none", background: "transparent", cursor: index === totalItems - 1 ? "not-allowed" : "pointer", padding: "0.2rem 0.4rem", fontSize: "0.9rem", opacity: index === totalItems - 1 ? 0.3 : 1 }}>⬇️</button>
            <div style={{ width: "1px", height: "14px", background: "#e2e8f0", margin: "0 0.25rem" }} />
            <button type="button" onClick={() => setIsEditing(true)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0.2rem 0.5rem", fontWeight: 600, fontSize: "0.85rem", color: "#0f172a" }}>✏️ Sửa nội dung</button>
            <button type="button" onClick={() => unpin.mutate()} disabled={unpin.isPending} style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0.2rem 0.5rem", fontWeight: 600, color: "#dc2626", fontSize: "0.85rem" }}>🗑️ Bỏ ghim</button>
          </>
        ) : (
          <button type="button" onClick={() => setIsEditing(false)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0.2rem 0.5rem", fontWeight: 600, fontSize: "0.85rem", color: "#64748b" }}>Đóng</button>
        )}
      </div>

      <header style={{ marginBottom: "1.5rem", borderBottom: isEditing ? "none" : "1.5px solid #0f172a", paddingBottom: isEditing ? "0" : "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingRight: "150px" }}>
          <span style={{ textTransform: "uppercase", fontSize: "0.8rem", fontWeight: "bold", color: isEditing ? "#0f172a" : "#64748b", letterSpacing: "0.05em" }}>
            {item.item_type === "chart" ? `Mục Phân tích #${index + 1}` : `Ghi chú #${index + 1}`}
          </span>
          {item.query_spec && (
            <span style={{ fontSize: "0.8rem", color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: "4px" }}>
              {item.query_spec.aggregate} · {item.query_spec.analysis_kind}
            </span>
          )}
        </div>
        
        {isEditing ? (
          <form onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const title = String(form.get("title") || "");
            const note = String(form.get("note") || "");
            const content = String(form.get("content") || "");
            
            const nextContentJson = { ...(item.content_json || {}) };
            if (item.item_type === "chart") {
              nextContentJson.insight = content;
            } else {
              nextContentJson.answer = content;
            }
            updateItem.mutate({ title, note, content_json: nextContentJson });
          }} style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>Tiêu đề mục:</label>
              <input 
                name="title" 
                defaultValue={item.title || ""} 
                placeholder="Nhập tiêu đề phân tích..."
                style={{ padding: "0.5rem 0", border: "none", borderBottom: "1.5px dashed #94a3b8", outline: "none", width: "100%", fontSize: "1.4rem", fontWeight: "bold", fontFamily: "'Times New Roman', Times, serif", background: "transparent", color: "#0f172a" }} 
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>Nội dung phân tích / Kết luận (Hỗ trợ Markdown):</label>
              <textarea 
                name="content" 
                defaultValue={item.content_json?.insight || item.content_json?.answer || ""} 
                rows={6} 
                placeholder="Nhập hoặc chỉnh sửa nội dung phân tích..."
                style={{ padding: "1rem", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", width: "100%", fontFamily: "var(--font-sans)", fontSize: "0.95rem", lineHeight: 1.6, resize: "vertical", backgroundColor: "#fff", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.03)" }} 
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>Ghi chú riêng của Analyst (tùy chọn):</label>
              <textarea 
                name="note" 
                defaultValue={item.note || ""} 
                rows={3} 
                placeholder="Nhập ghi chú thêm..."
                style={{ padding: "0.75rem 1rem", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", width: "100%", fontFamily: "var(--font-sans)", fontSize: "0.9rem", lineHeight: 1.5, resize: "vertical", backgroundColor: "#fff" }} 
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setIsEditing(false)} style={{ padding: "0.5rem 1rem", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer", fontWeight: 600, color: "#475569" }}>Hủy</button>
              <button type="submit" disabled={updateItem.isPending} style={{ padding: "0.5rem 1.25rem", border: "none", borderRadius: "6px", background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 600, boxShadow: "0 2px 6px rgba(37,99,235,0.25)" }}>
                {updateItem.isPending ? "Đang lưu..." : "Lưu Thay Đổi"}
              </button>
            </div>
          </form>
        ) : (
          <h3 style={{ fontSize: "1.3rem", fontWeight: "bold", margin: "0.5rem 0", fontFamily: "'Times New Roman', Times, serif", color: "#0f172a" }}>
            {item.title || (item.item_type === "chart" ? "Biểu đồ Phân tích" : "Kết luận từ Agent")}
          </h3>
        )}
      </header>

      {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && (
        <div style={{ margin: "2rem 0", padding: "1rem", border: "1px solid #e2e8f0", borderRadius: "6px", backgroundColor: "#fff" }}>
          <ChartEvidenceView chartSpec={item.content_json.chart_spec} result={item.content_json.result} querySpec={item.query_spec} title={item.title || undefined} />
        </div>
      )}

      {item.content_json?.insight && (
        <div style={{ padding: "1.25rem 1.5rem", borderLeft: "3px solid #0f172a", marginTop: "1.5rem", backgroundColor: isEditing ? "#fff" : "#f8fafc", borderRadius: "0 6px 6px 0" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: "bold", textTransform: "uppercase", display: "block", marginBottom: "0.5rem", color: "#475569", letterSpacing: "0.05em" }}>Kết luận phân tích</span>
          <MarkdownContent text={item.content_json.insight} className="report report-markdown" />
        </div>
      )}

      {item.content_json?.answer && (
        <div style={{ marginTop: "1.5rem", padding: "1.25rem 1.5rem", borderLeft: "3px solid #0f172a", backgroundColor: isEditing ? "#fff" : "#f8fafc", borderRadius: "0 6px 6px 0" }}>
          <MarkdownContent text={item.content_json.answer} className="report report-markdown" />
        </div>
      )}

      {!isEditing && item.note && (
        <div style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", border: "1px dashed #cbd5e1", borderRadius: "6px", fontStyle: "italic", fontSize: "0.9rem", backgroundColor: "#fff", color: "#334155" }}>
          <b>Ghi chú Analyst:</b> {item.note}
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
    return (
      <div style={{ padding: "3rem 2rem", textAlign: "center", border: "1.5px dashed #cbd5e1", borderRadius: "8px", backgroundColor: "#f8fafc" }}>
        <p style={{ margin: "0 0 1rem 0", color: "#64748b", fontStyle: "italic" }}>Chưa có biểu đồ hoặc nhận định nào được ghim vào phần phân tích chuyên sâu.</p>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8" }}>Bạn có thể dùng nút <strong>"➕ Thêm Nhận định"</strong> ở thanh công cụ phía trên để viết phân tích mới.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem", marginTop: "1rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {draft.items.map((item: any, index: number) => (
          <InlineDraftItem key={item.id} item={item} index={index} totalItems={draft.items.length} runId={runId} draftId={draft.id} onExit={() => {}} />
        ))}
      </div>
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
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingFinding, setIsAddingFinding] = useState(false);
  const [newFindingTitle, setNewFindingTitle] = useState("");
  const [newFindingContent, setNewFindingContent] = useState("");
  const [reportTitle, setReportTitle] = useState<string | null>(null);
  const [customOverviewNote, setCustomOverviewNote] = useState<string | null>(null);
  const [customRiskWarnings, setCustomRiskWarnings] = useState<string | null>(null);
  const [customNarrative, setCustomNarrative] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const reportQuery = useQuery({
    queryKey: ["report-export-source", params.reportId],
    queryFn: () => getReportExportSource(params.reportId),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  const addFindingMutation = useMutation({
    mutationFn: ({ title, content, runId }: { title: string; content: string; runId: string }) =>
      pinAgentAnswerToReport(params.reportId, runId, title, content),
    onSuccess: () => {
      toast.success("Đã thêm nhận định mới vào báo cáo!");
      setIsAddingFinding(false);
      setNewFindingTitle("");
      setNewFindingContent("");
      queryClient.invalidateQueries({ queryKey: ["report-export-source", params.reportId] });
      queryClient.invalidateQueries({ queryKey: ["command-center"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Không thể thêm nhận định.");
    }
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

  const currentTitle = reportTitle ?? (report_snapshot?.title || `Báo cáo phân tích: ${datasetName}`);
  const defaultRiskWarnings = (run.risk_warnings && run.risk_warnings.length > 0)
    ? run.risk_warnings.map((w: string) => `- ${w.replace(/'([^']+)'/g, '`$1`')}`).join('\n')
    : "";
  const currentRiskWarnings = customRiskWarnings ?? defaultRiskWarnings;

  const defaultNarrative = run.narrative_report ? (run.narrative_report as string).replace(/^---\s*$/gm, '') : "";
  const currentNarrative = customNarrative ?? defaultNarrative;

  async function handleSaveReport() {
    setSaving(true);
    try {
      if (report_snapshot?.id) {
        await snapshotReportDraft(report_snapshot.id);
      }
      toast.success("Đã lưu các thay đổi của báo cáo thành công!");
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["report-export-source", params.reportId] });
    } catch (err: any) {
      toast.error(err?.message || "Đã lưu bản nháp hiện tại.");
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

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
  if (currentRiskWarnings || isEditing) addToc("sec-quality", "Rủi ro và giới hạn", false, true);
  if (currentNarrative || isEditing) addToc("sec-narrative", "Tóm tắt từ Agent & Nhận định", false, true);
  if (columns.length > 0) addToc("sec-columns", "Hồ sơ kỹ thuật", false, true);

  const formattedItems = JSON.parse(JSON.stringify(items));
  if (formattedItems.length > 0 || isEditing) {
    addToc("part-2", "PHẦN 2: CHUYÊN ĐỀ PHÂN TÍCH", true);
    addToc("sec-charts", "Biểu đồ đã ghim", false, true);
  }

  if (driftReports.length > 0) {
    addToc("part-3", "PHẦN 3: SO SÁNH DỮ LIỆU", true);
    addToc("sec-drift", "Data Drift", false, true);
  }

  return (
    <>
      <div style={{ backgroundColor: "#f3f4f6", minHeight: "100vh", padding: "2rem 0" }}>
        
        {/* Sticky Editing Toolbar when in edit mode */}
        {isEditing && (
          <div style={{
            position: "sticky",
            top: "1.25rem",
            zIndex: 100,
            maxWidth: "1280px",
            margin: "0 auto 1.5rem auto",
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(16px)",
            color: "#0f172a",
            padding: "0.85rem 1.5rem",
            borderRadius: "10px",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0,0,0,0.05)",
            border: "1px solid #e2e8f0"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem" }}>
                ✍️
              </div>
              <div>
                <strong style={{ display: "block", fontSize: "0.95rem", color: "#0f172a" }}>Chế độ Chỉnh sửa Toàn diện Đang Bật</strong>
                <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Bạn có thể sửa Tiêu đề, Tóm tắt nhận định, Rủi ro, bổ sung phân tích hoặc sắp xếp biểu đồ.</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setIsAddingFinding(true)}
                style={{ padding: "0.5rem 1rem", background: "#ffffff", border: "1px solid #cbd5e1", color: "#334155", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, borderRadius: "6px", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
              >
                ➕ Thêm Nhận định
              </button>
              <button
                type="button"
                onClick={handleSaveReport}
                disabled={saving}
                style={{ padding: "0.5rem 1.25rem", background: "#2563eb", border: "none", color: "#ffffff", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, borderRadius: "6px", boxShadow: "0 2px 6px rgba(37,99,235,0.3)" }}
              >
                {saving ? "Đang lưu..." : "💾 Lưu Báo Cáo"}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                style={{ padding: "0.5rem 0.85rem", background: "transparent", border: "1px solid #e2e8f0", color: "#64748b", cursor: "pointer", fontSize: "0.85rem", borderRadius: "6px" }}
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        <main style={{ backgroundColor: "#ffffff", maxWidth: "1280px", margin: "0 auto", padding: "4rem 5.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.06)", fontFamily: "var(--font-sans)", color: "#111827", minHeight: "29.7cm", position: "relative", borderRadius: "8px" }}>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Link className="button secondary" style={{ border: "1px solid #d1d5db", background: "transparent", color: "#000" }} href="/reports">← Trở về</Link>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => setIsEditing(!isEditing)}
                style={{ border: isEditing ? "1.5px solid #0f172a" : "1px solid #d1d5db", background: isEditing ? "#f1f5f9" : "transparent", color: "#0f172a", fontWeight: 600 }}
              >
                {isEditing ? "✕ Thoát chế độ sửa" : "✏️ Chỉnh sửa báo cáo"}
              </button>
              {run.id && (
                <LoadingButton type="button" className="button primary" busy={exporting} onClick={() => void exportFullPdf(run.id)} disabled={isEditing} style={{ background: "#000", color: "#fff", border: "none" }}>
                  {exporting ? "Đang xuất..." : "Xuất bản PDF"}
                </LoadingButton>
              )}
            </div>
          </div>

          {exportError !== null && <ErrorNotice error={exportError} />}

          {/* Form thêm nhận định mới của Analyst */}
          {isAddingFinding && (
            <div style={{ marginBottom: "2.5rem", padding: "2rem", border: "1px solid #cbd5e1", backgroundColor: "#f8fafc", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
              <h3 style={{ margin: "0 0 1rem 0", color: "#0f172a", fontFamily: "'Times New Roman', Times, serif", fontSize: "1.4rem" }}>➕ Thêm Nhận định / Khuyến nghị Mới (Analyst Note)</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <input
                  type="text"
                  placeholder="Tiêu đề nhận định (VD: Đánh giá về tỷ lệ hoàn trả...)"
                  value={newFindingTitle}
                  onChange={(e) => setNewFindingTitle(e.target.value)}
                  style={{ padding: "0.75rem", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", fontSize: "1rem", fontWeight: "bold", backgroundColor: "#fff" }}
                />
                <textarea
                  placeholder="Nội dung phân tích, nhận định hoặc khuyến nghị hành động của bạn (hỗ trợ định dạng Markdown)..."
                  value={newFindingContent}
                  onChange={(e) => setNewFindingContent(e.target.value)}
                  rows={5}
                  style={{ padding: "0.75rem", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", fontSize: "0.95rem", lineHeight: 1.6, backgroundColor: "#fff" }}
                />
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setIsAddingFinding(false)}
                    style={{ padding: "0.5rem 1rem", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer", color: "#475569", fontWeight: 600 }}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    disabled={!newFindingTitle.trim() || !newFindingContent.trim() || addFindingMutation.isPending}
                    onClick={() => addFindingMutation.mutate({ title: newFindingTitle, content: newFindingContent, runId: run.id })}
                    style={{ padding: "0.5rem 1.25rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600, boxShadow: "0 2px 6px rgba(37,99,235,0.25)" }}
                  >
                    {addFindingMutation.isPending ? "Đang lưu..." : "Thêm vào báo cáo"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <header style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "2rem", marginBottom: "3rem" }}>
            <h4 style={{ textTransform: "uppercase", letterSpacing: "2px", fontWeight: "normal", fontSize: "0.9rem", marginBottom: "1rem", color: "#64748b" }}>Báo Cáo Phân Tích Dữ Liệu</h4>
            
            {isEditing ? (
              <div style={{ marginBottom: "1.5rem" }}>
                <input
                  type="text"
                  value={currentTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  placeholder="Nhập tiêu đề báo cáo..."
                  style={{
                    fontSize: "2.3rem",
                    fontFamily: "'Times New Roman', Times, serif",
                    fontWeight: "bold",
                    textAlign: "center",
                    width: "100%",
                    border: "none",
                    borderBottom: "1.5px dashed #94a3b8",
                    outline: "none",
                    backgroundColor: "rgba(0,0,0,0.02)",
                    padding: "0.5rem",
                    color: "#0f172a"
                  }}
                />
                <small style={{ display: "block", color: "#64748b", marginTop: "0.5rem", fontStyle: "italic" }}>✏️ Đang chỉnh sửa Tiêu đề báo cáo</small>
              </div>
            ) : (
              <h1 style={{ fontSize: "2.5rem", margin: "0 0 1.5rem 0", fontFamily: "'Times New Roman', Times, serif" }}>{currentTitle}</h1>
            )}
            
            <table style={{ margin: "0 auto", textAlign: "left", width: "80%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb", width: "30%" }}><strong>Tập dữ liệu:</strong></td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb" }}>{datasetName}</td>
                </tr>
                <tr>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb" }}><strong>Quy mô:</strong></td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb" }}>{run.row_count ? run.row_count.toLocaleString("vi-VN") : "0"} dòng</td>
                </tr>
                <tr>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb" }}><strong>Ngày tạo báo cáo:</strong></td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid #e5e7eb" }}>{run.created_at ? new Date(run.created_at).toLocaleDateString("vi-VN") : "—"}</td>
                </tr>
              </tbody>
            </table>
          </header>

          {/* PHẦN 1: TỪ PROFILE */}
          <div id="part-1" style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.8rem", fontFamily: "'Times New Roman', Times, serif", borderBottom: "1px solid #000", paddingBottom: "0.5rem", marginBottom: "2rem" }}>Phần 1: Khảo Sát Tổng Quan & Chất Lượng</h2>
          </div>

          {/* 1. TỔNG QUAN DATASET */}
          <section id="sec-overview" style={{ marginBottom: "3rem" }}>
            <h3 style={{ fontSize: "1.3rem", fontFamily: "'Times New Roman', Times, serif", marginBottom: "1.5rem" }}>{tocItems.find(t => t.id === 'sec-overview')?.title || "1. Tổng quan Dataset"}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", border: "1px solid #d1d5db" }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: "2px solid #000", padding: "1rem", backgroundColor: "#f9fafb" }}>Tổng số dòng</th>
                  <th style={{ borderBottom: "2px solid #000", padding: "1rem", backgroundColor: "#f9fafb" }}>Số lượng cột</th>
                  <th style={{ borderBottom: "2px solid #000", padding: "1rem", backgroundColor: "#f9fafb" }}>Trạng thái hồ sơ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "1rem", fontSize: "1.2rem", borderRight: "1px solid #d1d5db" }}>{run.row_count ? run.row_count.toLocaleString("vi-VN") : "—"}</td>
                  <td style={{ padding: "1rem", fontSize: "1.2rem", borderRight: "1px solid #d1d5db" }}>{columns.length}</td>
                  <td style={{ padding: "1rem", fontSize: "1.2rem" }}>{run.status === "completed" ? "Hoàn tất" : run.status || "Sẵn sàng"}</td>
                </tr>
              </tbody>
            </table>

            {/* Nhận xét tổng quan của Analyst */}
            {isEditing ? (
              <div style={{ marginTop: "1rem", border: "1px solid #cbd5e1", backgroundColor: "#f8fafc", padding: "1rem 1.25rem", borderRadius: "6px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#0f172a", marginBottom: "0.35rem" }}>✏️ Ghi chú / Đánh giá tổng quan của Analyst (tùy chọn):</label>
                <textarea
                  value={customOverviewNote ?? ""}
                  onChange={(e) => setCustomOverviewNote(e.target.value)}
                  placeholder="Nhập ghi chú hoặc đánh giá sơ bộ về quy mô và độ toàn vẹn của tập dữ liệu..."
                  rows={3}
                  style={{ width: "100%", padding: "0.75rem", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", fontSize: "0.95rem", lineHeight: 1.5, backgroundColor: "#fff" }}
                />
              </div>
            ) : (
              customOverviewNote && (
                <div style={{ marginTop: "1rem", padding: "1rem 1.25rem", borderLeft: "3px solid #0f172a", backgroundColor: "#f8fafc", borderRadius: "0 6px 6px 0" }}>
                  <MarkdownContent text={customOverviewNote} className="report report-markdown" />
                </div>
              )
            )}
          </section>

          {/* 2. RỦI RO VÀ GIỚI HẠN (CHO PHÉP CHỈNH SỬA TRỰC TIẾP) */}
          {(currentRiskWarnings || isEditing) && (
            <section id="sec-quality" style={{ marginBottom: "3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.3rem", fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
                  {tocItems.find(t => t.id === 'sec-quality')?.title || "2. Rủi ro và giới hạn"}
                </h3>
                {isEditing && (
                  <span style={{ fontSize: "0.85rem", color: "#64748b", fontWeight: 600 }}>✏️ Đang sửa danh sách rủi ro</span>
                )}
              </div>

              {isEditing ? (
                <div style={{ border: "1px solid #cbd5e1", backgroundColor: "#f8fafc", padding: "1.5rem", borderRadius: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <label style={{ fontWeight: 600, color: "#0f172a", fontSize: "0.9rem" }}>Chỉnh sửa danh sách Cảnh báo Rủi ro & Giới hạn (Markdown):</label>
                    <button
                      type="button"
                      onClick={() => setCustomRiskWarnings(defaultRiskWarnings)}
                      style={{ fontSize: "0.8rem", background: "transparent", border: "none", color: "#64748b", cursor: "pointer", textDecoration: "underline" }}
                    >
                      Khôi phục cảnh báo gốc
                    </button>
                  </div>
                  <textarea
                    value={currentRiskWarnings}
                    onChange={(e) => setCustomRiskWarnings(e.target.value)}
                    rows={6}
                    placeholder="Nhập hoặc chỉnh sửa các rủi ro, ngoại lệ, hoặc giới hạn chất lượng dữ liệu (mỗi dòng một gạch đầu dòng)..."
                    style={{ width: "100%", padding: "1rem", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", fontSize: "0.95rem", lineHeight: 1.6, backgroundColor: "#fff" }}
                  />
                </div>
              ) : (
                currentRiskWarnings && (
                  <div style={{ padding: "1.5rem", border: "1px solid #d1d5db", backgroundColor: "#f9fafb" }}>
                    <MarkdownContent text={currentRiskWarnings} className="report report-markdown" />
                  </div>
                )
              )}
            </section>
          )}

          {/* 3. TÓM TẮT & NHẬN ĐỊNH CỦA ANALYST (CHO PHÉP CHỈNH SỬA TRỰC TIẾP) */}
          {(currentNarrative || isEditing) && (
            <section id="sec-narrative" style={{ marginBottom: "3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.3rem", fontFamily: "'Times New Roman', Times, serif", margin: 0 }}>
                  {tocItems.find(t => t.id === 'sec-narrative')?.title || "Tóm tắt từ Agent & Nhận định"}
                </h3>
                {isEditing && (
                  <span style={{ fontSize: "0.85rem", color: "#64748b", fontWeight: 600 }}>✏️ Đang sửa tóm tắt điều hành</span>
                )}
              </div>

              {isEditing ? (
                <div style={{ border: "1px solid #cbd5e1", backgroundColor: "#f8fafc", padding: "1.5rem", borderRadius: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <label style={{ fontWeight: 600, color: "#0f172a", fontSize: "0.95rem" }}>Soạn thảo Tóm tắt điều hành & Nhận định của Analyst (Hỗ trợ Markdown):</label>
                    <button
                      type="button"
                      onClick={() => setCustomNarrative(defaultNarrative)}
                      style={{ fontSize: "0.8rem", background: "transparent", border: "none", color: "#64748b", cursor: "pointer", textDecoration: "underline" }}
                    >
                      Khôi phục tóm tắt AI gốc
                    </button>
                  </div>
                  <textarea
                    value={currentNarrative}
                    onChange={(e) => setCustomNarrative(e.target.value)}
                    rows={10}
                    placeholder="Viết nhận định tóm tắt, phát hiện chính hoặc khuyến nghị tổng quan của bạn dành cho báo cáo này..."
                    style={{
                      width: "100%",
                      padding: "1rem",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      outline: "none",
                      fontFamily: "var(--font-sans)",
                      fontSize: "0.95rem",
                      lineHeight: 1.6,
                      backgroundColor: "#ffffff",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.03)"
                    }}
                  />
                </div>
              ) : (
                currentNarrative && (
                  <div style={{ padding: "1.5rem", borderLeft: "4px solid #000", backgroundColor: "#fcfcfc" }}>
                    <MarkdownContent text={currentNarrative} className="report report-markdown" />
                  </div>
                )
              )}
            </section>
          )}

          {columns.length > 0 && (
            <section id="sec-columns" style={{ marginBottom: "3rem" }}>
              <h3 style={{ fontSize: "1.3rem", fontFamily: "'Times New Roman', Times, serif", marginBottom: "1.5rem" }}>{tocItems.find(t => t.id === 'sec-columns')?.title}</h3>
              <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr>
                      <th style={{ borderBottom: "2px solid #000", padding: "0.75rem" }}>Cột</th>
                      <th style={{ borderBottom: "2px solid #000", padding: "0.75rem" }}>Kiểu</th>
                      <th style={{ borderBottom: "2px solid #000", padding: "0.75rem" }}>Null</th>
                      <th style={{ borderBottom: "2px solid #000", padding: "0.75rem" }}>Distinct</th>
                      <th style={{ borderBottom: "2px solid #000", padding: "0.75rem" }}>Uniqueness</th>
                      <th style={{ borderBottom: "2px solid #000", padding: "0.75rem" }}>Giá trị nổi bật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((stat: any) => (
                      <tr key={stat.column_name}>
                        <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.75rem" }}><strong>{stat.column_name}</strong>{stat.pii_masked && <span style={{ marginLeft: "0.5rem", fontSize: "0.8em", border: "1px solid #000", padding: "2px 4px" }}>PII</span>}</td>
                        <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.75rem" }}>{stat.inferred_type || stat.dtype || "—"}</td>
                        <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.75rem" }}>{stat.null_percentage !== undefined ? (stat.null_percentage * 100).toFixed(1) + "%" : stat.null_pct !== undefined ? (stat.null_pct * 100).toFixed(1) + "%" : "0%"}</td>
                        <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.75rem" }}>{stat.distinct_count || stat.cardinality ? (stat.distinct_count || stat.cardinality).toLocaleString("vi-VN") : "—"}</td>
                        <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.75rem" }}>{stat.uniqueness_ratio !== undefined ? (stat.uniqueness_ratio * 100).toFixed(1) + "%" : "—"}</td>
                        <td style={{ borderBottom: "1px solid #e5e7eb", padding: "0.75rem" }}><TopValues stat={stat} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginTop: "2rem" }}>
                <div style={{ border: "1px solid #d1d5db", padding: "1.5rem" }}>
                  <h4 style={{ margin: "0 0 1.5rem 0", borderBottom: "1px solid #000", paddingBottom: "0.5rem" }}>Phân phối (Top non-PII)</h4>
                  {columns.filter((stat: any) => !stat.pii_masked).slice(0, 3).map((stat: any) => (
                    <div key={stat.column_name} style={{ marginBottom: "1.5rem" }}>
                      <h5 style={{ fontSize: "1rem", margin: "0 0 0.5rem 0" }}>{stat.column_name}</h5>
                      <Distribution stat={stat} totalRows={run.row_count} />
                    </div>
                  ))}
                </div>
                {profile.correlation_matrix && (
                  <div style={{ border: "1px solid #d1d5db", padding: "1.5rem" }}>
                    <h4 style={{ margin: "0 0 1.5rem 0", borderBottom: "1px solid #000", paddingBottom: "0.5rem" }}>Tương quan (Pearson r)</h4>
                    <CorrelationPanel matrix={profile.correlation_matrix} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* PHẦN 2: TỪ CHARTS & INSIGHTS */}
          {(formattedItems.length > 0 || isEditing) && (
            <>
              <div id="part-2" style={{ marginBottom: "2rem", marginTop: "4rem" }}>
                <h2 style={{ fontSize: "1.8rem", fontFamily: "'Times New Roman', Times, serif", borderBottom: "1px solid #000", paddingBottom: "0.5rem", marginBottom: "2rem" }}>Phần 2: Phân Tích Chuyên Sâu</h2>
              </div>
              <section id="sec-charts" style={{ marginBottom: "3rem" }}>
              
              {isEditing ? (
                <EditableChartsSection runId={run.id} onSnapshotCreated={() => { setIsEditing(false); queryClient.invalidateQueries({ queryKey: ["report-export-source", params.reportId] }); }} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "3rem" }}>
                  {formattedItems.map((item: any, index: number) => (
                    <article key={item.id} style={{ border: "1px solid #d1d5db", padding: "2rem" }}>
                      <header style={{ marginBottom: "1.5rem", borderBottom: "2px solid #000", paddingBottom: "1rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ textTransform: "uppercase", fontSize: "0.8rem", fontWeight: "bold" }}>
                            {item.item_type === "chart" ? `Phân tích #${index + 1}` : `Ghi chú #${index + 1}`}
                          </span>
                          {item.query_spec && (
                            <span style={{ fontSize: "0.8rem", color: "#4b5563" }}>
                              {item.query_spec.aggregate} · {item.query_spec.analysis_kind}
                            </span>
                          )}
                        </div>
                        <h3 style={{ fontSize: "1.3rem", fontWeight: "bold", margin: "0.5rem 0", fontFamily: "'Times New Roman', Times, serif" }}>{item.title || (item.item_type === "chart" ? "Biểu đồ Phân tích" : "Kết luận từ Agent")}</h3>
                      </header>
                      {item.item_type === "chart" && item.content_json?.result && item.content_json.chart_spec && item.query_spec && (
                        <div style={{ margin: "2rem 0", padding: "1rem", border: "1px solid #e5e7eb" }}>
                          <ChartEvidenceView chartSpec={item.content_json.chart_spec} result={item.content_json.result} querySpec={item.query_spec} title={item.title || undefined} />
                        </div>
                      )}
                      {item.content_json?.insight && (
                        <div style={{ padding: "1.5rem", borderLeft: "4px solid #000", marginTop: "2rem", backgroundColor: "#f9fafb" }}>
                          <span style={{ fontSize: "0.85rem", fontWeight: "bold", textTransform: "uppercase", display: "block", marginBottom: "1rem" }}>Kết luận phân tích</span>
                          <MarkdownContent text={item.content_json.insight} className="report report-markdown" />
                        </div>
                      )}
                      {item.content_json?.answer && (
                        <div style={{ marginTop: "1.5rem" }}>
                          <MarkdownContent text={item.content_json.answer} className="report report-markdown" />
                        </div>
                      )}
                      {item.note && (
                        <div style={{ marginTop: "1.5rem", padding: "1rem", border: "1px dashed #000", fontStyle: "italic", fontSize: "0.9rem" }}>
                          <b>Ghi chú:</b> {item.note}
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
              <div id="part-3" style={{ marginBottom: "2rem", marginTop: "4rem" }}>
                <h2 style={{ fontSize: "1.8rem", fontFamily: "'Times New Roman', Times, serif", borderBottom: "1px solid #000", paddingBottom: "0.5rem", marginBottom: "2rem" }}>Phần 3: So Sánh Biến Động Dữ Liệu</h2>
              </div>
              <section id="sec-drift" style={{ marginBottom: "3rem" }}>
              <h3 style={{ fontSize: "1.3rem", fontFamily: "'Times New Roman', Times, serif", marginBottom: "1.5rem" }}>{tocItems.find(t => t.id === 'sec-drift')?.title}</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", border: "1px solid #d1d5db" }}>
                  <thead>
                    <tr>
                      <th style={{ borderBottom: "2px solid #000", padding: "1rem", backgroundColor: "#f9fafb" }}>Profile A</th>
                      <th style={{ borderBottom: "2px solid #000", padding: "1rem", backgroundColor: "#f9fafb" }}>Profile B</th>
                      <th style={{ borderBottom: "2px solid #000", padding: "1rem", backgroundColor: "#f9fafb" }}>Tóm tắt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driftReports.map((drift: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ padding: "1rem", borderBottom: "1px solid #e5e7eb", borderRight: "1px solid #e5e7eb" }}>{drift.profile_run_id_a}</td>
                        <td style={{ padding: "1rem", borderBottom: "1px solid #e5e7eb", borderRight: "1px solid #e5e7eb" }}>{drift.profile_run_id_b}</td>
                        <td style={{ padding: "1rem", borderBottom: "1px solid #e5e7eb" }}>{drift.summary}</td>
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
      </div>

      {tocItems.length > 0 && (
        <aside className="report-toc-sidebar" style={{ backgroundColor: "#f9fafb", borderLeft: "1px solid #e5e7eb" }}>
          <div className="report-toc-container" style={{ padding: "2rem 1.5rem" }}>
            <h3 className="report-toc-title" style={{ fontSize: "1rem", fontWeight: "bold", textTransform: "uppercase", marginBottom: "1rem", borderBottom: "2px solid #000", paddingBottom: "0.5rem" }}>Mục Lục</h3>
            <ul className="report-toc-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem" }}>
              {tocItems.map((item) => (
                <li key={item.id} style={{ marginLeft: item.isSubSection ? "1.5rem" : item.isSection ? "0.5rem" : "0", marginTop: item.isPart ? "1rem" : "0" }}>
                  <a href={`#${item.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" }); }} style={{ color: item.isPart ? "#000" : "#374151", textDecoration: "none", display: "block", fontWeight: item.isPart ? "bold" : "normal" }}>
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
