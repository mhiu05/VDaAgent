"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { PERMISSIONS, can } from "@/lib/auth/permissions";
import { getDashboard } from "@/lib/api";

type Dashboard = { kind: "viewer" | "analyst" | "admin"; reports?: Array<{ id: string; title: string; status: string }>; counts?: Record<string, number>; pending_review?: Array<{ id: string; title: string }> };

const countMeta: Record<string, { label: string; description: string; icon: string }> = {
  datasets: { label: "Bộ dữ liệu", description: "nguồn đã tải lên", icon: "▦" },
  profiles: { label: "Profile", description: "lần kiểm tra dữ liệu", icon: "◌" },
  analyses: { label: "Phân tích", description: "phiên có evidence", icon: "⌁" },
  reports: { label: "Báo cáo", description: "bản nháp và đã xuất bản", icon: "▤" },
};

const roleCopy = {
  viewer: { eyebrow: "Viewer workspace", title: "Báo cáo đã xuất bản", description: "Theo dõi các báo cáo đã được công bố trong workspace." },
  analyst: { eyebrow: "Analyst workspace", title: "Sẵn sàng phân tích", description: "Bắt đầu bằng cách tải dữ liệu lên, sau đó profile, review và phân tích dựa trên evidence." },
  admin: { eyebrow: "Admin workspace", title: "Tổng quan vận hành", description: "Theo dõi khối lượng dữ liệu, báo cáo và công việc cần review." },
} as const;

export default function DashboardPage() {
  const { me, loading, error } = useAuth();
  const dashboard = useQuery({ queryKey: ["dashboard", me?.workspace.id], queryFn: () => getDashboard<Dashboard>(), enabled: Boolean(me) });

  if (loading) return <main className="dashboard-page"><section className="dashboard-loading" aria-live="polite"><span className="dashboard-loading-mark" aria-hidden="true" /><div><b>Đang mở workspace…</b><p>Đang chuẩn bị dữ liệu và quyền truy cập theo role đã chọn.</p></div></section></main>;
  if (error) return <main className="page"><h1>Không thể mở workspace</h1><p>{error}</p><Link href="/">Về trang chủ</Link></main>;
  if (!me) return null;
  if (dashboard.isPending) return <main className="dashboard-page"><section className="dashboard-loading" aria-live="polite"><span className="dashboard-loading-mark" aria-hidden="true" /><div><b>Đang tải dữ liệu workspace…</b><p>Chỉ mất một chút thời gian.</p></div></section></main>;
  if (dashboard.isError) return <main className="page"><p>{dashboard.error.message}</p></main>;

  const data = dashboard.data;
  const copy = roleCopy[data.kind];
  const counts = Object.entries(data.counts ?? {});

  return <main className="dashboard-page">
    <header className="dashboard-header">
      <div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div>
      {can(me.effective_permissions, PERMISSIONS.datasetUpload) && <Link href="/datasets/new" className="button primary">Tải dữ liệu lên <span aria-hidden="true">→</span></Link>}
    </header>

    {counts.length > 0 && <section aria-labelledby="workspace-overview"><div className="dashboard-section-heading"><div><p className="eyebrow">Tổng quan</p><h2 id="workspace-overview">Tiến độ workspace</h2></div><small>Cập nhật theo workspace hiện tại</small></div><dl className="dashboard-stats-grid">{counts.map(([key, value]) => {
      const meta = countMeta[key] ?? { label: key, description: "mục trong workspace", icon: "•" };
      return <div className="dashboard-stat-card" key={key}><div className="dashboard-stat-icon" aria-hidden="true">{meta.icon}</div><div><dt>{meta.label}</dt><dd>{value}</dd><small>{meta.description}</small></div></div>;
    })}</dl></section>}

    <section className="dashboard-reports panel"><div><p className="eyebrow">Báo cáo</p><h2>{data.kind === "viewer" ? "Báo cáo đã xuất bản" : "Báo cáo và review"}</h2></div>{data.reports?.length ? <ul>{data.reports.map((report) => <li key={report.id}><Link href={`/reports/${report.id}`}>{report.title}</Link><small>{report.status}</small></li>)}</ul> : <div className="dashboard-empty"><span aria-hidden="true">✦</span><div><b>Chưa có báo cáo phù hợp</b><p>{data.kind === "analyst" ? "Tải dataset đầu tiên để bắt đầu tạo evidence và báo cáo." : "Báo cáo sẽ xuất hiện tại đây khi có dữ liệu phù hợp."}</p></div></div>}</section>
  </main>;
}
