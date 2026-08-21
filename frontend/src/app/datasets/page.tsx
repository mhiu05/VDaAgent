"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { deleteDataset, listDatasets } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader } from "@/components/ui";

export default function DatasetsPage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: ({ signal }) => listDatasets(signal) });
  const canDeleteDataset = can(me?.effective_permissions, PERMISSIONS.datasetDelete);
  const deletion = useMutation({
    mutationFn: deleteDataset,
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["datasets"] }); },
  });
  function removeDataset(id: string, name: string) {
    if (window.confirm(`Xóa dataset "${name}" và toàn bộ lịch sử profiling? Hành động này không thể hoàn tác.`)) deletion.mutate(id);
  }
  return <>
    <PageHeader eyebrow="Không gian dữ liệu" title="Bộ dữ liệu" description="Quản lý các nguồn dữ liệu đã được profiling. Chỉ metadata và thống kê đã được phê duyệt được hiển thị." action={<Link href="/datasets/new" className="button primary">+ Bộ dữ liệu mới</Link>} />
    {datasets.isLoading && <LoadingBlock />}
    {datasets.isError && <ErrorNotice error={datasets.error} retry={() => datasets.refetch()} />}
    {deletion.isError && <ErrorNotice error={deletion.error} retry={() => deletion.reset()} />}
    {datasets.data?.length === 0 && <EmptyState title="Chưa có bộ dữ liệu" detail="Tải lên CSV, TSV, Parquet hoặc JSON để Agent tạo hồ sơ dữ liệu đầu tiên." action={<Link href="/datasets/new" className="button primary">Tải dataset lên</Link>} />}
    {!!datasets.data?.length && <section className="panel"><div className="panel-title"><h2>Bộ dữ liệu đã profiling</h2><small>{datasets.data.length} nguồn dữ liệu</small></div><div className="table-wrap"><table><thead><tr><th>Tên bộ dữ liệu</th><th>Nguồn</th><th>Lần profiling gần nhất</th><th aria-label="Thao tác" /></tr></thead><tbody>{datasets.data.map((dataset) => <tr key={dataset.id}><td><b>{dataset.name}</b>{dataset.collection_name && <><br /><span className="dataset-collection-tag">Bộ: {dataset.collection_name}</span></>}<br /><small className="muted">{dataset.id}</small></td><td>{dataset.source_type || "file"}</td><td>{formatDate(dataset.last_profiled_at)}</td><td><div className="inline-actions"><Link className="button secondary" href={`/datasets/${dataset.id}/runs`}>Xem các lần Profiling</Link>{canDeleteDataset && <button className="button danger" disabled={deletion.isPending} onClick={() => removeDataset(dataset.id, dataset.name)}>{deletion.isPending ? "Đang xóa…" : "Xóa"}</button>}</div></td></tr>)}</tbody></table></div></section>}
  </>;
}
