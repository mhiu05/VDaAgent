"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { GuestRole } from "@/lib/auth/guest-session";

const trialRole: { value: GuestRole; label: string } = { value: "analyst", label: "Analyst" };

export function PublicNavbar() {
  const pathname = usePathname();
  const { authenticated, isGuest, guestRole, me, enterGuestRole, signOut, loading } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const currentRole = me?.workspace.role;
  const isOverviewPage = pathname === "/" || pathname.startsWith("/guide") || pathname.startsWith("/about") || pathname.startsWith("/docs") || pathname.startsWith("/contact") || pathname.startsWith("/privacy") || pathname.startsWith("/terms");
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/auth/") || pathname.startsWith("/account/update-password");
  
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
      if (!(e.target as Element).closest('.nav-avatar-container, .pub-nav-more')) {
        setAvatarOpen(false);
        setOtherOpen(false);
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

  return (
    <div className="pub-navbar-wrapper">
      <header className={`pub-navbar${useGuestNavbar ? " guest-navbar" : ""}`}>
        <Link href="/" className="pub-nav-brand" aria-label="VDaAgent Trang chủ">
          <Image src="/img/logo.png" alt="Logo" width={32} height={32} style={{ objectFit: "contain", background: "transparent" }} priority />
          <span>VDaAgent</span>
        </Link>
        
        <nav className="pub-nav-links">
          <Link className={pathname === "/" ? "active" : ""} href="/">Trang chủ</Link>
          <Link className={pathname.startsWith("/about") ? "active" : ""} href="/about">Giới thiệu</Link>
          <Link className={pathname.startsWith("/guide") ? "active" : ""} href="/guide">Hướng dẫn</Link>
          <Link className={pathname.startsWith("/docs") ? "active" : ""} href="/docs">Tài liệu</Link>
          <Link className={pathname.startsWith("/contact") ? "active" : ""} href="/contact">Liên hệ</Link>
          
          <Link className={pathname.startsWith("/privacy") ? "active" : ""} href="/privacy">Privacy</Link>
          <Link className={pathname.startsWith("/terms") ? "active" : ""} href="/terms">Terms</Link>

          <div className="pub-nav-more">
            <button
              type="button"
              className={pathname.startsWith("/privacy") || pathname.startsWith("/terms") || pathname.startsWith("/contact") ? "pub-nav-more-trigger active" : "pub-nav-more-trigger"}
              onClick={() => setOtherOpen(!otherOpen)}
              aria-expanded={otherOpen}
              aria-haspopup="menu"
            >
              Khác <span aria-hidden="true">⌄</span>
            </button>
            <div className={otherOpen ? "pub-nav-more-menu open" : "pub-nav-more-menu"} role="menu" hidden={!otherOpen}>
              <Link href="/privacy" role="menuitem" onClick={() => setOtherOpen(false)}>Privacy Policy</Link>
              <Link href="/terms" role="menuitem" onClick={() => setOtherOpen(false)}>Terms of Service</Link>
              <Link href="/contact" role="menuitem" onClick={() => setOtherOpen(false)}>Contact</Link>
            </div>
          </div>

          {showRoleGroup && (
            <div className="pub-nav-roles" aria-label={showTrialRoles ? "Choose a trial role" : "Signed-in role"}>
              {showTrialRoles ? (
                <button
                  className={guestRole === trialRole.value && !isOverviewPage ? "active" : ""}
                  type="button"
                  onClick={() => void enterGuestRole(trialRole.value)}
                >Dùng thử Analyst</button>
              ) : currentRole ? (
                <span className="pub-nav-current-role">{currentRole}</span>
              ) : null}
            </div>
          )}
          <div className="pub-nav-more pub-nav-more-actions">
            <button
              type="button"
              className={pathname.startsWith("/privacy") || pathname.startsWith("/terms") || pathname.startsWith("/contact") ? "pub-nav-more-trigger active" : "pub-nav-more-trigger"}
              onClick={() => setOtherOpen(!otherOpen)}
              aria-expanded={otherOpen}
              aria-haspopup="menu"
            >
              Kh\u00e1c <span aria-hidden="true">⌄</span>
            </button>
            <div className={otherOpen ? "pub-nav-more-menu open" : "pub-nav-more-menu"} role="menu" hidden={!otherOpen}>
              <Link href="/privacy" role="menuitem" onClick={() => setOtherOpen(false)}>Privacy Policy</Link>
              <Link href="/terms" role="menuitem" onClick={() => setOtherOpen(false)}>Terms of Service</Link>
              <Link href="/contact" role="menuitem" onClick={() => setOtherOpen(false)}>Contact</Link>
            </div>
          </div>
        </nav>

        <nav className="pub-nav-actions" aria-label="Public navigation actions">
          <div className="pub-nav-more pub-nav-more-actions">
            <button type="button" className={pathname.startsWith("/privacy") || pathname.startsWith("/terms") || pathname.startsWith("/contact") ? "pub-nav-more-trigger active" : "pub-nav-more-trigger"} onClick={() => setOtherOpen(!otherOpen)} aria-expanded={otherOpen} aria-haspopup="menu">
              Khac <span aria-hidden="true">⌄</span>
            </button>
            <div className={otherOpen ? "pub-nav-more-menu open" : "pub-nav-more-menu"} role="menu" hidden={!otherOpen}>
              <Link href="/privacy" role="menuitem" onClick={() => setOtherOpen(false)}>Privacy Policy</Link>
              <Link href="/terms" role="menuitem" onClick={() => setOtherOpen(false)}>Terms of Service</Link>
              <Link href="/contact" role="menuitem" onClick={() => setOtherOpen(false)}>Contact</Link>
            </div>
          </div>
          <button type="button" className="pub-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} aria-pressed={theme === "dark"}>
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            <small>{theme === "dark" ? "Sáng" : "Tối"}</small>
          </button>
          
          {authenticated ? (
            <>
              <Link className="pub-btn pub-btn-primary" href="/workspaces">Workspace</Link>
              <div className="nav-avatar-container">
                <button type="button" className="nav-avatar-btn" onClick={() => setAvatarOpen(!avatarOpen)} aria-label="Mở menu tài khoản" aria-expanded={avatarOpen}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </button>
                <div className={`nav-dropdown-menu ${avatarOpen ? 'open' : ''}`} hidden={!avatarOpen}>
                  <Link href="/account" className="nav-dropdown-item" onClick={() => setAvatarOpen(false)}>Hồ sơ</Link>
                  <Link href="/settings" className="nav-dropdown-item" onClick={() => setAvatarOpen(false)}>Cài đặt</Link>
                  <div className="nav-dropdown-divider" />
                  <button type="button" className="nav-dropdown-item" onClick={() => void signOut()}>Đăng xuất</button>
                </div>
              </div>
            </>
          ) : isGuest ? (
            <>
              <button type="button" className="pub-btn pub-btn-secondary" onClick={() => void signOut()}>Kết thúc</button>
              <Link className="pub-btn pub-btn-primary" href="/signup">Đăng ký</Link>
            </>
          ) : loading ? (
            <span className="pub-nav-auth-pending" role="status" aria-label="Đang xác định phiên đăng nhập" />
          ) : (
            <>
              <Link className="pub-btn pub-btn-ghost" href="/login">Đăng nhập</Link>
              <Link className="pub-btn pub-btn-primary" href="/signup">Đăng ký</Link>
            </>
          )}
        </nav>
      </header>
    </div>
  );
}
