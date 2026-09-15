"use client";

import React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock, useDialog } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import { archiveReport, listPublishedReports, listReportReviewQueue, publishReport, reviewReport } from "@/lib/api";

type Report = { id: string; title: string; status: string; updated_at: string; created_by_user_id: string; workspace_id?: string };
type ReviewQueueReport = {
  id: string;
  title: string;
  status: "in_review" | "approved";
  report_version_id: string;
  version: number;
  executive_summary?: string | null;
  submitted_by_user_id?: string | null;
  submitted_at?: string | null;
};

const statusLabels: Record<string, string> = {
  draft: "Bản nháp",
  in_review: "Đang chờ duyệt",
  approved: "Đã duyệt",
  changes_requested: "Cần chỉnh sửa",
  rejected: "Đã từ chối",
  published: "Đã xuất bản",
  archived: "Đã lưu trữ",
};
function statusClass(status: string): string {
  return `report-status report-status-${status.replace(/[^a-z0-9_-]/gi, "-")}`;
}
export default function ReportsPage() {
  const { me, workspaceId } = useAuth();
  const client = useQueryClient();
  const dialog = useDialog();
  const reportsKey = ["published-reports", workspaceId] as const;
  const reviewQueueKey = ["report-review-queue", workspaceId] as const;
  const canReview = can(me?.effective_permissions, PERMISSIONS.reportReview);
  const canPublish = can(me?.effective_permissions, PERMISSIONS.reportPublish);
  const canArchive = can(me?.effective_permissions, PERMISSIONS.reportArchive);
  const canReadDatasets = can(me?.effective_permissions, PERMISSIONS.datasetRead);
  const reports = useQuery({ queryKey: reportsKey, queryFn: () => listPublishedReports<{ reports: Report[] }>() });
  const reviewQueue = useQuery({
    queryKey: reviewQueueKey,
    queryFn: () => listReportReviewQueue<{ reports: ReviewQueueReport[] }>(),
    enabled: canReview,
  });
  const transition = useMutation({
    mutationFn: ({ reportId, action }: { reportId: string; action: "approved" | "changes_requested" | "rejected" | "publish" }) => (
      action === "publish"
        ? publishReport(reportId)
        : reviewReport(reportId, { decision: action })
    ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: reviewQueueKey }),
        client.invalidateQueries({ queryKey: reportsKey }),
      ]);
    },
  });
  const archive = useMutation({
    mutationFn: (reportId: string) => archiveReport(reportId),
    onSuccess: () => client.invalidateQueries({ queryKey: reportsKey }),
  });
  const items = reports.data?.reports ?? [];
  const queueItems = reviewQueue.data?.reports ?? [];

  async function archivePublishedReport(report: Report) {
    const confirmed = await dialog.confirm({
      title: "Lưu trữ báo cáo",
      message: `Lưu trữ báo cáo đã xuất bản "${report.title}"? Báo cáo sẽ không còn xuất hiện trong thư viện published.`,
      confirmLabel: "Lưu trữ",
      tone: "danger",
    });
    if (confirmed) archive.mutate(report.id);
  }

  return <main className="page reports-page">
    <header className="reports-hero">
      <div>
        <p className="eyebrow">REPORT WORKSPACE</p>
        <h1>Báo cáo</h1>
        <p className="reports-hero-description">Tập trung các snapshot được tạo từ profile run hoàn tất. Mỗi báo cáo được xuất bản ngay trong workspace cùng nguồn và bằng chứng để dễ dàng kiểm tra lại.</p>
      </div>
      <div className="reports-hero-stat" aria-label={`${items.length} báo cáo`}>
        <span className="reports-hero-stat-icon" aria-hidden="true">▤</span>
        <strong>{items.length}</strong>
        <small>báo cáo trong workspace</small>
      </div>
    </header>

    {canReview && <section className="reports-library" aria-labelledby="report-review-queue-heading">
      <div className="reports-library-heading">
        <div><p className="eyebrow">OWNER REVIEW</p><h2 id="report-review-queue-heading">Chờ duyệt hoặc phát hành</h2></div>
        <span className="reports-count">{queueItems.length} mục</span>
      </div>
      {reviewQueue.isPending && <LoadingBlock label="Đang tải hàng chờ duyệt…" />}
      {reviewQueue.isError && <ErrorNotice error={reviewQueue.error} />}
      {transition.isError && <ErrorNotice error={transition.error} retry={() => transition.reset()} />}
      {!reviewQueue.isPending && !reviewQueue.isError && (queueItems.length ? <div className="report-card-grid">{queueItems.map((report) => {
        const isOwnSubmission = report.submitted_by_user_id === me?.user.id;
        return <article className="report-card" key={report.report_version_id}>
          <div className="report-card-top"><span className="report-card-icon" aria-hidden="true">✓</span><span className={statusClass(report.status)}>{statusLabels[report.status]}</span></div>
          <h3>{report.title}</h3>
          <div className="report-card-meta"><span>Version {report.version}</span><time>{report.submitted_at ? formatDate(report.submitted_at) : "Chưa có thời điểm gửi"}</time></div>
          {report.executive_summary && <p className="muted">{report.executive_summary}</p>}
          <div className="report-card-footer">
            {report.status === "in_review" && (isOwnSubmission
              ? <small className="muted">Bạn đã submit version này nên không thể tự duyệt.</small>
              : <><button type="button" className="button primary" disabled={transition.isPending} onClick={() => transition.mutate({ reportId: report.id, action: "approved" })}>Phê duyệt</button><button type="button" className="button secondary" disabled={transition.isPending} onClick={() => transition.mutate({ reportId: report.id, action: "changes_requested" })}>Yêu cầu chỉnh sửa</button><button type="button" className="button danger" disabled={transition.isPending} onClick={() => transition.mutate({ reportId: report.id, action: "rejected" })}>Từ chối</button></>)}
            {report.status === "approved" && canPublish && <button type="button" className="button primary" disabled={transition.isPending} onClick={() => transition.mutate({ reportId: report.id, action: "publish" })}>Xuất bản</button>}
          </div>
        </article>;
      })}</div> : <p className="muted">Không có report nào đang chờ Owner xử lý.</p>)}
    </section>}

    {reports.isError && <ErrorNotice error={reports.error} />}
    {archive.isError && <ErrorNotice error={archive.error} retry={() => archive.reset()} />}
    {reports.isPending && <LoadingBlock label="Đang tải danh sách báo cáo…" />}
    {!reports.isPending && !reports.isError && <section className="reports-library">
      <div className="reports-library-heading">
        <div><p className="eyebrow">REPORT LIBRARY</p><h2>Danh sách báo cáo</h2></div>
        <span className="reports-count">{items.length} mục</span>
      </div>
      {items.length ? <div className="report-card-grid">{items.map((report) => <article className="report-card" key={report.id}>
        <div className="report-card-top"><span className="report-card-icon" aria-hidden="true">▤</span><span className={statusClass(report.status)}>{statusLabels[report.status] || report.status}</span></div>
        <Link className="report-card-title-link" href={`/reports/${report.id}`}><h2>{report.title}</h2></Link>
        <div className="report-card-meta"><span>Published snapshot</span><time dateTime={report.updated_at}>{formatDate(report.updated_at)}</time></div>
        <div className="report-card-footer"><Link href={`/reports/${report.id}`}>Mở báo cáo <span aria-hidden="true">→</span></Link>{canArchive && <button type="button" className="button danger" onClick={() => archivePublishedReport(report)} disabled={archive.isPending}>{archive.isPending ? "Đang lưu trữ…" : "Lưu trữ"}</button>}</div>
      </article>)}</div> : <div className="reports-empty"><span className="reports-empty-icon" aria-hidden="true">✦</span><h3>Chưa có báo cáo đã xuất bản</h3><p>Report chỉ xuất hiện tại đây sau khi Owner phê duyệt và xuất bản version tương ứng.</p>{canReadDatasets && <Link className="button primary" href="/datasets">Mở bộ dữ liệu</Link>}</div>}
    </section>}
  </main>;
}
