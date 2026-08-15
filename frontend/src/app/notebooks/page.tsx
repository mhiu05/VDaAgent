"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createNotebook, listNotebooks } from "@/lib/api";
import { EmptyState, ErrorNotice, LoadingBlock, PageHeader } from "@/components/ui";

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

export default function NotebooksPage() {
  const client = useQueryClient();
  const notebooks = useQuery({ queryKey: ["notebooks"], queryFn: ({ signal }) => listNotebooks(signal) });
  const [title, setTitle] = useState("");
  const [profileRunId, setProfileRunId] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    const requestedRunId = new URLSearchParams(window.location.search).get("runId");
    if (requestedRunId) setProfileRunId(requestedRunId);
  }, []);
  const creation = useMutation({
    mutationFn: () => createNotebook({ profile_run_id: profileRunId.trim(), title: title.trim(), description: description.trim() || undefined }),
    onSuccess: async (item) => {
      await client.invalidateQueries({ queryKey: ["notebooks"] });
      window.location.assign(`/notebooks/${item.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    creation.mutate();
  }

  if (notebooks.isLoading) return <LoadingBlock label="Đang tải notebook…" />;
  if (notebooks.isError) return <ErrorNotice error={notebooks.error} retry={() => notebooks.refetch()} />;

  return <main className="notebook-library-page">
    <PageHeader
      eyebrow="Giai đoạn 3 · Notebook LLM"
      title="Notebook phân tích"
      description="Lưu câu hỏi, câu trả lời Agent và ghi chú theo từng cell trên cùng một profile run. Notebook chỉ chia sẻ trong workspace hiện tại."
      action={<span className="workspace-count">{notebooks.data?.length || 0} notebook</span>}
    />

    <section className="panel notebook-create-panel">
      <div><p className="eyebrow">Tạo notebook mới</p><h2>Bắt đầu một phiên phân tích có thể lưu lại</h2><p className="muted">Chọn profile run đã hoàn tất để Agent luôn trả lời đúng nguồn dữ liệu.</p></div>
      <form className="notebook-create-form" onSubmit={submit}>
        <label>Tên notebook<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Phân tích doanh thu theo khu vực" minLength={3} required /></label>
        <label>Profile run ID<input value={profileRunId} onChange={(event) => setProfileRunId(event.target.value)} placeholder="Dán ID của profile run completed" required /></label>
        <label>Mô tả <span className="muted">(tùy chọn)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mục tiêu hoặc bối cảnh phân tích" /></label>
        {creation.isError && <p className="form-error">{creation.error instanceof Error ? creation.error.message : "Không thể tạo notebook."}</p>}
        <button className="button primary" disabled={creation.isPending}>{creation.isPending ? "Đang tạo…" : "Tạo notebook"}</button>
      </form>
    </section>

    {!notebooks.data?.length ? <EmptyState title="Chưa có notebook" detail="Tạo notebook từ một profile run hoàn tất để bắt đầu phân tích theo cell." action={<Link className="button secondary" href="/datasets">Mở bộ dữ liệu</Link>} /> : <section className="notebook-grid">
      {notebooks.data.map((item) => <article className="notebook-card" key={item.id}>
        <div className="notebook-card-top"><span className="notebook-icon">N</span><span className={`notebook-visibility ${item.visibility}`}>{item.visibility === "workspace" ? "Đã chia sẻ" : "Riêng tư"}</span></div>
        <h2>{item.title}</h2><p>{item.description || "Notebook phân tích có lưu context và kết quả Agent."}</p>
        <div className="notebook-card-meta"><span>Profile {item.profile_run_id.slice(0, 10)}…</span><time>{formatDate(item.updated_at)}</time></div>
        <Link className="button ghost" href={`/notebooks/${item.id}`}>Mở notebook <span aria-hidden="true">→</span></Link>
      </article>)}
    </section>}
  </main>;
}
