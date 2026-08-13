"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import { deleteReport, listPublishedReports } from "@/lib/api";

type Report = { id: string; title: string; status: string; updated_at: string; created_by_user_id: string };

const statusLabels: Record<string, string> = {
  draft: "Bản nháp",
  in_review: "Đang chờ duyệt",
  published: "Đã xuất bản",
  archived: "Đã lưu trữ",
};

function statusClass(status: string): string {
  return `report-status report-status-${status.replace(/[^a-z0-9_-]/gi, "-")}`;
}

export default function ReportsPage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const reports = useQuery({ queryKey: ["published-reports"], queryFn: () => listPublishedReports<{ reports: Report[] }>() });
  const deletion = useMutation({
    mutationFn: deleteReport,
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["published-reports"] }); },
  });
  const items = reports.data?.reports ?? [];
  const canDeleteReport = can(me?.effective_permissions, PERMISSIONS.reportDraftWrite);

  function removeReport(report: Report) {
    if (!window.confirm(`Xóa báo cáo "${report.title}"? Báo cáo sẽ bị xóa khỏi danh sách nộp duyệt.`)) return;
    deletion.mutate(report.id);
  }

  return <main className="page reports-page">
    <header className="reports-hero">
      <div>
        <p className="eyebrow">REPORT WORKSPACE</p>
        <h1>Báo cáo</h1>
        <p className="reports-hero-description">Tập trung các snapshot được tạo từ profile run hoàn tất. Mỗi báo cáo giữ lại nguồn, trạng thái review và bằng chứng để dễ dàng kiểm tra lại.</p>
      </div>
      <div className="reports-hero-stat" aria-label={`${items.length} báo cáo`}>
        <span className="reports-hero-stat-icon" aria-hidden="true">▤</span>
        <strong>{items.length}</strong>
        <small>báo cáo trong workspace</small>
      </div>
    </header>

    {reports.isError && <ErrorNotice error={reports.error} />}
    {reports.isPending && <LoadingBlock label="Đang tải danh sách báo cáo…" />}
    {!reports.isPending && !reports.isError && <section className="reports-library">
      <div className="reports-library-heading">
        <div><p className="eyebrow">REPORT LIBRARY</p><h2>Danh sách báo cáo</h2></div>
        <span className="reports-count">{items.length} mục</span>
      </div>
      {deletion.isError && <ErrorNotice error={deletion.error} retry={() => deletion.reset()} />}
      {items.length ? <div className="report-card-grid">{items.map((report) => <article className="report-card" key={report.id}>
        <div className="report-card-top"><span className="report-card-icon" aria-hidden="true">▤</span><span className={statusClass(report.status)}>{statusLabels[report.status] || report.status}</span></div>
        <Link className="report-card-title-link" href={`/reports/${report.id}`}><h2>{report.title}</h2></Link>
        <div className="report-card-meta"><span>Profile snapshot</span><time dateTime={report.updated_at}>{formatDate(report.updated_at)}</time></div>
        <div className="report-card-footer"><Link href={`/reports/${report.id}`}>Mở báo cáo <span aria-hidden="true">→</span></Link>{canDeleteReport && report.created_by_user_id === me?.user.id && report.status !== "published" && <button type="button" className="report-delete-button" onClick={() => removeReport(report)} disabled={deletion.isPending}>{deletion.isPending ? "Đang xóa…" : "Xóa báo cáo"}</button>}</div>
      </article>)}</div> : <div className="reports-empty"><span className="reports-empty-icon" aria-hidden="true">✦</span><h3>Chưa có báo cáo</h3><p>Hoàn tất một profile run rồi chọn “Xuất báo cáo” để tạo snapshot tại đây.</p><Link className="button primary" href="/datasets">Mở bộ dữ liệu</Link></div>}
    </section>}
  </main>;
}
