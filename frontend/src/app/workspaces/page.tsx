"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { createWorkspace, deleteWorkspace, listArchivedWorkspaces, listWorkspaces, purgeWorkspace, restoreWorkspace, type WorkspaceSummary } from "@/lib/api";
import { useState, type FormEvent } from "react";

const roleLabel = "Analyst";
const roleDescription = "Upload, profiling, Agent, review và tạo báo cáo";

export default function WorkspacesPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { me, workspaceId, switchWorkspace } = useAuth();
  const [name, setName] = useState("");
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: listWorkspaces, enabled: Boolean(me) });
  const archivedWorkspaces = useQuery({
    queryKey: ["archived-workspaces"],
    queryFn: listArchivedWorkspaces,
    enabled: Boolean(me && can(me.effective_permissions, PERMISSIONS.workspaceDelete)),
  });
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
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workspaces"] });
      await client.invalidateQueries({ queryKey: ["archived-workspaces"] });
    },
  });
  const purging = useMutation({
    mutationFn: purgeWorkspace,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workspaces"] });
      await client.invalidateQueries({ queryKey: ["archived-workspaces"] });
    },
  });
  const restoration = useMutation({
    mutationFn: restoreWorkspace,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["workspaces"] }),
        client.invalidateQueries({ queryKey: ["archived-workspaces"] }),
      ]);
    },
  });

  const canCreate = can(me?.effective_permissions, PERMISSIONS.workspaceCreate);
  const canDelete = can(me?.effective_permissions, PERMISSIONS.workspaceDelete);
  const workspaceActionBusy = deletion.isPending || purging.isPending || restoration.isPending;
  const items = workspaces.data?.workspaces ?? [];
  const archivedItems = archivedWorkspaces.data?.workspaces ?? [];

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length >= 2) creation.mutate(trimmed);
  }

  function removeWorkspace(workspace: WorkspaceSummary) {
    if (workspace.id === workspaceId && items.length < 2) {
      window.alert("Hãy tạo hoặc mở một workspace khác trước khi lưu trữ workspace hiện tại.");
      return;
    }
    if (!window.confirm(`Lưu trữ workspace "${workspace.name}"? Workspace sẽ được ẩn khỏi danh sách hoạt động nhưng dữ liệu vẫn được giữ lại.`)) return;
    deletion.mutate(workspace.id, {
      onSuccess: async () => {
        if (workspace.id === workspaceId) {
          const next = items.find((item) => item.id !== workspace.id);
          if (next) await switchWorkspace(next.id);
        }
      },
    });
  }

  function permanentlyDeleteWorkspace(workspace: WorkspaceSummary) {
    if (workspace.id === workspaceId && items.length < 2) {
      window.alert("Hãy tạo hoặc mở một workspace khác trước khi xóa workspace hiện tại.");
      return;
    }
    const confirmation = window.prompt(
      `Xóa vĩnh viễn workspace "${workspace.name}" sẽ xóa toàn bộ dataset, profile, report và file đã upload.\n\nNhập XÓA để xác nhận:`,
    );
    if (confirmation !== "XÓA") return;
    purging.mutate(workspace.id, {
      onSuccess: async () => {
        if (workspace.id === workspaceId) {
          const next = items.find((item) => item.id !== workspace.id);
          if (next) await switchWorkspace(next.id);
        }
      },
    });
  }

  function restoreArchivedWorkspace(workspace: WorkspaceSummary) {
    restoration.mutate(workspace.id);
  }

  async function openWorkspace(id: string) {
    if (id !== workspaceId) await switchWorkspace(id);
    router.push("/dashboard");
  }

  return <main className="page workspace-page">
    <header className="workspace-page-header">
      <div><p className="eyebrow">WORKSPACE HUB</p><h1>Quản lý Workspace</h1><p className="page-description">Mỗi workspace là một không gian chứa dataset, profile, report và kết quả làm việc của Analyst.</p></div>
      <span className="workspace-count">{items.length} workspace</span>
    </header>

    {workspaces.isPending && <LoadingBlock label="Đang tải danh sách workspace…" />}
    {workspaces.isError && <ErrorNotice error={workspaces.error} retry={() => workspaces.refetch()} />}
    {creation.isError && <ErrorNotice error={creation.error} retry={() => creation.reset()} />}
    {deletion.isError && <ErrorNotice error={deletion.error} retry={() => deletion.reset()} />}
    {purging.isError && <ErrorNotice error={purging.error} retry={() => purging.reset()} />}
    {restoration.isError && <ErrorNotice error={restoration.error} retry={() => restoration.reset()} />}

    {canCreate && <section className="panel workspace-create-panel"><div><p className="eyebrow">NEW WORKSPACE</p><h2>Tạo workspace mới</h2><p className="muted">Tạo không gian để Analyst upload dữ liệu, profiling và phân tích.</p></div><form className="workspace-create-form" onSubmit={submitCreate}><label htmlFor="workspace-name">Tên workspace<input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Phân tích khách hàng" maxLength={255} /></label><button className="button primary" type="submit" disabled={creation.isPending || name.trim().length < 2}>{creation.isPending ? "Đang tạo…" : "Tạo workspace"}</button></form></section>}

    {!workspaces.isPending && !workspaces.isError && <section className="workspace-grid" aria-label="Danh sách workspace">{items.map((workspace) => {
      const current = workspace.id === workspaceId;
      const removable = canDelete && workspace.is_project && workspace.created_by_user_id === me?.user.id;
      return <article className={current ? "workspace-card current" : "workspace-card"} key={workspace.id}>
        <div className="workspace-card-top"><span className="workspace-card-icon" aria-hidden="true">▦</span><span className="workspace-role">{roleLabel}</span></div>
        <h2>{workspace.name}</h2>
        <p className="workspace-card-capabilities">{roleDescription}</p>
        <p className="workspace-card-slug">/{workspace.slug}</p>
        <div className="workspace-card-actions"><button className="button primary" type="button" onClick={() => void openWorkspace(workspace.id)} disabled={workspaceActionBusy}>{current ? "Đang mở" : "Mở workspace"}</button>{removable && <><button className="button workspace-archive" type="button" onClick={() => removeWorkspace(workspace)} disabled={workspaceActionBusy}>{deletion.isPending ? "Đang lưu trữ…" : "Lưu trữ"}</button><button className="button danger workspace-permanent-delete" type="button" onClick={() => permanentlyDeleteWorkspace(workspace)} disabled={workspaceActionBusy}>{purging.isPending ? "Đang xóa…" : "Xóa workspace"}</button></>}</div>
      </article>;
    })}</section>}

    {canDelete && !archivedWorkspaces.isPending && archivedItems.length > 0 && <section className="workspace-archive-library" aria-labelledby="archived-workspaces-title">
      <div className="workspace-archive-heading"><div><p className="eyebrow">KHO LƯU TRỮ</p><h2 id="archived-workspaces-title">Workspace đã lưu trữ</h2><p className="muted">Dữ liệu vẫn được giữ nguyên. Chủ workspace có thể khôi phục khi cần.</p></div><span className="workspace-count">{archivedItems.length} mục</span></div>
      <div className="workspace-grid">{archivedItems.map((workspace) => <article className="workspace-card archived" key={workspace.id}>
        <div className="workspace-card-top"><span className="workspace-card-icon" aria-hidden="true">□</span><span className="workspace-role">Đã lưu trữ</span></div>
        <h2>{workspace.name}</h2><p className="workspace-card-capabilities">Workspace tạm ngừng hoạt động; dataset và báo cáo chưa bị xóa.</p><p className="workspace-card-slug">/{workspace.slug}</p>
        <div className="workspace-card-actions"><button className="button secondary" type="button" onClick={() => restoreArchivedWorkspace(workspace)} disabled={workspaceActionBusy}>{restoration.isPending ? "Đang khôi phục…" : "Khôi phục"}</button><button className="button danger" type="button" onClick={() => permanentlyDeleteWorkspace(workspace)} disabled={workspaceActionBusy}>{purging.isPending ? "Đang xóa…" : "Xóa vĩnh viễn"}</button></div>
      </article>)}</div>
    </section>}

    {!workspaces.isPending && !workspaces.isError && items.length === 0 && <section className="empty-state"><span aria-hidden="true">✦</span><h2>Chưa có workspace</h2><p>Hãy tạo workspace để bắt đầu upload dataset và làm việc với Agent.</p></section>}
    {can(me?.effective_permissions, PERMISSIONS.datasetRead) && <p className="workspace-page-note"><Link href="/datasets">Mở bộ dữ liệu</Link> để upload dataset trong workspace đang chọn.</p>}
  </main>;
}
