"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createNotebook, listNotebooks, restoreNotebook } from "@/lib/api";
import { ProfileRunPicker } from "@/components/profile-run-picker";
import { EmptyState, ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";

type LibraryView = "active" | "archived";

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

export default function NotebooksPage() {
  const client = useQueryClient();
  const [view, setView] = useState<LibraryView>("active");
  const [title, setTitle] = useState("");
  const [profileRunId, setProfileRunId] = useState("");
  const [objective, setObjective] = useState("");
  const notebooks = useQuery({ queryKey: ["notebooks", view], queryFn: ({ signal }) => listNotebooks(signal, undefined, view) });

  useEffect(() => {
    const requestedRunId = new URLSearchParams(window.location.search).get("runId");
    if (requestedRunId) setProfileRunId(requestedRunId);
  }, []);

  const creation = useMutation({
    mutationFn: () => createNotebook({ profile_run_id: profileRunId, title: title.trim(), description: objective.trim() || undefined }),
    onSuccess: async (item) => {
      await client.invalidateQueries({ queryKey: ["notebooks"] });
      window.location.assign(`/notebooks/${item.id}`);
    },
  });
  const restore = useMutation({
    mutationFn: (notebookId: string) => restoreNotebook(notebookId),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["notebooks"] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    creation.mutate();
  }

  if (notebooks.isLoading) return <LoadingBlock label="Đang tải phiên phân tích…" />;
  if (notebooks.isError) return <ErrorNotice error={notebooks.error} retry={() => notebooks.refetch()} />;

  const isArchive = view === "archived";
  return <main className="notebook-library-page">
    <PageHeader
      eyebrow="PHÂN TÍCH CÓ LƯU VẾT"
      title={isArchive ? "Kho lưu trữ phiên phân tích" : "Phiên phân tích"}
      description={isArchive ? "Các phiên đã lưu trữ chỉ hiển thị cho người tạo và có thể khôi phục." : "Lưu mục tiêu, câu hỏi Agent và kết luận theo từng cell trên một phiên profiling. Chat Agent vẫn dành cho trao đổi nhanh."}
      action={<div className="analysis-library-tabs"><button type="button" className={`button ${!isArchive ? "primary" : "secondary"}`} onClick={() => setView("active")}>Đang làm</button><button type="button" className={`button ${isArchive ? "primary" : "secondary"}`} onClick={() => setView("archived")}>Kho lưu trữ</button></div>}
    />

    {!isArchive && <section className="panel notebook-create-panel">
      <div><p className="eyebrow">PHIÊN PHÂN TÍCH MỚI</p><h2>Bắt đầu từ một profile run đã hoàn tất</h2><p className="muted">Nguồn được chọn bằng tên phiên profiling. Không cần nhập hoặc ghi nhớ ID kỹ thuật.</p></div>
      <form className="notebook-create-form" onSubmit={submit}>
        <label>Tên phiên phân tích<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Chất lượng dữ liệu trước khi phát hành" minLength={3} required /></label>
        <ProfileRunPicker id="analysis-session-profile-run" label="Nguồn dữ liệu" value={profileRunId} onChange={setProfileRunId} helpText="Chỉ chọn phiên profiling đã hoàn tất." disabled={creation.isPending} />
        <label>Mục tiêu phân tích<textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Ví dụ: Xác định các vấn đề chất lượng dữ liệu cần xử lý trước khi phát hành." maxLength={2000} /></label>
        <small className="hint">Mục tiêu này sẽ tự tạo thành ghi chú mở đầu của phiên, không bị lặp ở nơi khác.</small>
        {creation.isError && <p className="form-error">{creation.error instanceof Error ? creation.error.message : "Không thể tạo phiên phân tích."}</p>}
        <button className="button primary" disabled={creation.isPending || !profileRunId}>{creation.isPending ? "Đang tạo…" : "Bắt đầu phiên phân tích"}</button>
      </form>
    </section>}

    {restore.isError && <ErrorNotice error={restore.error} />}
    {!notebooks.data?.length ? <EmptyState title={isArchive ? "Kho lưu trữ trống" : "Chưa có phiên phân tích"} detail={isArchive ? "Các phiên bạn lưu trữ sẽ xuất hiện tại đây để có thể khôi phục khi cần." : "Chọn nguồn và mục tiêu ở biểu mẫu phía trên để bắt đầu phiên đầu tiên."} /> : <section className="notebook-grid">
      {notebooks.data.map((item) => <article className="notebook-card" key={item.id}>
        <div className="notebook-card-top"><span className="notebook-icon">A</span><span className={`notebook-visibility ${item.visibility}`}>{isArchive ? "Đã lưu trữ" : item.visibility === "workspace" ? "Đã chia sẻ" : "Riêng tư"}</span></div>
        <h2>{item.title}</h2><p>{item.description || "Chưa ghi mục tiêu phân tích."}</p>
        <div className="notebook-card-meta"><span>{item.profile_run_name || `Phiên bản v${item.profile_run_version ?? "—"}`}</span><time>{formatDate(item.updated_at)}</time></div>
        {isArchive ? <button type="button" className="button secondary" disabled={restore.isPending} onClick={() => restore.mutate(item.id)}>{restore.isPending ? "Đang khôi phục…" : "Khôi phục phiên"}</button> : <Link className="button ghost" href={`/notebooks/${item.id}`}>Mở phiên phân tích <span aria-hidden="true">→</span></Link>}
      </article>)}
    </section>}
    {!isArchive && <Notice tone="info"><b>Khi nào nên dùng?</b><p>Dùng Phiên phân tích để lưu lập luận, cell và kết quả cần quay lại hoặc bàn giao. Với câu hỏi nhanh, hãy tiếp tục dùng Chat Agent.</p></Notice>}
  </main>;
}
