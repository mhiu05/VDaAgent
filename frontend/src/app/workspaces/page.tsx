"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { createWorkspace, deleteWorkspace, listWorkspaces, purgeWorkspace, type WorkspaceSummary } from "@/lib/api";
import { useState, type FormEvent } from "react";

const roleLabels: Record<string, string> = {
  admin: "Admin",
  analyst: "Analyst",
  viewer: "Viewer",
};

const roleDescriptions: Record<string, string> = {
  admin: "Quản trị thành viên, activity và phê duyệt",
  analyst: "Upload, profiling, Agent và tạo báo cáo",
  viewer: "Chỉ xem báo cáo đã xuất bản",
};

export default function WorkspacesPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { me, workspaceId, switchWorkspace } = useAuth();
  const [name, setName] = useState("");
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: listWorkspaces, enabled: Boolean(me) });
  const creation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: async (workspace) => {
      await client.invalidateQueries({ queryKey: ["workspaces"] });
      setName("");
      await switchWorkspace(workspace.id);
      router.push("/dashboard");
    },
  });
  const deletion = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: async (_result, deletedId) => {
      await client.invalidateQueries({ queryKey: ["workspaces"] });
      if (deletedId === workspaceId) window.location.assign("/workspaces");
    },
  });
  const purging = useMutation({
    mutationFn: purgeWorkspace,
    onSuccess: async (_result, deletedId) => {
      await client.invalidateQueries({ queryKey: ["workspaces"] });
      if (deletedId === workspaceId) window.location.assign("/workspaces");
    },
  });

  const canCreate = can(me?.effective_permissions, PERMISSIONS.workspaceCreate);
  const canDelete = can(me?.effective_permissions, PERMISSIONS.workspaceDelete);
  const workspaceActionBusy = deletion.isPending || purging.isPending;
  const items = workspaces.data?.workspaces ?? [];

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length >= 2) creation.mutate(trimmed);
  }

  function removeWorkspace(workspace: WorkspaceSummary) {
    if (!window.confirm(`Lưu trữ workspace "${workspace.name}"? Workspace sẽ được ẩn khỏi danh sách hoạt động nhưng dữ liệu vẫn được giữ lại.`)) return;
    deletion.mutate(workspace.id);
  }

  function permanentlyDeleteWorkspace(workspace: WorkspaceSummary) {
    const confirmation = window.prompt(
      `Xóa vĩnh viễn workspace "${workspace.name}" sẽ xóa toàn bộ dataset, profile, report và file đã upload.\n\nNhập XÓA để xác nhận:`,
    );
    if (confirmation !== "XÓA") return;
    purging.mutate(workspace.id);
  }

  async function openWorkspace(id: string) {
    if (id !== workspaceId) await switchWorkspace(id);
    router.push("/dashboard");
  }

  return <main className="page workspace-page">
    <header className="workspace-page-header">
      <div><p className="eyebrow">WORKSPACE HUB</p><h1>Workspace của bạn</h1><p className="page-description">Mỗi workspace là một khu vực làm việc riêng cho dataset, profile, report và lịch sử Agent.</p></div>
      <span className="workspace-count">{items.length} workspace</span>
    </header>

    {workspaces.isPending && <LoadingBlock label="Đang tải danh sách workspace…" />}
    {workspaces.isError && <ErrorNotice error={workspaces.error} retry={() => workspaces.refetch()} />}
    {creation.isError && <ErrorNotice error={creation.error} retry={() => creation.reset()} />}
    {deletion.isError && <ErrorNotice error={deletion.error} retry={() => deletion.reset()} />}
    {purging.isError && <ErrorNotice error={purging.error} retry={() => purging.reset()} />}

    {canCreate && <section className="panel workspace-create-panel"><div><p className="eyebrow">PROJECT WORKSPACE</p><h2>Tạo workspace mới</h2><p className="muted">Upload dataset vào workspace này để dùng chung cho Profiling, Report và Agent.</p></div><form className="workspace-create-form" onSubmit={submitCreate}><label htmlFor="workspace-name">Tên workspace<input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Dự án IMDb" maxLength={255} /></label><button className="button primary" type="submit" disabled={creation.isPending || name.trim().length < 2}>{creation.isPending ? "Đang tạo…" : "Tạo workspace"}</button></form></section>}

    {!workspaces.isPending && !workspaces.isError && <section className="workspace-grid" aria-label="Danh sách workspace">{items.map((workspace) => {
      const current = workspace.id === workspaceId;
      const removable = canDelete && workspace.is_project && (workspace.role === "admin" || (workspace.role === "analyst" && workspace.created_by_user_id === me?.user.id));
      return <article className={current ? "workspace-card current" : "workspace-card"} key={workspace.id}>
        <div className="workspace-card-top"><span className="workspace-card-icon" aria-hidden="true">▦</span><span className="workspace-role">{roleLabels[workspace.role] || workspace.role}</span></div>
        <h2>{workspace.name}</h2>
        <p className="workspace-card-capabilities">{roleDescriptions[workspace.role] || "Quyền workspace đang được giới hạn theo role."}</p>
        <p className="workspace-card-slug">/{workspace.slug}</p>
        <div className="workspace-card-actions"><button className="button primary" type="button" onClick={() => void openWorkspace(workspace.id)} disabled={workspaceActionBusy}>{current ? "Đang mở" : "Mở workspace"}</button>{removable && <><button className="button workspace-archive" type="button" onClick={() => removeWorkspace(workspace)} disabled={workspaceActionBusy}>{deletion.isPending ? "Đang lưu trữ…" : "Lưu trữ"}</button><button className="button danger workspace-permanent-delete" type="button" onClick={() => permanentlyDeleteWorkspace(workspace)} disabled={workspaceActionBusy}>{purging.isPending ? "Đang xóa…" : "Xóa workspace"}</button></>}</div>
      </article>;
    })}</section>}

    {!workspaces.isPending && !workspaces.isError && items.length === 0 && <section className="empty-state"><span aria-hidden="true">✦</span><h2>Chưa có workspace</h2><p>Hãy tạo workspace để bắt đầu upload dataset và làm việc với Agent.</p></section>}
    <p className="workspace-page-note"><Link href="/datasets">Mở bộ dữ liệu</Link> để upload dataset trong workspace đang chọn.</p>
  </main>;
}
