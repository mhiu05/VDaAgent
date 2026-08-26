"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { deleteDataset, listDatasets } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { EmptyState, ErrorNotice, LoadingBlock, LoadingButton, PageHeader, StatusBadge, useToast } from "@/components/ui";

const activeProfileStatuses = new Set(["queued", "running", "resuming"]);

function isProfileActive(status?: string | null): boolean {
  return Boolean(status && activeProfileStatuses.has(status.toLowerCase()));
}

function profileStatusHint(status: string, error?: string | null): string {
  if (status === "queued") return "Đang chờ worker bắt đầu xử lý.";
  if (status === "running" || status === "resuming") return "Đang xử lý; trang sẽ tự cập nhật.";
  if (status === "pending_review") return "Đã tính xong; còn bước review đề xuất.";
  if (status === "failed") return error || "Profiling thất bại; mở lịch sử để xem chi tiết.";
  return "Đã hoàn tất.";
}

export default function DatasetsPage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: ({ signal }) => listDatasets(signal),
    refetchInterval: (query) =>
      query.state.data?.some((dataset) => isProfileActive(dataset.latest_run_status)) ? 3_000 : false,
  });
  const canDeleteDataset = can(me?.effective_permissions, PERMISSIONS.datasetDelete);
  const deletion = useMutation({
    mutationFn: deleteDataset,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Dataset đã được xóa.");
    },
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
    {!!datasets.data?.length && <section className="panel"><div className="panel-title"><h2>Bộ dữ liệu đã profiling</h2><small>{datasets.data.length} nguồn dữ liệu</small></div><div className="table-wrap"><table><thead><tr><th>Tên bộ dữ liệu</th><th>Nguồn</th><th>Lần profiling gần nhất</th><th aria-label="Thao tác" /></tr></thead><tbody>{datasets.data.map((dataset) => <tr key={dataset.id}><td><b>{dataset.name}</b>{dataset.collection_name && <><br /><span className="dataset-collection-tag">Bộ: {dataset.collection_name}</span></>}<br /><small className="muted">{dataset.id}</small></td><td>{dataset.source_type || "file"}</td><td>{dataset.latest_run_status ? <><StatusBadge status={dataset.latest_run_status} /><br /><small>{profileStatusHint(dataset.latest_run_status, dataset.latest_run_error)}</small>{dataset.latest_run_status === "completed" && <><br /><small>{formatDate(dataset.last_profiled_at)}</small></>}</> : dataset.last_profiled_at ? formatDate(dataset.last_profiled_at) : <span className="muted">Chưa chạy</span>}</td><td><div className="inline-actions"><Link className="button secondary" href={`/datasets/${dataset.id}/runs`}>Xem các lần Profiling</Link>{canDeleteDataset && <LoadingButton className="button danger" busy={deletion.isPending && deletion.variables === dataset.id} disabled={deletion.isPending} onClick={() => removeDataset(dataset.id, dataset.name)}>{deletion.isPending && deletion.variables === dataset.id ? "Đang xóa…" : "Xóa"}</LoadingButton>}</div></td></tr>)}</tbody></table></div></section>}
  </>;
}
