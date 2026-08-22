"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { GuestRole } from "@/lib/auth/guest-session";

const trialRole: { value: GuestRole; label: string } = { value: "analyst", label: "Analyst" };

export function PublicNavbar() {
  const pathname = usePathname();
  const { authenticated, isGuest, guestRole, me, enterGuestRole, signOut, loading } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const currentRole = me?.workspace.role;
  const isOverviewPage = pathname === "/" || pathname.startsWith("/guide") || pathname.startsWith("/about") || pathname.startsWith("/docs") || pathname.startsWith("/contact");
  const isHomePage = pathname === "/";
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/auth/") || pathname.startsWith("/account/update-password");
  // Keep the trial role switcher visible on all public entry points. This is
  // especially important on login/signup: visitors may decide to try a role
  // without completing account authentication first.
  const showTrialRoles = !loading && !authenticated;
  const showRoleGroup = showTrialRoles;
  const useGuestNavbar = isGuest && !isOverviewPage && !isAuthPage;

  useEffect(() => {
    const rootTheme = document.documentElement.dataset.theme;
    const saved = window.localStorage.getItem("p170-theme");
    const nextTheme: "light" | "dark" = rootTheme === "dark" || rootTheme === "light"
      ? rootTheme
      : saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme === "dark" ? "dark" : "light";
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!(e.target as Element).closest('.nav-avatar-container')) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("p170-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme === "dark" ? "dark" : "light";
  }

  return <header className={`public-navbar${useGuestNavbar ? " guest-navbar" : ""}`}>
    <div className="public-navbar-left" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
      <Link href="/" className="public-brand" aria-label="VDaAgent Trang chủ">
        <img src="/img/logo.png" className="public-brand-mark" alt="Logo" style={{ width: 42, height: 42, objectFit: 'contain', background: 'transparent' }} />
        <span><b style={{ fontSize: '1.25rem' }}>VDaAgent</b></span>
      </Link>
      <nav className="public-nav" style={{ marginLeft: 0 }}>
        <div className="public-nav-group">
          <Link className={pathname === "/" ? "active" : ""} href="/">Trang chủ</Link>
          <Link className={pathname.startsWith("/about") ? "active" : ""} href="/about">Giới thiệu</Link>
          <Link className={pathname.startsWith("/guide") ? "active" : ""} href="/guide">Hướng dẫn</Link>
          <Link className={pathname.startsWith("/docs") ? "active" : ""} href="/docs">Tài liệu</Link>
          <Link className={pathname.startsWith("/contact") ? "active" : ""} href="/contact">Liên hệ</Link>
        </div>
        {showRoleGroup && <>
          <span className="public-nav-separator" aria-hidden="true">|</span>
          <div className="public-nav-group public-nav-roles" aria-label={showTrialRoles ? "Choose a trial role" : "Signed-in role"}>
            {showTrialRoles ? <button
              className={guestRole === trialRole.value && !isOverviewPage ? "active" : ""}
              type="button"
              onClick={() => void enterGuestRole(trialRole.value)}
            >Dùng thử Analyst</button> : currentRole ? <span className="public-nav-current-role">{currentRole}</span> : null}
          </div>
        </>}
      </nav>
    </div>
    <nav className="public-nav" aria-label="Public navigation actions">
      <div className="public-nav-group public-nav-actions">
        <button type="button" className="public-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} aria-pressed={theme === "dark"}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><small>{theme === "dark" ? "Sáng" : "Tối"}</small></button>
        {loading ? null : authenticated ? <>
          <Link className="button primary public-nav-signup" href="/dashboard">Workspace</Link>
          <div className="nav-avatar-container">
            <button type="button" className="nav-avatar-btn" onClick={() => setAvatarOpen(!avatarOpen)} aria-label="Toggle user menu">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </button>
            <div className={`nav-dropdown-menu ${avatarOpen ? 'open' : ''}`}>
              <Link href="/profile" className="nav-dropdown-item" onClick={() => setAvatarOpen(false)}>Hồ sơ</Link>
              <Link href="/settings" className="nav-dropdown-item" onClick={() => setAvatarOpen(false)}>Cài đặt</Link>
              <div className="nav-dropdown-divider"></div>
              <button type="button" className="nav-dropdown-item" onClick={() => void signOut()}>Đăng xuất</button>
            </div>
          </div>
        </> : isGuest ? <>
          <button type="button" className="button primary public-nav-signup" onClick={() => void signOut()}>Kết thúc dùng thử</button>
          <Link className="button primary public-nav-signup" href="/signup">Đăng ký</Link>
        </> : <>
          <Link className="button primary public-nav-signup" href="/login">Đăng nhập</Link>
          <Link className="button primary public-nav-signup" href="/signup">Đăng ký</Link>
        </>}
      </div>
    </nav>
  </header>;
}
