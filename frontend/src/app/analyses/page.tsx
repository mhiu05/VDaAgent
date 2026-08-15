"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listAnalyses } from "@/lib/api";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui";

export default function AnalysesPage() {
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: ({ signal }) => listAnalyses(signal) });
  if (analyses.isLoading) return <LoadingBlock label="Đang tải các phiên phân tích…" />;
  if (analyses.isError) return <ErrorNotice error={analyses.error} retry={() => analyses.refetch()} />;
  return <>
    <PageHeader eyebrow="Không gian phân tích" title="Các phiên phân tích" description="Mỗi mục tiêu phân tích được ghim vào một profile version, context và evidence riêng." action={<Link className="button primary" href="/analyses/new">Bắt đầu phân tích</Link>} />
    {!analyses.data?.length ? <EmptyState title="Chưa có phiên phân tích" detail="Bắt đầu từ profile đã hoàn tất để tạo câu trả lời có evidence." action={<Link className="button primary" href="/datasets">Mở bộ dữ liệu</Link>} /> : <section className="panel"><div className="table-wrap"><table><thead><tr><th>Mục tiêu</th><th>Chế độ</th><th>Trạng thái</th><th>Tạo lúc</th><th /></tr></thead><tbody>{analyses.data.map((item) => <tr key={item.id}><td><b>{item.goal}</b><br /><small>{item.source?.profile_run_id || "Nguồn đã ghim"}</small></td><td>{item.mode === "quick" ? "Quick Answer" : "Deep Analysis"}</td><td><StatusBadge status={item.status} /></td><td>{item.created_at ? new Date(item.created_at).toLocaleString("vi-VN") : "—"}</td><td><Link className="button ghost" href={`/analyses/${item.id}`}>Mở</Link></td></tr>)}</tbody></table></div></section>}
  </>;
}
