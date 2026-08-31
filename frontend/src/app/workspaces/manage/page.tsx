"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { ErrorNotice, LoadingBlock, Notice, PageHeader, useToast } from "@/components/ui";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { cancelWorkspaceInvitation, inviteWorkspaceMember, listWorkspaceInvitations, listWorkspaceMembers, updateWorkspaceMember, type WorkspaceMemberStatus } from "@/lib/api";
import { formatDate } from "@/lib/format";

const statusLabels: Record<WorkspaceMemberStatus, string> = { active: "Đang hoạt động", suspended: "Tạm ngưng", removed: "Đã gỡ" };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function memberInitials(nameOrEmail: string | null | undefined) {
  const value = (nameOrEmail || "AN").split("@")[0].replace(/[^\p{L}\p{N}]/gu, "");
  return value.slice(0, 2).toUpperCase() || "AN";
}

export default function WorkspaceManagePage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const allowed = can(me?.effective_permissions, PERMISSIONS.workspaceMembersManage);
  const [email, setEmail] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(() => new Set());
  const [pendingInvitationIds, setPendingInvitationIds] = useState<Set<string>>(() => new Set());
  const inviteDialogRef = useRef<HTMLDialogElement>(null);
  const inviteEmailRef = useRef<HTMLInputElement>(null);
  const activeMemberUpdates = useRef(new Set<string>());
  const activeInvitationCancellations = useRef(new Set<string>());
  const workspaceId = me?.workspace?.id;
  const workspaceIdRef = useRef(workspaceId);
  const membersKey = ["workspace-members", workspaceId] as const;
  const invitationsKey = ["workspace-invitations", workspaceId] as const;
  const members = useQuery({ queryKey: membersKey, queryFn: listWorkspaceMembers, enabled: allowed });
  const invitations = useQuery({ queryKey: invitationsKey, queryFn: listWorkspaceInvitations, enabled: allowed });

  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: membersKey }), client.invalidateQueries({ queryKey: invitationsKey }), client.invalidateQueries({ queryKey: ["session"] })]);
  };

  useEffect(() => {
    const previousWorkspaceId = workspaceIdRef.current;
    workspaceIdRef.current = workspaceId;
    if (previousWorkspaceId !== undefined && previousWorkspaceId !== workspaceId) {
      setInviteOpen(false);
      setEmail("");
      setInviteError(null);
      activeInvitationCancellations.current.clear();
      setPendingInvitationIds(new Set());
    }
  }, [workspaceId]);

  useEffect(() => {
    const dialog = inviteDialogRef.current;
    if (!inviteOpen || !dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
    const focusTimer = window.setTimeout(() => inviteEmailRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, [inviteOpen]);

  const memberUpdate = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: WorkspaceMemberStatus }) => updateWorkspaceMember(userId, { status }),
    onMutate: async ({ userId, status }) => {
      await client.cancelQueries({ queryKey: membersKey });
      const previous = client.getQueryData<{ members: Array<{ user_id: string; status: WorkspaceMemberStatus }> }>(membersKey);
      const previousStatus = previous?.members.find((member) => member.user_id === userId)?.status;
      setPendingMemberIds((current) => new Set(current).add(userId));
      client.setQueryData<{ members: Array<{ user_id: string; status: WorkspaceMemberStatus }> }>(membersKey, (old) => old ? { ...old, members: old.members.map((member) => member.user_id === userId ? { ...member, status } : member) } : old);
      return { previousStatus };
    },
    onError: (_error, variables, context) => {
      const previousStatus = context?.previousStatus;
      if (previousStatus === undefined) return;
      client.setQueryData<{ members: Array<{ user_id: string; status: WorkspaceMemberStatus }> }>(membersKey, (old) => old ? { ...old, members: old.members.map((member) => member.user_id === variables.userId ? { ...member, status: previousStatus } : member) } : old);
    },
    onSettled: async (_data, _error, variables) => {
      activeMemberUpdates.current.delete(variables.userId);
      setPendingMemberIds((current) => { const next = new Set(current); next.delete(variables.userId); return next; });
      await refresh();
    },
  });

  const invitation = useMutation({
    mutationFn: ({ email: nextEmail, workspaceId: requestWorkspaceId }: { email: string; workspaceId: string | undefined }) => {
      if (workspaceIdRef.current !== requestWorkspaceId) throw new Error("Workspace changed. Please try again.");
      return inviteWorkspaceMember({ email: nextEmail, role: "analyst" });
    },
    onSuccess: async (_data, variables) => {
      if (workspaceIdRef.current !== variables.workspaceId) return;
      setEmail(""); setInviteError(null); setInviteOpen(false);
      await refresh();
      toast.success("Invitation sent.");
    },
    onError: (error, variables) => {
      if (workspaceIdRef.current === variables.workspaceId) setInviteError(error instanceof Error ? error.message : "Unable to send the invitation.");
    },
  });

  const cancellation = useMutation({
    mutationFn: ({ invitationId, workspaceId: requestWorkspaceId }: { invitationId: string; workspaceId: string | undefined }) => {
      if (workspaceIdRef.current !== requestWorkspaceId) throw new Error("Workspace changed. Please try again.");
      return cancelWorkspaceInvitation(invitationId);
    },
    onMutate: async ({ invitationId }) => {
      await client.cancelQueries({ queryKey: invitationsKey });
      const previous = client.getQueryData<{ invitations: Array<{ id: string }> }>(invitationsKey);
      const previousIndex = previous?.invitations.findIndex((item) => item.id === invitationId) ?? -1;
      const previousInvitation = previousIndex >= 0 ? previous?.invitations[previousIndex] : undefined;
      setPendingInvitationIds((current) => new Set(current).add(invitationId));
      client.setQueryData<{ invitations: Array<{ id: string }> }>(invitationsKey, (old) => old ? { ...old, invitations: old.invitations.filter((item) => item.id !== invitationId) } : old);
      return { previousInvitation, previousIndex };
    },
    onSuccess: (_data, variables) => { if (workspaceIdRef.current === variables.workspaceId) toast.success("Invitation cancelled."); },
    onError: (error, variables, context) => {
      if (workspaceIdRef.current !== variables.workspaceId) return;
      const previousInvitation = context?.previousInvitation;
      if (previousInvitation) client.setQueryData<{ invitations: Array<{ id: string }> }>(invitationsKey, (old) => old ? { ...old, invitations: [...old.invitations.slice(0, context.previousIndex), previousInvitation, ...old.invitations.slice(context.previousIndex)] } : old);
      toast.error(error instanceof Error ? error.message : "Unable to cancel the invitation.");
    },
    onSettled: async (_data, _error, variables) => {
      activeInvitationCancellations.current.delete(variables.invitationId);
      setPendingInvitationIds((current) => { const next = new Set(current); next.delete(variables.invitationId); return next; });
      if (workspaceIdRef.current === variables.workspaceId) await refresh();
    },
  });

  if (!me || !allowed) return <main className="page"><Notice tone="warning"><b>Không có quyền truy cập.</b><p>Chỉ thành viên Analyst đang hoạt động mới có thể quản lý workspace hiện tại.</p></Notice></main>;

  function openInviteDialog() { invitation.reset(); setInviteError(null); setInviteOpen(true); }
  function closeInviteDialog() { if (!invitation.isPending) { setInviteError(null); setInviteOpen(false); } }
  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) return setInviteError("Email is required.");
    if (!emailPattern.test(nextEmail)) return setInviteError("Enter a valid email address.");
    if (invitation.isPending) return;
    setInviteError(null); invitation.mutate({ email: nextEmail, workspaceId });
  }
  function changeMemberStatus(userId: string, status: WorkspaceMemberStatus) {
    if (activeMemberUpdates.current.has(userId)) return;
    activeMemberUpdates.current.add(userId); memberUpdate.mutate({ userId, status });
  }
  function cancelInvitation(invitationId: string) {
    if (activeInvitationCancellations.current.has(invitationId)) return;
    activeInvitationCancellations.current.add(invitationId); cancellation.mutate({ invitationId, workspaceId });
  }

  const pendingInvitations = invitations.data?.invitations.filter((item) => item.status === "pending") ?? [];
  const workspaceName = me.workspaces.find((item) => item.id === me.workspace?.id)?.name ?? "workspace hiện tại";
  return <main className="page workspace-manage-page">
    <PageHeader eyebrow="WORKSPACE SETTINGS" title="Quản lý workspace" description={`Quản lý thành viên và lời mời trong “${workspaceName}”. Tất cả thành viên dùng role Analyst.`} action={<Link className="button secondary" href="/workspaces">← Danh sách workspace</Link>} />
    <section className="panel workspace-members-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">MEMBERS &amp; INVITATIONS</p><h2>Thành viên</h2><p className="muted">Mọi lời mời workspace chỉ cấp quyền Analyst.</p></div><button className="button primary" type="button" onClick={openInviteDialog}>Invite member</button></div>
      <h3 className="workspace-subsection-title">Active members</h3>
      {members.isPending && <LoadingBlock label="Đang tải thành viên…" />}
      {members.isError && <ErrorNotice error={members.error} retry={() => void members.refetch()} />}
      {memberUpdate.isError && <ErrorNotice error={memberUpdate.error} retry={() => memberUpdate.reset()} />}
      {!members.isPending && !members.isError && (members.data?.members.length ? <div className="workspace-table-wrap"><table className="workspace-member-table"><thead><tr><th>Thành viên</th><th>Role</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody>{members.data.members.map((member) => <tr key={member.user_id} aria-busy={pendingMemberIds.has(member.user_id) || undefined}><td><span className="workspace-member-identity"><span className="workspace-member-avatar" aria-hidden="true">{memberInitials(member.display_name || member.email)}</span><span><b>{member.display_name || member.email || "Tài khoản chưa đồng bộ email"}</b>{member.display_name && member.email && <small>{member.email}</small>}<code>{member.user_id}</code>{member.user_id === me.user.id && <small className="workspace-self-label">Bạn</small>}</span></span></td><td><span className="workspace-role">Analyst</span></td><td><select aria-label={`Trạng thái của ${member.email ?? member.user_id}`} value={member.status} onChange={(event) => changeMemberStatus(member.user_id, event.target.value as WorkspaceMemberStatus)} disabled={pendingMemberIds.has(member.user_id)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{pendingMemberIds.has(member.user_id) && <small className="muted">Đang cập nhật…</small>}</td><td>{formatDate(member.updated_at)}</td></tr>)}</tbody></table></div> : <p className="workspace-empty-copy">Không có thành viên nào khác.</p>)}
      <div className="workspace-invitations-section"><h3 className="workspace-subsection-title">Pending invitations</h3>{invitations.isPending && <LoadingBlock label="Đang tải lời mời…" />}{invitations.isError && <ErrorNotice error={invitations.error} retry={() => void invitations.refetch()} />}{!invitations.isPending && !invitations.isError && (pendingInvitations.length ? <div className="workspace-table-wrap"><table className="workspace-member-table workspace-invitation-table"><thead><tr><th>Email</th><th>Sent</th><th>Status</th><th>Actions</th></tr></thead><tbody>{pendingInvitations.map((item) => <tr key={item.id} aria-busy={pendingInvitationIds.has(item.id) || undefined}><td><b>{item.email}</b><small>Analyst · expires {formatDate(item.expires_at)}</small></td><td>{formatDate(item.created_at)}</td><td><span className="workspace-role">Pending</span></td><td><button className="button danger" type="button" onClick={() => cancelInvitation(item.id)} disabled={pendingInvitationIds.has(item.id)}>{pendingInvitationIds.has(item.id) ? "Cancelling…" : "Cancel"}</button></td></tr>)}</tbody></table></div> : <p className="workspace-empty-copy">No pending invitations.</p>)}</div>
    </section>
    {inviteOpen && <dialog ref={inviteDialogRef} className="confirm-dialog workspace-invite-dialog" aria-modal="true" aria-labelledby="invite-member-title" aria-describedby="invite-member-description" onCancel={(event) => { event.preventDefault(); closeInviteDialog(); }} onClick={(event) => { if (event.target === event.currentTarget) closeInviteDialog(); }}><form noValidate onSubmit={submitInvite}><div className="confirm-dialog-header"><span className="confirm-dialog-icon" aria-hidden="true">+</span><div><p className="eyebrow">MEMBERS</p><h2 id="invite-member-title">Invite member</h2></div></div><div className="confirm-dialog-body"><p id="invite-member-description" className="confirm-dialog-message">Invite an Analyst to this workspace.</p><label className="workspace-invite-field" htmlFor="workspace-invite-email">Email<input ref={inviteEmailRef} id="workspace-invite-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setInviteError(null); }} placeholder="name@example.com" autoComplete="email" disabled={invitation.isPending} aria-invalid={Boolean(inviteError)} aria-describedby={inviteError ? "workspace-invite-error" : undefined} /></label><p className="workspace-invite-role"><span>Role</span><strong>Analyst</strong><small>Workspace invitations currently grant Analyst only.</small></p>{inviteError && <p id="workspace-invite-error" className="workspace-invite-error" role="alert">{inviteError}</p>}</div><div className="confirm-dialog-actions"><button className="button secondary" type="button" onClick={closeInviteDialog} disabled={invitation.isPending}>Cancel</button><button className="button primary" type="submit" disabled={invitation.isPending} aria-busy={invitation.isPending || undefined}>{invitation.isPending ? "Sending…" : "Send invitation"}</button></div></form></dialog>}
  </main>;
}
