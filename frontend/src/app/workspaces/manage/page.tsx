"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import {
  cancelWorkspaceInvitation,
  disconnectGoogleDrive,
  getGoogleDriveStatus,
  inviteWorkspaceMember,
  listAccountDirectory,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  type AccountDirectoryEntry,
  type WorkspaceMember,
  type WorkspaceMemberStatus,
  type WorkspaceRole,
  updateWorkspaceMember,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

const roleLabels: Record<WorkspaceRole, string> = {
  admin: "Admin",
  analyst: "Analyst",
  viewer: "Viewer",
};

const statusLabels: Record<WorkspaceMemberStatus, string> = {
  active: "Đang hoạt động",
  suspended: "Tạm ngưng",
  removed: "Đã gỡ",
};

function MemberRow({ member, currentUserId, saving, onSave }: {
  member: WorkspaceMember;
  currentUserId: string;
  saving: boolean;
  onSave: (next: Pick<WorkspaceMember, "role" | "status">) => void;
}) {
  const [role, setRole] = useState<WorkspaceRole>(member.role);
  const [status, setStatus] = useState<WorkspaceMemberStatus>(member.status);

  useEffect(() => {
    setRole(member.role);
    setStatus(member.status);
  }, [member.role, member.status]);

  const unchanged = role === member.role && status === member.status;
  return <tr>
    <td><b>{member.email ?? "Tài khoản chưa đồng bộ email"}</b><code>{member.user_id}</code>{member.user_id === currentUserId && <small className="workspace-self-label">Bạn</small>}</td>
    <td><select aria-label={`Role của ${member.user_id}`} value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)} disabled={saving}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td>
    <td><select aria-label={`Trạng thái của ${member.user_id}`} value={status} onChange={(event) => setStatus(event.target.value as WorkspaceMemberStatus)} disabled={saving}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td>
    <td>{formatDate(member.updated_at)}</td>
    <td><button className="button secondary" type="button" onClick={() => onSave({ role, status })} disabled={saving || unchanged}>{saving ? "Đang lưu…" : "Lưu"}</button></td>
  </tr>;
}

function AccountMemberships({ account }: { account: AccountDirectoryEntry }) {
  if (!account.memberships.length) return <span className="muted">Chưa được gán workspace</span>;
  return <ul className="account-workspace-list">{account.memberships.map((membership) => <li key={`${account.user_id}-${membership.workspace_id}`}><b>{membership.workspace_name ?? membership.workspace_slug ?? "Workspace đã xóa"}</b><span>{roleLabels[membership.role]} · {statusLabels[membership.status]}</span></li>)}</ul>;
}

export default function WorkspaceManagePage() {
  const { me } = useAuth();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("analyst");
  const allowed = can(me?.effective_permissions, PERMISSIONS.workspaceMembersManage);
  const canReadAccountDirectory = can(me?.effective_permissions, PERMISSIONS.accountDirectoryRead);
  const members = useQuery({ queryKey: ["workspace-members"], queryFn: listWorkspaceMembers, enabled: allowed });
  const accounts = useQuery({ queryKey: ["account-directory"], queryFn: listAccountDirectory, enabled: canReadAccountDirectory });
  const invitations = useQuery({ queryKey: ["workspace-invitations"], queryFn: listWorkspaceInvitations, enabled: allowed });
  const drive = useQuery({ queryKey: ["workspace-drive"], queryFn: getGoogleDriveStatus, enabled: allowed });
  const invite = useMutation({
    mutationFn: inviteWorkspaceMember,
    onSuccess: async () => {
      setEmail("");
      await client.invalidateQueries({ queryKey: ["workspace-invitations"] });
    },
  });
  const memberUpdate = useMutation({
    mutationFn: ({ userId, ...payload }: { userId: string } & Pick<WorkspaceMember, "role" | "status">) => updateWorkspaceMember(userId, payload),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workspace-members"] });
      await client.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const invitationCancellation = useMutation({
    mutationFn: cancelWorkspaceInvitation,
    onSuccess: async () => client.invalidateQueries({ queryKey: ["workspace-invitations"] }),
  });
  const driveDisconnect = useMutation({
    mutationFn: disconnectGoogleDrive,
    onSuccess: async () => client.invalidateQueries({ queryKey: ["workspace-drive"] }),
  });

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim()) invite.mutate({ email: email.trim(), role: inviteRole });
  }

  if (!me || !allowed) return <main className="page"><Notice tone="warning"><b>Không có quyền truy cập.</b><p>Chỉ Admin của workspace hiện tại mới quản trị thành viên và cấu hình chung.</p></Notice></main>;

  const pendingInvitations = (invitations.data?.invitations ?? []).filter((item) => item.status === "pending");
  return <main className="page workspace-manage-page">
    <PageHeader
      eyebrow="ADMIN WORKSPACE"
      title="Quản trị workspace"
      description={`Quản lý thành viên, lời mời và cấu hình dùng chung của “${me.workspaces.find((item) => item.id === me.workspace.id)?.name ?? "workspace hiện tại"}”. Các quyền được áp dụng ở backend cho từng request.`}
      action={<Link className="button secondary" href="/workspaces">← Danh sách workspace</Link>}
    />

    <section className="workspace-management-summary" aria-label="Phạm vi quản trị">
      <div><b>Admin</b><span>Quản lý member, duyệt report và audit log</span></div>
      <div><b>Analyst</b><span>Upload, profiling, Agent và tạo report</span></div>
      <div><b>Viewer</b><span>Chỉ xem, tải báo cáo đã xuất bản</span></div>
    </section>

    <div className="workspace-management-grid">
      <section className="panel workspace-invite-panel">
        <div><p className="eyebrow">MỜI THÀNH VIÊN</p><h2>Thêm người vào workspace</h2><p className="muted">Lời mời có hiệu lực 7 ngày. Người nhận đăng nhập đúng email rồi chấp nhận lời mời để có quyền.</p></div>
        <form className="workspace-invite-form" onSubmit={submitInvite}>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required maxLength={320} /></label>
          <label>Vai trò<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as WorkspaceRole)}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button className="button primary" type="submit" disabled={invite.isPending}>{invite.isPending ? "Đang gửi…" : "Gửi lời mời"}</button>
        </form>
        {invite.isError && <ErrorNotice error={invite.error} retry={() => invite.reset()} />}
      </section>

      <section className="panel workspace-drive-panel">
        <div><p className="eyebrow">KHO LƯU TRỮ</p><h2>Google Drive</h2><p className="muted">Kết nối được dùng chung trong workspace. Analyst có thể upload sau khi Drive đã được kết nối.</p></div>
        {drive.isPending ? <LoadingBlock label="Đang kiểm tra Drive…" /> : drive.isError ? <ErrorNotice error={drive.error} retry={() => drive.refetch()} /> : <div className="workspace-drive-status"><span className={drive.data?.connected ? "drive-status connected" : "drive-status"}>{drive.data?.connected ? "Đã kết nối" : "Chưa kết nối"}</span>{drive.data?.connected ? <button className="button danger" type="button" onClick={() => driveDisconnect.mutate()} disabled={driveDisconnect.isPending}>{driveDisconnect.isPending ? "Đang ngắt…" : "Ngắt kết nối"}</button> : <Link className="button secondary" href="/datasets/new">Kết nối từ trang tải dữ liệu</Link>}</div>}
        {driveDisconnect.isError && <ErrorNotice error={driveDisconnect.error} retry={() => driveDisconnect.reset()} />}
      </section>
    </div>

    <section className="panel workspace-members-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">THÀNH VIÊN</p><h2>Quyền trong workspace</h2><p className="muted">Không thể hạ quyền hoặc tạm ngưng Admin cuối cùng, để workspace luôn có người quản trị.</p></div><span className="workspace-count">{members.data?.members.length ?? 0} thành viên</span></div>
      {members.isPending && <LoadingBlock label="Đang tải thành viên…" />}
      {members.isError && <ErrorNotice error={members.error} retry={() => members.refetch()} />}
      {memberUpdate.isError && <ErrorNotice error={memberUpdate.error} retry={() => memberUpdate.reset()} />}
      {!members.isPending && !members.isError && <div className="workspace-table-wrap"><table className="workspace-member-table"><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Trạng thái</th><th>Cập nhật</th><th /></tr></thead><tbody>{members.data?.members.map((member) => <MemberRow member={member} currentUserId={me.user.id} saving={memberUpdate.isPending} onSave={(payload) => memberUpdate.mutate({ userId: member.user_id, ...payload })} key={member.user_id} />)}</tbody></table></div>}
    </section>

    {canReadAccountDirectory && <section className="panel workspace-members-panel account-directory-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">DANH BẠ TÀI KHOẢN</p><h2>Tài khoản đã đăng ký</h2><p className="muted">Danh sách toàn hệ thống cho Admin. Mỗi tài khoản hiển thị các workspace đã được gán; danh sách này không tự cấp thêm quyền.</p></div><span className="workspace-count">{accounts.data?.accounts.length ?? 0} tài khoản</span></div>
      {accounts.isPending && <LoadingBlock label="Đang tải danh bạ tài khoản…" />}
      {accounts.isError && <ErrorNotice error={accounts.error} retry={() => accounts.refetch()} />}
      {!accounts.isPending && !accounts.isError && <div className="workspace-table-wrap"><table className="workspace-member-table account-directory-table"><thead><tr><th>Tài khoản</th><th>Workspace được gán</th><th>Đăng ký</th></tr></thead><tbody>{accounts.data?.accounts.map((account) => <tr key={account.user_id}><td><b>{account.email ?? "Tài khoản chưa đồng bộ email"}</b><code>{account.user_id}</code></td><td><AccountMemberships account={account} /></td><td>{formatDate(account.created_at)}</td></tr>)}</tbody></table></div>}
    </section>}

    <section className="panel workspace-invitations-panel">
      <div className="workspace-section-heading"><div><p className="eyebrow">LỜI MỜI ĐANG CHỜ</p><h2>Theo dõi lời mời</h2></div><span className="workspace-count">{pendingInvitations.length} lời mời</span></div>
      {invitations.isPending && <LoadingBlock label="Đang tải lời mời…" />}
      {invitations.isError && <ErrorNotice error={invitations.error} retry={() => invitations.refetch()} />}
      {invitationCancellation.isError && <ErrorNotice error={invitationCancellation.error} retry={() => invitationCancellation.reset()} />}
      {!invitations.isPending && !invitations.isError && (pendingInvitations.length ? <div className="workspace-table-wrap"><table className="workspace-member-table"><thead><tr><th>Email</th><th>Vai trò</th><th>Hết hạn</th><th /></tr></thead><tbody>{pendingInvitations.map((invitation) => <tr key={invitation.id}><td>{invitation.email}</td><td>{roleLabels[invitation.role]}</td><td>{formatDate(invitation.expires_at)}</td><td><button className="button danger" type="button" onClick={() => invitationCancellation.mutate(invitation.id)} disabled={invitationCancellation.isPending}>{invitationCancellation.isPending ? "Đang hủy…" : "Hủy lời mời"}</button></td></tr>)}</tbody></table></div> : <p className="muted workspace-empty-copy">Không có lời mời nào đang chờ.</p>)}
    </section>
  </main>;
}
