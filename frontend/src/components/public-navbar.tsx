"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { GuestRole } from "@/lib/auth/guest-session";
import { guestEnabled } from "@/lib/auth/guest-session";
import { PublicPageMotion } from "@/components/public-motion";

const trialRole: { value: GuestRole; label: string } = { value: "analyst", label: "Analyst" };

export function PublicNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { authenticated, isGuest, guestRole, me, enterGuestRole, signOut, loading } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const currentRole = me?.workspace?.role;
  const isOverviewPage = pathname === "/" || pathname.startsWith("/guide") || pathname.startsWith("/about") || pathname.startsWith("/docs") || pathname.startsWith("/contact") || pathname.startsWith("/privacy") || pathname.startsWith("/terms");
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/auth/") || pathname.startsWith("/account/update-password");

  const showTrialRoles = guestEnabled() && !loading && !authenticated;
  const showRoleGroup = showTrialRoles;
  const useGuestNavbar = isGuest && !isOverviewPage && !isAuthPage;

  useEffect(() => {
    setPendingPath(null);
  }, [pathname]);

  useEffect(() => {
    const publicPaths = ["/", "/about", "/guide", "/docs", "/login", "/signup"];
    publicPaths.forEach((path) => router.prefetch(path));
  }, [router]);

  useEffect(() => {
    if (!pendingPath) return;
    const timeout = window.setTimeout(() => setPendingPath(null), 10000);
    return () => window.clearTimeout(timeout);
  }, [pendingPath]);

  function handleNavigationClick(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || href === pathname) return;
    setPendingPath(href);
  }

  function navState(href: string) {
    const activePath = pendingPath ?? pathname;
    const active = href === "/" ? activePath === "/" : activePath.startsWith(href);
    const pending = pendingPath === href;
    return {
      className: `pub-nav-link${active ? " active" : ""}${pending ? " pending" : ""}`,
      "aria-current": active ? "page" as const : undefined,
    };
  }

  function actionState(href: string, variant: "primary" | "ghost") {
    const pending = pendingPath === href;
    return {
      className: "pub-btn pub-btn-" + variant + " pub-nav-action" + (pending ? " pending" : ""),
      "aria-busy": pending || undefined,
    };
  }

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
      if (!(e.target as Element).closest(".nav-avatar-container")) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("p170-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme === "dark" ? "dark" : "light";
  }

  return (
    <div className="pub-navbar-wrapper" data-nav-pending={pendingPath ? "true" : undefined} aria-busy={pendingPath ? "true" : undefined}>
      <PublicPageMotion />
      {pendingPath && <span className="pub-nav-status" role="status" aria-live="polite">Đang mở trang…</span>}
      <header className={`pub-navbar${useGuestNavbar ? " guest-navbar" : ""}`}>
        <Link href="/" className="pub-nav-brand" aria-label="VDaAgent Trang chủ">
          <span className="pub-brand-mascot" aria-hidden="true">
            <Image src="/img/logo.png" alt="" width={110} height={110} unoptimized priority />
          </span>
          <span>VDaAgent</span>
        </Link>

        <nav className="pub-nav-links">
          <Link {...navState("/")} href="/" onClick={(event) => handleNavigationClick(event, "/")}>Trang chủ</Link>
          <Link {...navState("/about")} href="/about" onClick={(event) => handleNavigationClick(event, "/about")}>Giới thiệu</Link>
          <Link {...navState("/guide")} href="/guide" onClick={(event) => handleNavigationClick(event, "/guide")}>Hướng dẫn</Link>
          <Link {...navState("/docs")} href="/docs" onClick={(event) => handleNavigationClick(event, "/docs")}>Tài liệu</Link>
          <Link className={pathname.startsWith("/contact") ? "active" : ""} href="/contact">Liên hệ</Link>

          {showRoleGroup && (
            <div className="pub-nav-roles" aria-label={showTrialRoles ? "Choose a trial role" : "Signed-in role"}>
              {showTrialRoles ? (
                <button
                  className={`pub-trial-button${guestRole === trialRole.value && !isOverviewPage ? " active" : ""}`}
                  type="button"
                  onClick={() => void enterGuestRole(trialRole.value)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M7.25 5.75 13.5 10l-6.25 4.25z" />
                  </svg>
                  <span>Dùng thử Analyst</span>
                </button>
              ) : currentRole ? (
                <span className="pub-nav-current-role">{currentRole}</span>
              ) : null}
            </div>
          )}
        </nav>

        <nav className="pub-nav-actions" aria-label="Public navigation actions">
          <button type="button" className="pub-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} aria-pressed={theme === "dark"}>
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            <small>{theme === "dark" ? "Sáng" : "Tối"}</small>
          </button>

          {authenticated ? (
            <>
              <Link className="pub-btn pub-btn-primary" href="/workspaces">Workspace</Link>
              <div className="nav-avatar-container">
                <button type="button" className="nav-avatar-btn" onClick={() => setAvatarOpen(!avatarOpen)} aria-label="Mở menu tài khoản" aria-expanded={avatarOpen}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </button>
                <div className={`nav-dropdown-menu ${avatarOpen ? "open" : ""}`} hidden={!avatarOpen}>
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
              <Link {...actionState("/signup", "primary")} href="/signup" onClick={(event) => handleNavigationClick(event, "/signup")}>Đăng ký</Link>
            </>
          ) : loading ? (
            <span className="pub-nav-auth-pending" role="status" aria-label="Đang xác định phiên đăng nhập" />
          ) : (
            <>
              <Link {...actionState("/login", "ghost")} href="/login" onClick={(event) => handleNavigationClick(event, "/login")}>Đăng nhập</Link>
              <Link {...actionState("/signup", "primary")} href="/signup" onClick={(event) => handleNavigationClick(event, "/signup")}>Đăng ký</Link>
            </>
          )}
        </nav>
      </header>
    </div>
  );
}
