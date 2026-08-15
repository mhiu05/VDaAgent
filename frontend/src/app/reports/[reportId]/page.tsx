"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { downloadPublishedReportPdf, getPublishedReport, publishReport, reviewReport } from "@/lib/api";
import { ErrorNotice } from "@/components/ui";
import { MarkdownContent } from "@/components/markdown";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";

type Visualization = { id: string; chart_type: string; title: string | null; result_snapshot: { rows?: Array<Record<string, unknown>>; value?: unknown } };
type ReportSection = { id: string; kind: string; title?: string; content_json: { text?: string } };
type Report = { title: string; status?: string; versions: Array<{ status?: string; executive_summary?: string; scope?: { profile_run_id?: string }; sections: ReportSection[]; visualizations: Visualization[]; published_at?: string }> };

const statusLabels: Record<string, string> = { draft: "Bản nháp", in_review: "Đang chờ duyệt", published: "Đã xuất bản", archived: "Đã lưu trữ" };

export default function ReportPage() {
  const params = useParams<{ reportId: string }>();
  const { me } = useAuth();
  const client = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const report = useQuery({ queryKey: ["published-report", params.reportId], queryFn: () => getPublishedReport<Report>(params.reportId) });
  const globalOverride = Boolean(me?.global_role);
  const review = useMutation({
    mutationFn: (payload: { decision: "approved" | "rejected"; comment: string }) => reviewReport<Report>(params.reportId, { ...payload, admin_override: globalOverride }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["published-report", params.reportId] }), client.invalidateQueries({ queryKey: ["published-reports"] })]); },
  });
  const publish = useMutation({
    mutationFn: (reason: string) => publishReport<Report>(params.reportId, { reason, admin_override: globalOverride }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["published-report", params.reportId] }), client.invalidateQueries({ queryKey: ["published-reports"] })]); },
  });

  async function exportFullPdf(profileRunId: string) {
    setExporting(true); setExportError(null);
    try {
      const blob = await downloadPublishedReportPdf(profileRunId, params.reportId);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `profile-report-${params.reportId}.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (error) { setExportError(error); } finally { setExporting(false); }
  }

  if (report.isPending) return <main className="page"><p>Đang tải report…</p></main>;
  if (report.isError || !report.data) return <main className="page"><p role="alert">{report.error?.message ?? "Không tìm thấy report."}</p></main>;
  const version = report.data.versions[0]; const profileRunId = version?.scope?.profile_run_id;
  const canReview = can(me?.effective_permissions, PERMISSIONS.reportReview); const canPublish = can(me?.effective_permissions, PERMISSIONS.reportPublish);
  const isPendingReview = report.data.status === "in_review" && version?.status === "in_review"; const isApproved = version?.status === "approved"; const isBusy = review.isPending || publish.isPending;
  function askForComment(label: string): string | null { const value = window.prompt(`${label} (bắt buộc):`, ""); return value?.trim() || null; }

  return <main className="page report-detail-page">
    <div className="report-detail-toolbar">
      <Link className="button secondary" href="/reports">← Danh sách báo cáo</Link>
      {report.data.status && <span className="chip">{statusLabels[report.data.status] || report.data.status}</span>}
      {canReview && isPendingReview && <>
        <button type="button" className="button primary" onClick={() => { const comment = askForComment("Ghi chú phê duyệt"); if (comment) review.mutate({ decision: "approved", comment }); }} disabled={isBusy}>Phê duyệt</button>
        <button type="button" className="button secondary" onClick={() => { const comment = askForComment("Lý do từ chối / yêu cầu chỉnh sửa"); if (comment) review.mutate({ decision: "rejected", comment }); }} disabled={isBusy}>Từ chối</button>
      </>}
      {canPublish && isApproved && <button type="button" className="button primary" onClick={() => { const reason = askForComment("Lý do publish"); if (reason) publish.mutate(reason); }} disabled={isBusy}>{publish.isPending ? "Đang publish…" : "Publish cho Viewer"}</button>}
      {profileRunId && <button type="button" className="button primary" onClick={() => void exportFullPdf(profileRunId)} disabled={exporting}>{exporting ? "Đang tạo PDF…" : "Xuất PDF đầy đủ"}</button>}
    </div>
    {(exportError !== null || review.isError || publish.isError) && <ErrorNotice error={exportError || review.error || publish.error} />}
    <h1 className="report-detail-title">{report.data.title}</h1>
    {version?.executive_summary && <section className="panel report-detail-section"><h2>Tóm tắt điều hành</h2><MarkdownContent text={version.executive_summary} className="report report-markdown" /></section>}
    {version?.sections.map((section) => <section className="panel report-detail-section" key={section.id}><h2>{section.title || section.kind}</h2><MarkdownContent text={section.content_json.text || "—"} className="report report-markdown" /></section>)}
    {version?.visualizations.map((visualization) => <section className="panel report-detail-section" key={visualization.id}><h2>{visualization.title || visualization.chart_type}</h2><pre>{JSON.stringify(visualization.result_snapshot, null, 2)}</pre></section>)}
  </main>;
}
