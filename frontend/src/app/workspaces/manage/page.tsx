"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
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
  const members = useQuery({ queryKey: ["workspace-members", me?.workspace?.id], queryFn: listWorkspaceMembers, enabled: allowed });
  const invitations = useQuery({ queryKey: ["workspace-invitations", me?.workspace?.id], queryFn: listWorkspaceInvitations, enabled: allowed });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["workspace-members"] }),
      client.invalidateQueries({ queryKey: ["workspace-invitations"] }),
      client.invalidateQueries({ queryKey: ["session"] }),
    ]);
  };
  const memberUpdate = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: WorkspaceMemberStatus }) => updateWorkspaceMember(userId, { status }),
    onSuccess: refresh,
  });
  const invitation = useMutation({
    mutationFn: (nextEmail: string) => inviteWorkspaceMember({ email: nextEmail, role: "analyst" }),
    onSuccess: async () => { setEmail(""); await refresh(); },
  });
  const cancellation = useMutation({ mutationFn: cancelWorkspaceInvitation, onSuccess: refresh });

  if (!me || !allowed) return <main className="page"><Notice tone="warning"><b>Không có quyền truy cập.</b><p>Chỉ thành viên chuyên viên phân tích đang hoạt động mới có thể quản lý không gian làm việc hiện tại.</p></Notice></main>;

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmail = email.trim();
    if (nextEmail) invitation.mutate(nextEmail);
  }

  return <main className="page workspace-manage-page">
    <PageHeader eyebrow="CÀI ĐẶT KHÔNG GIAN LÀM VIỆC" title="Quản lý không gian làm việc" description={`Quản lý thành viên và lời mời trong “${me.workspaces.find((item) => item.id === me.workspace?.id)?.name ?? "không gian làm việc hiện tại"}”. Tất cả thành viên dùng vai trò chuyên viên phân tích.`} action={<Link className="button secondary" href="/workspaces">← Danh sách không gian làm việc</Link>} />
    <section className="panel workspace-members-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">THÀNH VIÊN</p><h2>Thành viên không gian làm việc</h2><p className="muted">Mỗi thành viên có cùng quyền chuyên viên phân tích; bạn chỉ cần quản lý trạng thái hoạt động.</p></div><span className="workspace-count">{members.data?.members.length ?? 0} thành viên</span></div>
      {members.isPending && <LoadingBlock label="Đang tải thành viên…" />}
      {members.isError && <ErrorNotice error={members.error} retry={() => members.refetch()} />}
      {memberUpdate.isError && <ErrorNotice error={memberUpdate.error} retry={() => memberUpdate.reset()} />}
      {!members.isPending && !members.isError && <div className="workspace-table-wrap"><table className="workspace-member-table"><thead><tr><th>Tài khoản</th><th>Role</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody>{members.data?.members.map((member) => <tr key={member.user_id}><td><b>{member.email ?? "Tài khoản chưa đồng bộ email"}</b><code>{member.user_id}</code>{member.user_id === me.user.id && <small className="workspace-self-label">Bạn</small>}</td><td><span className="workspace-role">Analyst</span></td><td><select aria-label={`Trạng thái của ${member.user_id}`} value={member.status} onChange={(event) => memberUpdate.mutate({ userId: member.user_id, status: event.target.value as WorkspaceMemberStatus })} disabled={memberUpdate.isPending}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td><td>{formatDate(member.updated_at)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel workspace-invitations-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">LỜI MỜI</p><h2>Mời thành viên vào không gian làm việc</h2><p className="muted">Lời mời mới luôn được tạo với vai trò chuyên viên phân tích.</p></div></div>
      <form className="workspace-create-form" onSubmit={submitInvite}><label htmlFor="workspace-invite-email">Email<input id="workspace-invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="analyst@company.com" required /></label><button className="button primary" type="submit" disabled={invitation.isPending}>{invitation.isPending ? "Đang gửi…" : "Gửi lời mời"}</button></form>
      {invitation.isError && <ErrorNotice error={invitation.error} retry={() => invitation.reset()} />}
      {invitations.isPending && <LoadingBlock label="Đang tải lời mời…" />}
      {invitations.isError && <ErrorNotice error={invitations.error} retry={() => invitations.refetch()} />}
      {!invitations.isPending && !invitations.isError && <div className="workspace-invitation-list">{invitations.data?.invitations.filter((item) => item.status === "pending").map((item) => <div className="workspace-invitation-row" key={item.id}><div><b>{item.email}</b><small>Analyst · hết hạn {formatDate(item.expires_at)}</small></div><button className="button danger" type="button" onClick={() => cancellation.mutate(item.id)} disabled={cancellation.isPending}>Hủy lời mời</button></div>)}</div>}
    </section>
  </main>;
}
