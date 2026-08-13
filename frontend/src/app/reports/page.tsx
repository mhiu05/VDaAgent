"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listPublishedReports } from "@/lib/api";

type Report = { id: string; title: string; status: string; updated_at: string };

export default function ReportsPage() {
  const reports = useQuery({ queryKey: ["published-reports"], queryFn: () => listPublishedReports<{ reports: Report[] }>() });
  return <main className="page"><h1>Báo cáo đã xuất bản</h1>{reports.isPending && <p>Đang tải báo cáo…</p>}{reports.isError && <p role="alert">{reports.error.message}</p>}{reports.data && (reports.data.reports.length ? <div className="card-grid">{reports.data.reports.map((report) => <Link className="panel" href={`/reports/${report.id}`} key={report.id}><h2>{report.title}</h2><p>{report.status} · {new Date(report.updated_at).toLocaleDateString("vi-VN")}</p></Link>)}</div> : <p>Chưa có báo cáo được publish.</p>)}</main>;
}
