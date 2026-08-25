"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { createWorkspace, deleteWorkspace, listArchivedWorkspaces, listWorkspaces, purgeWorkspace, restoreWorkspace, type WorkspaceSummary } from "@/lib/api";
import { useState, type CSSProperties, type FormEvent } from "react";

const roleLabel = "Analyst";
const roleDescription = "Upload, profiling, Agent, review và tạo báo cáo";

const workspaceTemplates = [
  { id: "business", name: "Business", description: "Hiệu quả kinh doanh & vận hành", domain: "Business", primaryGoal: "Theo dõi hiệu quả kinh doanh, doanh thu và cơ hội tăng trưởng.", targetAudience: "Ban điều hành và quản lý vận hành", primaryColor: "#315efb", secondaryColor: "#18a77b" },
  { id: "marketing", name: "Marketing", description: "Chiến dịch, chuyển đổi & tăng trưởng kênh", domain: "Marketing", primaryGoal: "Đo lường hiệu quả chiến dịch, chuyển đổi và tăng trưởng kênh.", targetAudience: "Marketing manager và đội ngũ tăng trưởng", primaryColor: "#7c3aed", secondaryColor: "#f97316" },
  { id: "it", name: "IT", description: "Chất lượng hệ thống & dịch vụ số", domain: "IT", primaryGoal: "Theo dõi chất lượng hệ thống, vận hành dịch vụ và ưu tiên cải tiến.", targetAudience: "CTO, product manager và đội ngũ kỹ thuật", primaryColor: "#2563eb", secondaryColor: "#06b6d4" },
  { id: "education", name: "Education", description: "Kết quả học tập & hiệu quả đào tạo", domain: "Education", primaryGoal: "Theo dõi kết quả học tập, mức độ tham gia và hiệu quả chương trình.", targetAudience: "Ban giám hiệu, quản lý đào tạo và giảng viên", primaryColor: "#d97706", secondaryColor: "#0f766e" },
] as const;

type WorkspaceTemplate = (typeof workspaceTemplates)[number];

function getTemplateDraft(template: WorkspaceTemplate) {
  return { domain: template.domain, primaryGoal: template.primaryGoal, targetAudience: template.targetAudience, primaryColor: template.primaryColor, secondaryColor: template.secondaryColor };
}

export default function WorkspacesPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { me, workspaceId, switchWorkspace } = useAuth();
  const [name, setName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplate>(workspaceTemplates[0]);
  const [domain, setDomain] = useState<string>(workspaceTemplates[0].domain);
  const [primaryGoal, setPrimaryGoal] = useState<string>(workspaceTemplates[0].primaryGoal);
  const [targetAudience, setTargetAudience] = useState<string>(workspaceTemplates[0].targetAudience);
  const [primaryColor, setPrimaryColor] = useState<string>(workspaceTemplates[0].primaryColor);
  const [secondaryColor, setSecondaryColor] = useState<string>(workspaceTemplates[0].secondaryColor);
  const [isCreateExpanded, setIsCreateExpanded] = useState(false);
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
      setIsCreateExpanded(false);
      const defaultDraft = getTemplateDraft(workspaceTemplates[0]);
      setSelectedTemplate(workspaceTemplates[0]);
      setDomain(defaultDraft.domain);
      setPrimaryGoal(defaultDraft.primaryGoal);
      setTargetAudience(defaultDraft.targetAudience);
      setPrimaryColor(defaultDraft.primaryColor);
      setSecondaryColor(defaultDraft.secondaryColor);
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
    if (trimmed.length >= 2) creation.mutate({
      name: trimmed,
      context: { domain, primary_goal: primaryGoal, target_audience: targetAudience },
      theme: { primary_color: primaryColor, secondary_color: secondaryColor, tone: "professional", default_language: "vi" },
    });
  }

  function selectTemplate(template: WorkspaceTemplate) {
    const nextDraft = getTemplateDraft(template);
    setSelectedTemplate(template);
    setDomain(nextDraft.domain);
    setPrimaryGoal(nextDraft.primaryGoal);
    setTargetAudience(nextDraft.targetAudience);
    setPrimaryColor(nextDraft.primaryColor);
    setSecondaryColor(nextDraft.secondaryColor);
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

    {canCreate && (
      <section className="panel workspace-create-panel" style={isCreateExpanded ? { position: "relative" } : { padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexDirection: "row" }} onClick={() => !isCreateExpanded && setIsCreateExpanded(true)}>
        {!isCreateExpanded ? (
          <>
            <div>
              <h2 style={{ fontSize: "1.2rem", margin: 0, fontWeight: 700 }}>Tạo workspace mới</h2>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.95rem" }}>Thiết lập không gian làm việc mới cho dự án của bạn.</p>
            </div>
            <button className="button primary" onClick={(e) => { e.stopPropagation(); setIsCreateExpanded(true); }}>
              <span aria-hidden="true" style={{ marginRight: 6 }}>+</span> Tạo mới
            </button>
          </>
        ) : (
          <>
            <button className="button secondary" type="button" onClick={(e) => { e.stopPropagation(); setIsCreateExpanded(false); }} style={{ position: "absolute", top: "24px", right: "24px", padding: "6px 16px", borderRadius: "20px", zIndex: 10 }}>Đóng</button>
            <div className="workspace-create-intro" style={{ display: 'flex', flexDirection: 'column', gap: '32px', height: '100%' }}>
              <div>
                <p className="eyebrow">NEW WORKSPACE</p><h2>Tạo workspace mới</h2><p className="muted">Chọn một chủ đề để thiết lập sẵn context và màu sắc phù hợp. Bạn vẫn có thể chỉnh chi tiết ngay bên dưới hoặc trong Cài đặt sau này.</p>
              </div>
              <div className="workspace-create-gallery" aria-label="Minh họa tạo workspace">
                <Image src="/img/create_new_workspace_1.jpg" alt="Minh họa không gian workspace" width={1200} height={900} sizes="(max-width: 768px) 100vw, 50vw" />
                <Image src="/img/create_new_workspace_2.jpg" alt="Minh họa cấu hình workspace" width={3000} height={3000} sizes="(max-width: 768px) 100vw, 50vw" />
              </div>
            </div>
            <form className="workspace-create-form workspace-template-form" onSubmit={submitCreate}>
              <label className="workspace-name-field" htmlFor="workspace-name">Tên workspace<input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Phân tích khách hàng" maxLength={255} autoFocus /></label>
              <fieldset className="workspace-template-picker"><legend>Chọn chủ đề phù hợp</legend><div className="workspace-template-grid">{workspaceTemplates.map((template) => {
                const selected = template.id === selectedTemplate.id;
                return <button className={selected ? "workspace-template selected" : "workspace-template"} key={template.id} type="button" aria-pressed={selected} onClick={() => selectTemplate(template)}>
                  <span className="workspace-template-swatch" style={{ "--template-primary": template.primaryColor, "--template-secondary": template.secondaryColor } as CSSProperties} aria-hidden="true" />
                  <span><strong>{template.name}</strong><small>{template.description}</small></span>
                </button>;
              })}</div></fieldset>
              <div className="workspace-config-fields">
                <div className="workspace-config-heading"><b>Context sẵn sàng cho {selectedTemplate.name}</b><span>Đã điền từ preset, có thể chỉnh sửa.</span></div>
                <label>Lĩnh vực<input value={domain} onChange={(event) => setDomain(event.target.value)} maxLength={120} /></label>
                <label>Mục tiêu chính<input value={primaryGoal} onChange={(event) => setPrimaryGoal(event.target.value)} maxLength={500} /></label>
                <label>Đối tượng đọc<input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} maxLength={120} /></label>
                <div className="workspace-color-fields"><label>Màu chính<input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /></label><label>Màu phụ<input type="color" value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value)} /></label></div>
              </div>
              <div className="workspace-create-actions"><span>Context và theme sẽ được lưu cùng workspace.</span><button className="button primary" type="submit" disabled={creation.isPending || name.trim().length < 2}>{creation.isPending ? "Đang tạo…" : "Tạo workspace"}</button></div>
            </form>
          </>
        )}
      </section>
    )}

    {!workspaces.isPending && !workspaces.isError && <section className="workspace-grid" aria-label="Danh sách workspace">{items.map((workspace) => {
      const current = workspace.id === workspaceId;
      const removable = canDelete && workspace.is_project && workspace.created_by_user_id === me?.user.id;
      return <article className={current ? "workspace-card current" : "workspace-card"} key={workspace.id}>
        <div className="workspace-card-top"><span className="workspace-card-icon" aria-hidden="true">▦</span><span className="workspace-role">{roleLabel}</span></div>
        <h2>{workspace.name}</h2>
        <p className="workspace-card-capabilities">{roleDescription}</p>
        <p className="workspace-card-slug">/{workspace.slug}</p>
        <div className="workspace-card-actions"><button className="button primary" type="button" onClick={() => void openWorkspace(workspace.id)} disabled={workspaceActionBusy}>{current ? "Đang mở" : "Mở workspace"}</button>{removable && <><button className="button workspace-archive" type="button" onClick={() => removeWorkspace(workspace)} disabled={workspaceActionBusy}>{deletion.isPending && deletion.variables === workspace.id ? "Đang lưu trữ…" : "Lưu trữ"}</button><button className="button danger workspace-permanent-delete" type="button" onClick={() => permanentlyDeleteWorkspace(workspace)} disabled={workspaceActionBusy}>{purging.isPending && purging.variables === workspace.id ? "Đang xóa…" : "Xóa workspace"}</button></>}</div>
      </article>;
    })}</section>}

    {canDelete && !archivedWorkspaces.isPending && archivedItems.length > 0 && <section className="workspace-archive-library" aria-labelledby="archived-workspaces-title">
      <div className="workspace-archive-heading"><div><p className="eyebrow">KHO LƯU TRỮ</p><h2 id="archived-workspaces-title">Workspace đã lưu trữ</h2><p className="muted">Dữ liệu vẫn được giữ nguyên. Chủ workspace có thể khôi phục khi cần.</p></div><span className="workspace-count">{archivedItems.length} mục</span></div>
      <div className="workspace-grid">{archivedItems.map((workspace) => <article className="workspace-card archived" key={workspace.id}>
        <div className="workspace-card-top"><span className="workspace-card-icon" aria-hidden="true">□</span><span className="workspace-role">Đã lưu trữ</span></div>
        <h2>{workspace.name}</h2><p className="workspace-card-capabilities">Workspace tạm ngừng hoạt động; dataset và báo cáo chưa bị xóa.</p><p className="workspace-card-slug">/{workspace.slug}</p>
        <div className="workspace-card-actions"><button className="button secondary" type="button" onClick={() => restoreArchivedWorkspace(workspace)} disabled={workspaceActionBusy}>{restoration.isPending && restoration.variables === workspace.id ? "Đang khôi phục…" : "Khôi phục"}</button><button className="button danger" type="button" onClick={() => permanentlyDeleteWorkspace(workspace)} disabled={workspaceActionBusy}>{purging.isPending && purging.variables === workspace.id ? "Đang xóa…" : "Xóa vĩnh viễn"}</button></div>
      </article>)}</div>
    </section>}

    {!workspaces.isPending && !workspaces.isError && items.length === 0 && <section className="empty-state"><span aria-hidden="true">✦</span><h2>Chưa có workspace</h2><p>Hãy tạo workspace để bắt đầu upload dataset và làm việc với Agent.</p></section>}
    {can(me?.effective_permissions, PERMISSIONS.datasetRead) && <p className="workspace-page-note"><Link href="/datasets">Mở bộ dữ liệu</Link> để upload dataset trong workspace đang chọn.</p>}
  </main>;
}
