"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { CHAT_HISTORY_EVENT, clearChatHistory, createConversation, deleteConversation, listConversations, type ChatConversation } from "@/lib/chat-history";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { requiredPermissionForPath } from "@/lib/auth/route-access";
import { PublicNavbar } from "@/components/public-navbar";
import { InfoTip } from "@/components/ui";

const analystNavigation = [
  { href: "/reports", label: "Thư viện báo cáo", icon: "▤", description: "Xem các báo cáo đã tạo, đang chờ duyệt hoặc đã xuất bản.", permission: PERMISSIONS.reportPublishedRead },
  { href: "/datasets", label: "Bộ dữ liệu", icon: "▦", description: "Tải dữ liệu, tạo profile run và mở báo cáo profile.", permission: PERMISSIONS.datasetRead },
  { href: "/analyses", label: "Phân tích chuyên sâu", icon: "A", description: "Dành cho một mục tiêu nghiệp vụ rõ ràng; có context, quality gate và bước review.", permission: PERMISSIONS.analysisRun },
  { href: "/notebooks", label: "Phiên phân tích", icon: "✦", description: "Lưu ghi chú, câu hỏi Agent và kết quả theo một profile run. Không thay thế Chat Agent.", permission: PERMISSIONS.notebookRead },
  { href: "/compare", label: "So sánh phiên bản", icon: "↔", description: "Đối chiếu hai profile run hoàn tất để phát hiện dữ liệu thay đổi.", permission: PERMISSIONS.driftRun },
  { href: "/activity", label: "Hoạt động", icon: "◷", description: "Xem lịch sử thao tác trong workspace để kiểm tra và audit.", permission: PERMISSIONS.workspaceAuditRead },
] as const;

const adminNavigation = [
  { href: "/reports", label: "Báo cáo & phê duyệt", icon: "▤", description: "Kiểm tra, phê duyệt và xuất bản báo cáo trong workspace.", permission: PERMISSIONS.reportReview },
  { href: "/activity", label: "Nhật ký hoạt động", icon: "◷", description: "Theo dõi các thao tác quan trọng để audit workspace.", permission: PERMISSIONS.workspaceAuditRead },
] as const;

const viewerNavigation = [
  { href: "/reports", label: "Báo cáo đã xuất bản", icon: "▤", description: "Xem và xuất các báo cáo đã được phê duyệt.", permission: PERMISSIONS.reportPublishedRead },
] as const;

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const { me, authenticated, isGuest, loading, error, workspaceId, switchWorkspace, signOut } = useAuth();
  const isHome = pathname === "/";
  const isGuide = pathname.startsWith("/guide");
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/auth/") || pathname.startsWith("/account/update-password");
  const isPublicPage = isHome || isGuide;
  const isAdmin = me?.workspace.role === "admin" || Boolean(me?.global_role);
  const roleNavigation = isAdmin
    ? adminNavigation
    : me?.workspace.role === "viewer"
      ? viewerNavigation
      : analystNavigation;

  useEffect(() => {
    if (isPublicPage || isAuthPage) return;
    const permission = requiredPermissionForPath(pathname);
    if (me && permission && !can(me.effective_permissions, permission)) router.replace("/dashboard");
  }, [isAuthPage, isPublicPage, me, pathname, router]);

  useEffect(() => {
    if (loading || isPublicPage || isAuthPage || me || isGuest || error) return;
    const query = searchParams.toString();
    const next = `${pathname}${query ? `?${query}` : ""}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [error, isAuthPage, isGuest, isPublicPage, loading, me, pathname, router, searchParams]);

  useEffect(() => {
    if (isPublicPage || isAuthPage) return;
    const refresh = () => setConversations(listConversations());
    refresh();
    window.addEventListener(CHAT_HISTORY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHAT_HISTORY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [isAuthPage, isPublicPage]);

  function startNewChat() {
    const conversation = createConversation();
    router.push(`/chat?conversation=${conversation.id}`);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("p170-chat-navigation", { detail: { conversationId: conversation.id } })), 0);
  }

  async function changeWorkspace(nextWorkspaceId: string) {
    await switchWorkspace(nextWorkspaceId);
    // A chat is bound to the selected workspace. Return to the dashboard so
    // the next page cannot briefly display a conversation from the old scope.
    if (pathname.startsWith("/chat")) router.push("/dashboard");
  }

  function removeConversation(conversation: ChatConversation) {
    if (!window.confirm(`Xóa đoạn chat "${conversation.title}" khỏi lịch sử?`)) return;
    if (!deleteConversation(conversation.id)) return;
    const active = pathname === "/chat" && searchParams.get("conversation") === conversation.id;
    if (!active) return;
    setShowAllHistory(false);
    const next = listConversations()[0];
    if (next) {
      router.push(`/chat?conversation=${next.id}`);
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("p170-chat-navigation", { detail: { conversationId: next.id } })), 0);
    } else {
      router.push("/dashboard");
    }
  }

  function removeAllConversations() {
    if (!window.confirm("Xóa toàn bộ lịch sử chat trong workspace này? Hành động này không thể hoàn tác.")) return;
    clearChatHistory();
    setShowAllHistory(false);
    if (pathname === "/chat") router.push("/dashboard");
  }

  if (isPublicPage || isAuthPage) return <main className="main-content home-only-content">{children}</main>;

  const workspaceShell = (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Điều hướng chính">
        <Link href="/" className="brand" aria-label="VDaAgent Data Profile">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span><b>Profile</b><small>Phân tích dữ liệu</small></span>
        </Link>
        <Link className={pathname === "/dashboard" ? "nav-link sidebar-home-link active" : "nav-link sidebar-home-link"} href="/dashboard"><span aria-hidden="true">⌂</span>Trang chủ</Link>
        {authenticated && me && <section className="sidebar-workspace" aria-label="Workspace hiện tại">
          <span className="sidebar-workspace-label">Workspace của bạn</span>
          <div className="current-role" aria-label={`Vai trò hiện tại: ${me.workspace.role}`}>
            <span className="current-role-dot" aria-hidden="true" />
            <span><small>Vai trò hiện tại</small><b>{me.workspace.role}</b></span>
          </div>
          <select aria-label="Workspace hiện tại" value={workspaceId ?? ""} onChange={(event) => void changeWorkspace(event.target.value)}>{me.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name} · {workspace.role}</option>)}</select>
          <Link className="workspace-manage-link" href="/workspaces">Quản lý workspace →</Link>
          {can(me.effective_permissions, PERMISSIONS.workspaceMembersManage) && <Link className="workspace-admin-link" href="/workspaces/manage">Quản trị thành viên →</Link>}
        </section>}
        {!isAdmin && can(me?.effective_permissions, PERMISSIONS.qaProfileAsk) && <section className="chat-history" aria-label="Lịch sử chat">
          <div className="sidebar-section-heading"><span>Lịch sử chat</span><button type="button" className="new-chat-button" onClick={startNewChat}>+ Chat mới</button></div>
          <div className="chat-history-list">
            {conversations.length === 0 && <p className="sidebar-empty">Chưa có cuộc trò chuyện</p>}
            {conversations.slice(0, 5).map((conversation) => {
              const active = pathname === "/chat" && searchParams.get("conversation") === conversation.id;
              return <div className={active ? "chat-history-row active" : "chat-history-row"} key={conversation.id}><Link className="chat-history-item" href={`/chat?conversation=${conversation.id}`} onClick={() => setTimeout(() => window.dispatchEvent(new CustomEvent("p170-chat-navigation", { detail: { conversationId: conversation.id } })), 0)}>{conversation.title}</Link><button type="button" className="chat-history-delete" aria-label={`Xóa đoạn chat ${conversation.title}`} onClick={() => removeConversation(conversation)}>×</button></div>;
            })}
          </div>
          <div className="chat-history-footer"><button type="button" className="history-button" onClick={() => setShowAllHistory(true)} disabled={!conversations.length}>Lịch sử</button></div>
        </section>}
        <nav className="nav-list sidebar-navigation" aria-label={isAdmin ? "Điều hướng quản trị" : "Điều hướng dữ liệu"}>
          <span className="sidebar-section-label">{isAdmin ? "Quản trị workspace" : "Phân tích dữ liệu"}</span>
          {roleNavigation.filter((item) => can(me?.effective_permissions, item.permission)).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <div className="sidebar-nav-item" key={item.href}><Link className={active ? "nav-link active" : "nav-link"} href={item.href}><span aria-hidden="true">{item.icon}</span>{item.label}</Link><InfoTip label={`${item.label} dùng để làm gì`}>{item.description}</InfoTip></div>;
          })}
        </nav>
        <div className="sidebar-footer">
          {authenticated && me && <button type="button" className="sidebar-signout" onClick={() => void signOut()}><span aria-hidden="true">↪</span>Đăng xuất</button>}
        </div>
      </aside>
      {showAllHistory && <div className="history-modal-backdrop" role="presentation" onClick={() => setShowAllHistory(false)}><section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title" onClick={(event) => event.stopPropagation()}><div className="history-modal-header"><div><p className="eyebrow">Lưu trong 30 ngày</p><h2 id="history-modal-title">Lịch sử chat</h2></div><div className="history-modal-header-actions"><button type="button" className="history-clear-button" onClick={removeAllConversations}>Xóa tất cả</button><button type="button" className="history-modal-close" aria-label="Đóng lịch sử chat" onClick={() => setShowAllHistory(false)}>×</button></div></div><div className="history-modal-list">{conversations.map((conversation) => <div className="history-modal-row" key={conversation.id}><Link className="chat-history-item" href={`/chat?conversation=${conversation.id}`} onClick={() => { setShowAllHistory(false); setTimeout(() => window.dispatchEvent(new CustomEvent("p170-chat-navigation", { detail: { conversationId: conversation.id } })), 0); }}>{conversation.title}<small>{new Date(conversation.updatedAt).toLocaleDateString("vi-VN")}</small></Link><button type="button" className="chat-history-delete" aria-label={`Xóa đoạn chat ${conversation.title}`} onClick={() => removeConversation(conversation)}>×</button></div>)}</div></section></div>}
      <main className="main-content">{children}</main>
    </div>
  );

  // A guest can switch roles without losing the public navbar; the workspace
  // beneath it is the only part that changes with the selected role.
  if (loading) return <main className="main-content workspace-auth-loading" aria-live="polite" aria-busy="true"><section className="workspace-auth-loading-card"><span className="dashboard-loading-mark" aria-hidden="true" /><div><b>Đang mở workspace…</b><p>Đang xác định phiên và quyền truy cập.</p></div></section></main>;
  if (!me && !isGuest && !error) return <main className="main-content workspace-auth-loading" aria-live="polite"><section className="workspace-auth-loading-card"><div><b>Đang chuyển đến đăng nhập…</b><p>Vui lòng đăng nhập hoặc chọn một guest role để mở workspace.</p></div></section></main>;
  if (error && !me && !isPublicPage && !isAuthPage) return <main className="main-content workspace-auth-loading"><section className="workspace-auth-loading-card"><div><b>Không thể mở workspace</b><p>{error}</p><button className="button secondary" onClick={() => window.location.reload()}>Thử lại</button></div></section></main>;

  return isGuest ? <div className="guest-workspace"><PublicNavbar />{workspaceShell}</div> : workspaceShell;
}

export function AppShell({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="main-content home-only-content">{children}</main>}><AppShellContent>{children}</AppShellContent></Suspense>;
}
