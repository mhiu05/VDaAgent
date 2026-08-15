"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listAnalyses } from "@/lib/api";
import { EmptyState, ErrorNotice, InfoTip, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui";

export default function AnalysesPage() {
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: ({ signal }) => listAnalyses(signal) });
  if (analyses.isLoading) return <LoadingBlock label="Đang tải các phiên phân tích…" />;
  if (analyses.isError) return <ErrorNotice error={analyses.error} retry={() => analyses.refetch()} />;
  return <>
    <PageHeader eyebrow="MỤC TIÊU NGHIỆP VỤ" title="Phân tích chuyên sâu" description="Dùng khi bạn có một câu hỏi rõ ràng cần context, kiểm tra chất lượng và evidence có thể review." action={<div className="inline-actions"><Link className="button primary" href="/analyses/new">Tạo phân tích</Link><InfoTip label="Phân tích chuyên sâu dùng để làm gì">Không phải Chat nhanh: luồng này đi theo mục tiêu, context, quality gate, chạy và review.</InfoTip></div>} />
    {!analyses.data?.length ? <EmptyState title="Chưa có phân tích chuyên sâu" detail="Mở một báo cáo profile đã hoàn tất rồi chọn “Phân tích chuyên sâu”, hoặc dùng nút tạo ở trên." /> : <section className="panel"><div className="table-wrap"><table><thead><tr><th>Mục tiêu</th><th>Chế độ</th><th>Trạng thái</th><th>Tạo lúc</th><th /></tr></thead><tbody>{analyses.data.map((item) => <tr key={item.id}><td><b>{item.goal}</b><br /><small>{item.source?.profile_run_id ? "Nguồn profile đã ghim" : "Nguồn đang được thiết lập"}</small></td><td>{item.mode === "quick" ? "Nhanh" : "Chuyên sâu"}</td><td><StatusBadge status={item.status} /></td><td>{item.created_at ? new Date(item.created_at).toLocaleString("vi-VN") : "—"}</td><td><Link className="button ghost" href={`/analyses/${item.id}`}>Tiếp tục</Link></td></tr>)}</tbody></table></div></section>}
  </>;
}
