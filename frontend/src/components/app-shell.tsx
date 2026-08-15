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

function SidebarIcon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "home") return <svg {...common}><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 5H5v14h5" /><path d="m14 8 4 4-4 4" /><path d="M18 12H9" /></svg>;
  if (name === "/reports") return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  if (name === "/datasets") return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /><path d="M7 4v16M17 4v16" /></svg>;
  if (name === "/analyses") return <svg {...common}><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></svg>;
  if (name === "/notebooks") return <svg {...common}><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /><path d="M4 6h2M4 10h2M4 14h2M4 18h2" /></svg>;
  if (name === "/compare") return <svg {...common}><path d="M7 7h11" /><path d="m15 3 4 4-4 4" /><path d="M17 17H6" /><path d="m9 13-4 4 4 4" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
}

function accountInitials(email: string | null) {
  const value = (email || "AN").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  return value.slice(0, 2).toUpperCase() || "AN";
}

const analystNavigation = [
  { href: "/reports", label: "Thư viện báo cáo", icon: "▤", description: "Xem các báo cáo đã tạo, đang chờ duyệt hoặc đã xuất bản.", permission: PERMISSIONS.reportPublishedRead },
  { href: "/datasets", label: "Bộ dữ liệu", icon: "▦", description: "Tải dữ liệu, tạo profile run và mở báo cáo profile.", permission: PERMISSIONS.datasetRead },
  { href: "/analyses", label: "Phân tích chuyên sâu", icon: "A", description: "Dành cho một mục tiêu nghiệp vụ rõ ràng; có context, quality gate và bước review.", permission: PERMISSIONS.analysisRun },
  { href: "/notebooks", label: "Phiên phân tích", icon: "✦", description: "Lưu ghi chú, câu hỏi Agent và kết quả theo một profile run. Không thay thế Chat Agent.", permission: PERMISSIONS.notebookRead },
  { href: "/compare", label: "So sánh phiên bản", icon: "↔", description: "Đối chiếu hai profile run hoàn tất để phát hiện dữ liệu thay đổi.", permission: PERMISSIONS.driftRun },
  { href: "/activity", label: "Hoạt động", icon: "◷", description: "Xem lịch sử thao tác trong workspace để kiểm tra và audit.", permission: PERMISSIONS.workspaceAuditRead },
] as const;

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const { me, authenticated, isGuest, guestRole, loading, error, workspaceId, switchWorkspace, signOut } = useAuth();
  const isHome = pathname === "/";
  const isGuide = pathname.startsWith("/guide");
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/auth/") || pathname.startsWith("/account/update-password");
  const isPublicPage = isHome || isGuide;
  const roleNavigation = analystNavigation;
  const accountPanel = authenticated && me ? (
    <section className="sidebar-account" aria-label="Tài khoản đang đăng nhập">
      <span className="account-avatar" aria-hidden="true">{accountInitials(me.user.email)}</span>
      <span className="account-details">
        <small>Tài khoản</small>
        <b title={me.user.email ?? undefined}>{me.user.email || "Analyst workspace"}</b>
        <em><span className="account-status-dot" aria-hidden="true" />Đang hoạt động</em>
      </span>
    </section>
  ) : isGuest ? (
    <section className="sidebar-account sidebar-guest-account" aria-label="Phiên khách đang hoạt động">
      <span className="account-avatar" aria-hidden="true">AN</span>
      <span className="account-details">
        <small>Phiên khách</small>
        <b>Analyst workspace</b>
        <em><span className="account-status-dot" aria-hidden="true" />Đang dùng thử</em>
      </span>
    </section>
  ) : null;
  const guestWorkspacePanel = isGuest ? (
    <section className="sidebar-workspace sidebar-guest-workspace" aria-label="Workspace khách hiện tại">
      <span className="sidebar-workspace-label">Workspace hiện tại</span>
      <div className="current-role">
        <span className="current-role-dot" aria-hidden="true" />
        <span><small>Vai trò</small><b>{guestRole ? `${guestRole.charAt(0).toUpperCase()}${guestRole.slice(1)}` : "Analyst"}</b></span>
      </div>
      <span className="workspace-demo-hint">Phiên dùng thử · dữ liệu mẫu</span>
    </section>
  ) : null;

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
        <div className="sidebar-top">
        <Link href="/" className="brand" aria-label="VDaAgent Data Profile">
          <span className="brand-mark brand-mark-mascot" aria-hidden="true"><img src="/img/profile-data-mascot.png" alt="" /></span>
          <span><b>Profile</b><small>Phân tích dữ liệu</small></span>
        </Link>
        {accountPanel}
        <Link className={pathname === "/dashboard" ? "nav-link sidebar-home-link active" : "nav-link sidebar-home-link"} href="/dashboard"><span className="sidebar-icon" aria-hidden="true"><SidebarIcon name="home" /></span>Trang chủ</Link>
        {authenticated && me && <section className="sidebar-workspace" aria-label="Workspace hiện tại">
          <span className="sidebar-workspace-label">Workspace của bạn</span>
          <div className="current-role" aria-label={`Vai trò hiện tại: ${me.workspace.role}`}>
            <span className="current-role-dot" aria-hidden="true" />
            <span><small>Vai trò hiện tại</small><b>{me.workspace.role}</b></span>
          </div>
          <select aria-label="Workspace hiện tại" value={workspaceId ?? ""} onChange={(event) => void changeWorkspace(event.target.value)}>{me.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name} · {workspace.role}</option>)}</select>
          <Link className="workspace-manage-link" href="/workspaces">Quản lý Workspace →</Link>
        </section>}
        {guestWorkspacePanel}
        </div>
        <div className="sidebar-scroll">
        {can(me?.effective_permissions, PERMISSIONS.qaProfileAsk) && <section className="chat-history" aria-label="Lịch sử chat">
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
        <nav className="nav-list sidebar-navigation" aria-label="Điều hướng phân tích dữ liệu">
          <span className="sidebar-section-label">Phân tích dữ liệu</span>
          {roleNavigation.filter((item) => can(me?.effective_permissions, item.permission)).map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <div className="sidebar-nav-item" key={item.href}><Link className={active ? "nav-link active" : "nav-link"} href={item.href}><span className="sidebar-icon" aria-hidden="true"><SidebarIcon name={item.href} /></span>{item.label}</Link><InfoTip label={`${item.label} dùng để làm gì`}>{item.description}</InfoTip></div>;
          })}
        </nav>
        <div className="sidebar-footer">
          {authenticated && me && <button type="button" className="sidebar-signout" onClick={() => void signOut()}><span className="sidebar-icon" aria-hidden="true"><SidebarIcon name="logout" /></span>Đăng xuất</button>}
        </div>
        </div>
      </aside>
      {showAllHistory && <div className="history-modal-backdrop" role="presentation" onClick={() => setShowAllHistory(false)}><section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title" onClick={(event) => event.stopPropagation()}><div className="history-modal-header"><div><p className="eyebrow">Lưu trong 30 ngày</p><h2 id="history-modal-title">Lịch sử chat</h2></div><div className="history-modal-header-actions"><button type="button" className="history-clear-button" onClick={removeAllConversations}>Xóa tất cả</button><button type="button" className="history-modal-close" aria-label="Đóng lịch sử chat" onClick={() => setShowAllHistory(false)}>×</button></div></div><div className="history-modal-list">{conversations.map((conversation) => <div className="history-modal-row" key={conversation.id}><Link className="chat-history-item" href={`/chat?conversation=${conversation.id}`} onClick={() => { setShowAllHistory(false); setTimeout(() => window.dispatchEvent(new CustomEvent("p170-chat-navigation", { detail: { conversationId: conversation.id } })), 0); }}>{conversation.title}<small>{new Date(conversation.updatedAt).toLocaleDateString("vi-VN")}</small></Link><button type="button" className="chat-history-delete" aria-label={`Xóa đoạn chat ${conversation.title}`} onClick={() => removeConversation(conversation)}>×</button></div>)}</div></section></div>}
      <main className="main-content">{children}</main>
    </div>
  );

  if (loading) return <main className="main-content workspace-auth-loading" aria-live="polite" aria-busy="true"><section className="workspace-auth-loading-card"><span className="dashboard-loading-mark" aria-hidden="true" /><div><b>Đang mở workspace…</b><p>Đang xác định phiên và quyền truy cập.</p></div></section></main>;
  if (!me && !isGuest && !error) return <main className="main-content workspace-auth-loading" aria-live="polite"><section className="workspace-auth-loading-card"><div><b>Đang chuyển đến đăng nhập…</b><p>Vui lòng đăng nhập hoặc chọn một guest role để mở workspace.</p></div></section></main>;
  if (error && !me && !isPublicPage && !isAuthPage) return <main className="main-content workspace-auth-loading"><section className="workspace-auth-loading-card"><div><b>Không thể mở workspace</b><p>{error}</p><button className="button secondary" onClick={() => window.location.reload()}>Thử lại</button></div></section></main>;

  return isGuest ? <div className="guest-workspace"><PublicNavbar />{workspaceShell}</div> : workspaceShell;
}

export function AppShell({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="main-content home-only-content">{children}</main>}><AppShellContent>{children}</AppShellContent></Suspense>;
}
