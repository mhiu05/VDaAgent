"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock, LoadingButton, useToast } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { createWorkspace, deleteWorkspace, listArchivedWorkspaces, listWorkspaces, purgeWorkspace, restoreWorkspace, type WorkspaceSummary } from "@/lib/api";
import { useState, type CSSProperties, type FormEvent } from "react";

const roleLabel = "Analyst";
const roleDescription = "Tải dữ liệu, lập hồ sơ, trợ lý AI, xem xét và tạo báo cáo";

const workspaceTemplates = [
  { id: "business", name: "Business", description: "Hiệu quả kinh doanh & vận hành", domain: "Business", primaryGoal: "Theo dõi hiệu quả kinh doanh, doanh thu và cơ hội tăng trưởng.", targetAudience: "Ban điều hành và quản lý vận hành", primaryColor: "#315efb", secondaryColor: "#18a77b" },
  { id: "marketing", name: "Marketing", description: "Chiến dịch, chuyển đổi & tăng trưởng kênh", domain: "Marketing", primaryGoal: "Đo lường hiệu quả chiến dịch, chuyển đổi và tăng trưởng kênh.", targetAudience: "Marketing manager và đội ngũ tăng trưởng", primaryColor: "#7c3aed", secondaryColor: "#f97316" },
  { id: "it", name: "IT", description: "Chất lượng hệ thống & dịch vụ số", domain: "IT", primaryGoal: "Theo dõi chất lượng hệ thống, vận hành dịch vụ và ưu tiên cải tiến.", targetAudience: "CTO, product manager và đội ngũ kỹ thuật", primaryColor: "#2563eb", secondaryColor: "#06b6d4" },
  { id: "education", name: "Education", description: "Kết quả học tập & hiệu quả đào tạo", domain: "Education", primaryGoal: "Theo dõi kết quả học tập, mức độ tham gia và hiệu quả chương trình.", targetAudience: "Ban giám hiệu, quản lý đào tạo và giảng viên", primaryColor: "#d97706", secondaryColor: "#0f766e" },
] as const;

type WorkspaceTemplate = (typeof workspaceTemplates)[number];
type WorkspaceConfirmation = { workspace: WorkspaceSummary; action: "archive" | "delete" };

function getTemplateDraft(template: WorkspaceTemplate) {
  return { domain: template.domain, primaryGoal: template.primaryGoal, targetAudience: template.targetAudience, primaryColor: template.primaryColor, secondaryColor: template.secondaryColor };
}

export default function WorkspacesPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { me, workspaceId, switchWorkspace, forgetWorkspace } = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplate>(workspaceTemplates[0]);
  const [domain, setDomain] = useState<string>(workspaceTemplates[0].domain);
  const [primaryGoal, setPrimaryGoal] = useState<string>(workspaceTemplates[0].primaryGoal);
  const [targetAudience, setTargetAudience] = useState<string>(workspaceTemplates[0].targetAudience);
  const [primaryColor, setPrimaryColor] = useState<string>(workspaceTemplates[0].primaryColor);
  const [secondaryColor, setSecondaryColor] = useState<string>(workspaceTemplates[0].secondaryColor);
  const [isCreateExpanded, setIsCreateExpanded] = useState(false);
  const [isPreparingCreate, setIsPreparingCreate] = useState(false);
  const [confirmationTarget, setConfirmationTarget] = useState<WorkspaceConfirmation | null>(null);
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
      toast.success(`Đã tạo workspace “${workspace.name}”.`);
      await switchWorkspace(workspace.id);
      router.push("/datasets");
    },
  });
  const deletion = useMutation({
    mutationFn: deleteWorkspace,
    onMutate: async (id: string) => {
      await client.cancelQueries({ queryKey: ["workspaces"] });
      const previousData = client.getQueryData<{ workspaces: WorkspaceSummary[] }>(["workspaces"]);
      if (previousData) {
        client.setQueryData(["workspaces"], {
          ...previousData,
          workspaces: previousData.workspaces.filter((w) => w.id !== id),
        });
      }
      return { previousData };
    },
    onError: (err, id, context) => {
      if (context?.previousData) client.setQueryData(["workspaces"], context.previousData);
      toast.error("Không thể lưu trữ workspace.");
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: ["workspaces"] });
      client.invalidateQueries({ queryKey: ["archived-workspaces"] });
    },
    onSuccess: (_result, id) => {
      forgetWorkspace(id);
      toast.success("Workspace đã được lưu trữ.");
    },
  });
  const purging = useMutation({
    mutationFn: purgeWorkspace,
    onMutate: async (id: string) => {
      await client.cancelQueries({ queryKey: ["archived-workspaces"] });
      const previousData = client.getQueryData<{ workspaces: WorkspaceSummary[] }>(["archived-workspaces"]);
      if (previousData) {
        client.setQueryData(["archived-workspaces"], {
          ...previousData,
          workspaces: previousData.workspaces.filter((w) => w.id !== id),
        });
      }
      return { previousData };
    },
    onError: (err, id, context) => {
      if (context?.previousData) client.setQueryData(["archived-workspaces"], context.previousData);
      toast.error("Không thể xóa vĩnh viễn workspace.");
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: ["workspaces"] });
      client.invalidateQueries({ queryKey: ["archived-workspaces"] });
    },
    onSuccess: (_result, id) => {
      forgetWorkspace(id);
      toast.success("Workspace đã được xóa vĩnh viễn.");
    },
  });
  const restoration = useMutation({
    mutationFn: restoreWorkspace,
    onMutate: async (id: string) => {
      await client.cancelQueries({ queryKey: ["archived-workspaces"] });
      const previousData = client.getQueryData<{ workspaces: WorkspaceSummary[] }>(["archived-workspaces"]);
      if (previousData) {
        client.setQueryData(["archived-workspaces"], {
          ...previousData,
          workspaces: previousData.workspaces.filter((w) => w.id !== id),
        });
      }
      return { previousData };
    },
    onError: (err, id, context) => {
      if (context?.previousData) client.setQueryData(["archived-workspaces"], context.previousData);
      toast.error("Không thể khôi phục workspace.");
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: ["workspaces"] });
      client.invalidateQueries({ queryKey: ["archived-workspaces"] });
    },
    onSuccess: () => {
      toast.success("Workspace đã được khôi phục.");
    },
  });

  const canCreate = can(me?.effective_permissions, PERMISSIONS.workspaceCreate);
  const canDelete = can(me?.effective_permissions, PERMISSIONS.workspaceDelete);
  const workspaceActionBusy = deletion.isPending || purging.isPending || restoration.isPending;
  const items = workspaces.data?.workspaces ?? [];
  const archivedItems = archivedWorkspaces.data?.workspaces ?? [];
  const confirmationBusy = confirmationTarget?.action === "archive" ? deletion.isPending : purging.isPending;

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || isPreparingCreate || creation.isPending) return;
    setIsPreparingCreate(true);
    try {
      // The API needs an active workspace context to authorize creation. If
      // the current workspace was just deleted, select one of the remaining
      // workspaces before sending the create request.
      if (!workspaceId) {
        const fallback = me?.workspaces[0];
        if (!fallback) {
          toast.error("Hãy chọn một workspace trước khi tạo workspace mới.");
          return;
        }
        await switchWorkspace(fallback.id);
      }
      creation.mutate({
        name: trimmed,
        context: { domain, primary_goal: primaryGoal, target_audience: targetAudience },
        theme: { primary_color: primaryColor, secondary_color: secondaryColor, tone: "professional", default_language: "vi" },
      });
    } finally {
      setIsPreparingCreate(false);
    }
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
    setConfirmationTarget({ workspace, action: "archive" });
  }

  function permanentlyDeleteWorkspace(workspace: WorkspaceSummary) {
    if (workspace.id === workspaceId && items.length < 2) {
      window.alert("Hãy tạo hoặc mở một workspace khác trước khi xóa workspace hiện tại.");
      return;
    }
    setConfirmationTarget({ workspace, action: "delete" });
  }

  function confirmWorkspaceAction() {
    if (!confirmationTarget) return;
    const { workspace, action } = confirmationTarget;
    const mutation = action === "archive" ? deletion : purging;
    mutation.mutate(workspace.id, {
      onSuccess: () => setConfirmationTarget(null),
    });
  }

  function restoreArchivedWorkspace(workspace: WorkspaceSummary) {
    restoration.mutate(workspace.id);
  }

  async function openWorkspace(id: string) {
    if (id !== workspaceId) await switchWorkspace(id);
    router.push("/datasets");
  }

  return <main className="page workspace-page">
    <header className="workspace-page-header">
      <div><p className="eyebrow">TRUNG TÂM KHÔNG GIAN LÀM VIỆC</p><h1>Quản lý không gian làm việc</h1><p className="page-description">Mỗi không gian làm việc là nơi chứa bộ dữ liệu, hồ sơ, báo cáo và kết quả làm việc của chuyên viên phân tích.</p></div>
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
              <div className="workspace-create-actions"><span>Context và theme sẽ được lưu cùng workspace.</span><LoadingButton className="button primary" type="submit" busy={creation.isPending || isPreparingCreate} disabled={name.trim().length < 2 || isPreparingCreate}>{isPreparingCreate ? "Đang chuẩn bị…" : creation.isPending ? "Đang tạo…" : "Tạo workspace"}</LoadingButton></div>
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
        <div className="workspace-card-actions"><LoadingButton className="button primary" type="button" onClick={() => void openWorkspace(workspace.id)} busy={current && workspaceActionBusy} disabled={workspaceActionBusy}>{current ? "Đang mở" : "Mở workspace"}</LoadingButton>{removable && <><LoadingButton className="button workspace-archive" type="button" onClick={() => removeWorkspace(workspace)} busy={deletion.isPending && deletion.variables === workspace.id} disabled={workspaceActionBusy}>{deletion.isPending && deletion.variables === workspace.id ? "Đang lưu trữ…" : "Lưu trữ"}</LoadingButton><LoadingButton className="button danger workspace-permanent-delete" type="button" onClick={() => permanentlyDeleteWorkspace(workspace)} busy={purging.isPending && purging.variables === workspace.id} disabled={workspaceActionBusy}>{purging.isPending && purging.variables === workspace.id ? "Đang xóa…" : "Xóa workspace"}</LoadingButton></>}</div>
      </article>;
    })}</section>}

    {canDelete && !archivedWorkspaces.isPending && archivedItems.length > 0 && <section className="workspace-archive-library" aria-labelledby="archived-workspaces-title">
      <div className="workspace-archive-heading"><div><p className="eyebrow">KHO LƯU TRỮ</p><h2 id="archived-workspaces-title">Workspace đã lưu trữ</h2><p className="muted">Dữ liệu vẫn được giữ nguyên. Chủ workspace có thể khôi phục khi cần.</p></div><span className="workspace-count">{archivedItems.length} mục</span></div>
      <div className="workspace-grid">{archivedItems.map((workspace) => <article className="workspace-card archived" key={workspace.id}>
        <div className="workspace-card-top"><span className="workspace-card-icon" aria-hidden="true">□</span><span className="workspace-role">Đã lưu trữ</span></div>
        <h2>{workspace.name}</h2><p className="workspace-card-capabilities">Workspace tạm ngừng hoạt động; dataset và báo cáo chưa bị xóa.</p><p className="workspace-card-slug">/{workspace.slug}</p>
        <div className="workspace-card-actions"><LoadingButton className="button secondary" type="button" onClick={() => restoreArchivedWorkspace(workspace)} busy={restoration.isPending && restoration.variables === workspace.id} disabled={workspaceActionBusy}>{restoration.isPending && restoration.variables === workspace.id ? "Đang khôi phục…" : "Khôi phục"}</LoadingButton><LoadingButton className="button danger" type="button" onClick={() => permanentlyDeleteWorkspace(workspace)} busy={purging.isPending && purging.variables === workspace.id} disabled={workspaceActionBusy}>{purging.isPending && purging.variables === workspace.id ? "Đang xóa…" : "Xóa vĩnh viễn"}</LoadingButton></div>
      </article>)}</div>
    </section>}

    {!workspaces.isPending && !workspaces.isError && items.length === 0 && <section className="empty-state"><span aria-hidden="true">✦</span><h2>Chưa có không gian làm việc</h2><p>Hãy tạo không gian làm việc để bắt đầu tải bộ dữ liệu và làm việc với trợ lý AI.</p></section>}
    {can(me?.effective_permissions, PERMISSIONS.datasetRead) && <p className="workspace-page-note"><Link href="/datasets">Mở bộ dữ liệu</Link> để tải dữ liệu vào không gian làm việc đang chọn.</p>}

    {confirmationTarget && <div className="workspace-confirmation-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !confirmationBusy) setConfirmationTarget(null);
    }}>
      <section className="workspace-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-confirmation-title" aria-describedby="workspace-confirmation-description">
        <p className="eyebrow">{confirmationTarget.action === "archive" ? "XÁC NHẬN LƯU TRỮ" : "XÁC NHẬN XÓA"}</p>
        <h2 id="workspace-confirmation-title">{confirmationTarget.action === "archive" ? "Bạn có muốn lưu trữ workspace này?" : "Bạn có muốn xóa workspace này?"}</h2>
        <p id="workspace-confirmation-description">{confirmationTarget.action === "archive" ? `Workspace “${confirmationTarget.workspace.name}” sẽ được ẩn khỏi danh sách hoạt động nhưng toàn bộ dữ liệu vẫn được giữ lại.` : `Workspace “${confirmationTarget.workspace.name}” và toàn bộ dataset, profile, report và file đã upload sẽ bị xóa vĩnh viễn.`}</p>
        <div className="workspace-confirmation-actions">
          <button className="button secondary" type="button" onClick={() => setConfirmationTarget(null)} disabled={confirmationBusy}>Hủy bỏ</button>
          <LoadingButton className={confirmationTarget.action === "archive" ? "button workspace-archive" : "button danger"} type="button" onClick={confirmWorkspaceAction} busy={confirmationBusy}>Xác nhận</LoadingButton>
        </div>
      </section>
    </div>}
  </main>;
}
