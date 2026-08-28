"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { cancelWorkspaceInvitation, inviteWorkspaceMember, listWorkspaceInvitations, listWorkspaceMembers, updateWorkspaceMember, type WorkspaceMemberStatus } from "@/lib/api";
import { formatDate } from "@/lib/format";

const statusLabels: Record<WorkspaceMemberStatus, string> = {
  active: "Đang hoạt động",
  suspended: "Tạm ngưng",
  removed: "Đã gỡ",
};

export default function WorkspaceManagePage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const allowed = can(me?.effective_permissions, PERMISSIONS.workspaceMembersManage);
  const [email, setEmail] = useState("");
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(() => new Set());
  const [pendingInvitationIds, setPendingInvitationIds] = useState<Set<string>>(() => new Set());
  const activeMemberUpdates = useRef(new Set<string>());
  const activeInvitationCancellations = useRef(new Set<string>());
  const workspaceId = me?.workspace?.id;
  const membersKey = ["workspace-members", workspaceId] as const;
  const invitationsKey = ["workspace-invitations", workspaceId] as const;
  const members = useQuery({ queryKey: membersKey, queryFn: listWorkspaceMembers, enabled: allowed });
  const invitations = useQuery({ queryKey: invitationsKey, queryFn: listWorkspaceInvitations, enabled: allowed });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: membersKey }),
      client.invalidateQueries({ queryKey: invitationsKey }),
      client.invalidateQueries({ queryKey: ["session"] }),
    ]);
  };
  const memberUpdate = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: WorkspaceMemberStatus }) => updateWorkspaceMember(userId, { status }),
    onMutate: async ({ userId, status }) => {
      await client.cancelQueries({ queryKey: membersKey });
      const previous = client.getQueryData<{ members: Array<{ user_id: string; status: WorkspaceMemberStatus }> }>(membersKey);
      const previousStatus = previous?.members.find((member) => member.user_id === userId)?.status;
      setPendingMemberIds((current) => new Set(current).add(userId));
      client.setQueryData<{ members: Array<{ user_id: string; status: WorkspaceMemberStatus }> }>(membersKey, (old) => old ? {
        ...old,
        members: old.members.map((member) => member.user_id === userId ? { ...member, status } : member),
      } : old);
      return { previousStatus };
    },
    onError: (_error, variables, context) => {
      const previousStatus = context?.previousStatus;
      if (previousStatus === undefined) return;
      client.setQueryData<{ members: Array<{ user_id: string; status: WorkspaceMemberStatus }> }>(membersKey, (old) => old ? {
        ...old,
        members: old.members.map((member) => member.user_id === variables.userId ? { ...member, status: previousStatus } : member),
      } : old);
    },
    onSettled: async (_data, _error, variables) => {
      activeMemberUpdates.current.delete(variables.userId);
      setPendingMemberIds((current) => {
        const next = new Set(current);
        next.delete(variables.userId);
        return next;
      });
      await refresh();
    },
  });
  const invitation = useMutation({
    mutationFn: (nextEmail: string) => inviteWorkspaceMember({ email: nextEmail, role: "analyst" }),
    onSuccess: async () => { setEmail(""); await refresh(); },
  });
  const cancellation = useMutation({
    mutationFn: cancelWorkspaceInvitation,
    onMutate: async (invitationId) => {
      await client.cancelQueries({ queryKey: invitationsKey });
      const previous = client.getQueryData<{ invitations: Array<{ id: string }> }>(invitationsKey);
      const previousIndex = previous?.invitations.findIndex((invitation) => invitation.id === invitationId) ?? -1;
      const previousInvitation = previousIndex >= 0 ? previous?.invitations[previousIndex] : undefined;
      setPendingInvitationIds((current) => new Set(current).add(invitationId));
      client.setQueryData<{ invitations: Array<{ id: string }> }>(invitationsKey, (old) => old ? {
        ...old,
        invitations: old.invitations.filter((invitation) => invitation.id !== invitationId),
      } : old);
      return { previousInvitation, previousIndex };
    },
    onError: (_error, _invitationId, context) => {
      const previousInvitation = context?.previousInvitation;
      if (!previousInvitation) return;
      client.setQueryData<{ invitations: Array<{ id: string }> }>(invitationsKey, (old) => old ? {
        ...old,
        invitations: [
          ...old.invitations.slice(0, context.previousIndex),
          previousInvitation,
          ...old.invitations.slice(context.previousIndex),
        ],
      } : old);
    },
    onSettled: async (_data, _error, invitationId) => {
      activeInvitationCancellations.current.delete(invitationId);
      setPendingInvitationIds((current) => {
        const next = new Set(current);
        next.delete(invitationId);
        return next;
      });
      await refresh();
    },
  });

  if (!me || !allowed) return <main className="page"><Notice tone="warning"><b>Không có quyền truy cập.</b><p>Chỉ thành viên Analyst đang hoạt động mới có thể quản lý workspace hiện tại.</p></Notice></main>;

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmail = email.trim();
    if (nextEmail) invitation.mutate(nextEmail);
  }

  function changeMemberStatus(userId: string, status: WorkspaceMemberStatus) {
    if (activeMemberUpdates.current.has(userId)) return;
    activeMemberUpdates.current.add(userId);
    memberUpdate.mutate({ userId, status });
  }

  function cancelInvitation(invitationId: string) {
    if (activeInvitationCancellations.current.has(invitationId)) return;
    activeInvitationCancellations.current.add(invitationId);
    cancellation.mutate(invitationId);
  }

  return <main className="page workspace-manage-page">
    <PageHeader eyebrow="WORKSPACE SETTINGS" title="Quản lý workspace" description={`Quản lý thành viên và lời mời trong “${me.workspaces.find((item) => item.id === me.workspace?.id)?.name ?? "workspace hiện tại"}”. Tất cả thành viên dùng role Analyst.`} action={<Link className="button secondary" href="/workspaces">← Danh sách workspace</Link>} />
    <section className="panel workspace-members-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">MEMBERS</p><h2>Thành viên workspace</h2><p className="muted">Mỗi thành viên có cùng quyền Analyst; bạn chỉ cần quản lý trạng thái hoạt động.</p></div><span className="workspace-count">{members.data?.members.length ?? 0} thành viên</span></div>
      {members.isPending && <LoadingBlock label="Đang tải thành viên…" />}
      {members.isError && <ErrorNotice error={members.error} retry={() => members.refetch()} />}
      {memberUpdate.isError && <ErrorNotice error={memberUpdate.error} retry={() => memberUpdate.reset()} />}
      {!members.isPending && !members.isError && <div className="workspace-table-wrap"><table className="workspace-member-table"><thead><tr><th>Tài khoản</th><th>Role</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody>{members.data?.members.map((member) => <tr key={member.user_id} aria-busy={pendingMemberIds.has(member.user_id) || undefined}><td><b>{member.email ?? "Tài khoản chưa đồng bộ email"}</b><code>{member.user_id}</code>{member.user_id === me.user.id && <small className="workspace-self-label">Bạn</small>}</td><td><span className="workspace-role">Analyst</span></td><td><select aria-label={`Trạng thái của ${member.user_id}`} value={member.status} onChange={(event) => changeMemberStatus(member.user_id, event.target.value as WorkspaceMemberStatus)} disabled={pendingMemberIds.has(member.user_id)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{pendingMemberIds.has(member.user_id) && <small className="muted">Đang cập nhật…</small>}</td><td>{formatDate(member.updated_at)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel workspace-invitations-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">INVITATIONS</p><h2>Mời Analyst vào workspace</h2><p className="muted">Lời mời mới luôn được tạo với role Analyst.</p></div></div>
      <form className="workspace-create-form" onSubmit={submitInvite}><label htmlFor="workspace-invite-email">Email<input id="workspace-invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="analyst@company.com" required /></label><button className="button primary" type="submit" disabled={invitation.isPending}>{invitation.isPending ? "Đang gửi…" : "Gửi lời mời"}</button></form>
      {invitation.isError && <ErrorNotice error={invitation.error} retry={() => invitation.reset()} />}
      {invitations.isPending && <LoadingBlock label="Đang tải lời mời…" />}
      {invitations.isError && <ErrorNotice error={invitations.error} retry={() => invitations.refetch()} />}
      {!invitations.isPending && !invitations.isError && <div className="workspace-invitation-list">{invitations.data?.invitations.filter((item) => item.status === "pending").map((item) => <div className="workspace-invitation-row" key={item.id} aria-busy={pendingInvitationIds.has(item.id) || undefined}><div><b>{item.email}</b><small>Analyst · hết hạn {formatDate(item.expires_at)}</small></div><button className="button danger" type="button" onClick={() => cancelInvitation(item.id)} disabled={pendingInvitationIds.has(item.id)}>Hủy lời mời</button></div>)}</div>}
    </section>
  </main>;
}
