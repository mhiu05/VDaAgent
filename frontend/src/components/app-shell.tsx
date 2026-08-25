"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { CHAT_HISTORY_EVENT, clearChatHistory, createConversation, deleteConversation, listConversations, type ChatConversation } from "@/lib/chat-history";
import { useAuth } from "@/components/auth-provider";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { requiredPermissionForPath } from "@/lib/auth/route-access";
import { PublicNavbar } from "@/components/public-navbar";
import { InfoTip } from "@/components/ui";
import { DraggableChatWidget } from "@/components/draggable-chat-widget";

function SidebarIcon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "home") return <svg {...common}><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 5H5v14h5" /><path d="m14 8 4 4-4 4" /><path d="M18 12H9" /></svg>;
  if (name === "/reports") return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  if (name === "/datasets") return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /><path d="M7 4v16M17 4v16" /></svg>;
  if (name === "/charts") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20V7" /><path d="M2 20h22" /></svg>;
  if (name === "/compare") return <svg {...common}><path d="M7 7h11" /><path d="m15 3 4 4-4 4" /><path d="M17 17H6" /><path d="m9 13-4 4 4 4" /></svg>;
  if (name === "/activity") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
  if (name === "/admin") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "/account") return <svg {...common}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
  if (name === "/settings") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
}

function accountInitials(email: string | null) {
  const value = (email || "AN").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  return value.slice(0, 2).toUpperCase() || "AN";
}

const adminNavigation = [
  { href: "/admin", label: "Quản trị tài khoản", icon: "🛡", description: "Xem toàn bộ tài khoản, khóa / mở khóa và xóa tài khoản người dùng.", permission: PERMISSIONS.userAccountsRead },
  { href: "/account", label: "Hồ sơ cá nhân", icon: "👤", description: "Xem thông tin tài khoản Admin và đổi mật khẩu.", permission: PERMISSIONS.userAccountsRead },
] as const;

const analystNavigation = [
  { href: "/datasets", label: "Tải dữ liệu", icon: "▦", description: "Tải dữ liệu, tạo profile run và kiểm tra chất lượng dữ liệu.", permission: PERMISSIONS.datasetRead },
  { href: "/charts", label: "Biểu đồ", icon: "▥", description: "Không gian phân tích biểu đồ trực quan, hỏi đáp AI và ghim vào báo cáo.", permission: PERMISSIONS.profileRead },
  { href: "/compare", label: "So sánh dữ liệu", icon: "↔", description: "Đối chiếu hai profile run hoàn tất để phát hiện dữ liệu thay đổi.", permission: PERMISSIONS.driftRun },
  { href: "/reports", label: "Xem báo cáo", icon: "▤", description: "Xem các báo cáo đã tạo, đang chờ duyệt hoặc đã xuất bản.", permission: PERMISSIONS.reportPublishedRead },
  { href: "/activity", label: "Hoạt động", icon: "◷", description: "Xem lịch sử thao tác trong workspace để kiểm tra và audit.", permission: PERMISSIONS.workspaceAuditRead },
  { href: "/account", label: "Hồ sơ", icon: "👤", description: "Xem thông tin tài khoản cá nhân, phân quyền và bảo mật.", permission: PERMISSIONS.datasetRead },
  { href: "/settings", label: "Cài đặt", icon: "⚙", description: "Cấu hình context, theme màu sắc và ngôn ngữ cho workspace.", permission: PERMISSIONS.datasetRead },
] as const;

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [userProfile, setUserProfile] = useState<{ fullName?: string; avatarUrl?: string } | null>(null);
  const { me, authenticated, isGuest, guestRole, loading, error, workspaceId, switchWorkspace, signOut } = useAuth();
  const isHome = pathname === "/";
  const isGuide = pathname.startsWith("/guide");
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/auth/") || pathname.startsWith("/account/update-password");
  const isPublicPage = isHome || isGuide || pathname.startsWith("/about") || pathname.startsWith("/docs") || pathname.startsWith("/contact") || pathname.startsWith("/privacy") || pathname.startsWith("/terms");
  const isAdmin = Boolean(me?.workspace.role === "admin" || can(me?.effective_permissions, PERMISSIONS.userAccountsRead));
  const roleNavigation = isAdmin ? adminNavigation : analystNavigation;

  // Load custom profile & listen for avatar updates
  useEffect(() => {
    if (!me?.user && !isGuest) return;
    const key = `p170_user_profile_${me?.user.id || "guest"}`;
    const loadProfile = () => {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          setUserProfile(JSON.parse(stored));
        } else {
          setUserProfile(null);
        }
      } catch {
        // ignore
      }
    };
    loadProfile();
    window.addEventListener("p170-profile-updated", loadProfile);
    window.addEventListener("storage", loadProfile);
    return () => {
      window.removeEventListener("p170-profile-updated", loadProfile);
      window.removeEventListener("storage", loadProfile);
    };
  }, [me?.user, isGuest]);

  const avatarSrc = userProfile?.avatarUrl;
  const displayName = userProfile?.fullName || me?.user.email || "Analyst";

  const accountPanel = authenticated && me ? (
    <section className="sidebar-account" aria-label="Tài khoản đang đăng nhập">
      {avatarSrc ? (
        <Image
          src={avatarSrc}
          alt="Avatar"
          width={34}
          height={34}
          unoptimized
          className="account-avatar"
          style={{ width: "34px", height: "34px", borderRadius: "9px", objectFit: "cover" }}
        />
      ) : (
        <span className="account-avatar" aria-hidden="true">{accountInitials(displayName)}</span>
      )}
      <span className="account-details">
        <b title={me.user.email ?? undefined}>{displayName}</b>
        <em>
          <span className="account-status-dot" aria-hidden="true" />
          {isAdmin ? "Admin · Đang hoạt động" : "Đang hoạt động"}
        </em>
      </span>
      <button
        type="button"
        className="sidebar-account-signout"
        title="Đăng xuất"
        aria-label="Đăng xuất"
        onClick={() => void signOut()}
      >
        <SidebarIcon name="logout" />
      </button>
    </section>
  ) : isGuest ? (
    <section className="sidebar-account sidebar-guest-account" aria-label="Phiên khách đang hoạt động">
      {avatarSrc ? (
        <Image
          src={avatarSrc}
          alt="Avatar"
          width={34}
          height={34}
          unoptimized
          className="account-avatar"
          style={{ width: "34px", height: "34px", borderRadius: "9px", objectFit: "cover" }}
        />
      ) : (
        <span className="account-avatar" aria-hidden="true">AN</span>
      )}
      <span className="account-details">
        <b>{displayName || "Analyst workspace"}</b>
        <em><span className="account-status-dot" aria-hidden="true" />Đang dùng thử</em>
      </span>
    </section>
  ) : null;
  const guestWorkspacePanel = isGuest ? (
    <section className="sidebar-workspace sidebar-guest-workspace" aria-label="Workspace khách hiện tại">
      <span className="sidebar-workspace-label sidebar-text">Workspace hiện tại</span>
      <span className="workspace-demo-hint sidebar-text">Phiên dùng thử · dữ liệu mẫu</span>
    </section>
  ) : null;

  useEffect(() => {
    if (isPublicPage || isAuthPage || !me) return;
    if (isAdmin && (pathname === "/dashboard" || pathname === "/workspaces" || pathname === "/charts" || pathname === "/datasets" || pathname === "/compare" || pathname === "/reports" || pathname === "/activity")) {
      router.replace("/admin");
      return;
    }
    const permission = requiredPermissionForPath(pathname);
    if (permission && !can(me.effective_permissions, permission)) {
      router.replace(isAdmin ? "/admin" : "/dashboard");
    }
  }, [isAdmin, isAuthPage, isPublicPage, me, pathname, router]);

  useEffect(() => {
    if (loading || isPublicPage || isAuthPage || me || isGuest || error) return;
    const query = searchParams.toString();
    const next = `${pathname}${query ? `?${query}` : ""}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [error, isAuthPage, isGuest, isPublicPage, loading, me, pathname, router, searchParams]);

  useEffect(() => {
    if (isPublicPage || isAuthPage || isAdmin) return;
    const refresh = () => setConversations(listConversations());
    refresh();
    window.addEventListener(CHAT_HISTORY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHAT_HISTORY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [isAdmin, isAuthPage, isPublicPage]);

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
        {isAdmin ? (
          <div className="sidebar-top">
            <Link
              href="/admin"
              className={pathname === "/admin" ? "nav-link sidebar-home-link active" : "nav-link sidebar-home-link"}
              aria-label="Quản trị hệ thống"
            >
              <span className="sidebar-icon" aria-hidden="true">
                <SidebarIcon name="/admin" />
              </span>
              <span className="sidebar-link-label">Quản trị hệ thống</span>
            </Link>
          </div>
        ) : (
          <div className="sidebar-top">
            {/* Nút Trang chủ Analyst thay thế brand mascot */}
            <Link href="/" className={pathname === "/" ? "nav-link sidebar-home-link active" : "nav-link sidebar-home-link"} aria-label="Trang chủ Analyst">
              <span className="sidebar-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" />
                </svg>
              </span>
              <span className="sidebar-link-label">Trang chủ Analyst</span>
            </Link>
            <Link className={pathname === "/dashboard" ? "nav-link sidebar-home-link active" : "nav-link sidebar-home-link"} href="/dashboard">
              <span className="sidebar-icon" aria-hidden="true"><SidebarIcon name="home" /></span>
              <span className="sidebar-link-label">Trang chủ workspace</span>
            </Link>
            {authenticated && me && <section className="sidebar-workspace" aria-label="Workspace hiện tại">
              <span className="sidebar-workspace-label sidebar-text">Workspace của bạn</span>
              <select aria-label="Workspace hiện tại" value={workspaceId ?? ""} onChange={(event) => void changeWorkspace(event.target.value)}>
                {me.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
              </select>
              <Link className="workspace-manage-link sidebar-text" href="/workspaces">Quản lý Workspace →</Link>
            </section>}
            {guestWorkspacePanel}
          </div>
        )}
        <div className="sidebar-scroll">
          <nav className="nav-list sidebar-navigation" aria-label={isAdmin ? "Điều hướng quản trị hệ thống" : "Điều hướng phân tích dữ liệu"}>
            <span className="sidebar-section-label sidebar-text">{isAdmin ? "Hệ thống" : "Phân tích dữ liệu"}</span>
            {roleNavigation.filter((item) => can(me?.effective_permissions, item.permission)).map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <div className="sidebar-nav-item" key={item.href}><Link className={active ? "nav-link active" : "nav-link"} href={item.href}><span className="sidebar-icon" aria-hidden="true"><SidebarIcon name={item.href} /></span><span className="sidebar-link-label">{item.label}</span></Link><InfoTip label={`${item.label} dùng để làm gì`}>{item.description}</InfoTip></div>;
            })}
          </nav>
          {/* Account panel ở cuối cùng */}
          {accountPanel}
        </div>
      </aside>
      {!isAdmin && can(me?.effective_permissions, PERMISSIONS.qaProfileAsk) && (
        <DraggableChatWidget
          conversations={conversations}
          onNewChat={startNewChat}
          onRemoveConversation={removeConversation}
        />
      )}
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
