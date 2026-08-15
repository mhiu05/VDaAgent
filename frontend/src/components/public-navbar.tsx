"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { GuestRole } from "@/lib/auth/guest-session";

const trialRole: { value: GuestRole; label: string } = { value: "analyst", label: "Analyst" };

export function PublicNavbar() {
  const pathname = usePathname();
  const { authenticated, isGuest, guestRole, me, enterGuestRole, signOut } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const currentRole = me?.workspace.role;
  const isOverviewPage = pathname === "/" || pathname.startsWith("/guide");
  const isHomePage = pathname === "/";
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/forgot-password") || pathname.startsWith("/auth/") || pathname.startsWith("/account/update-password");
  // Keep the trial role switcher visible on all public entry points. This is
  // especially important on login/signup: visitors may decide to try a role
  // without completing account authentication first.
  const showTrialRoles = isHomePage || isAuthPage || !authenticated;
  const showRoleGroup = showTrialRoles || authenticated;
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

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("p170-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme === "dark" ? "dark" : "light";
  }

  return <header className={`public-navbar${useGuestNavbar ? " guest-navbar" : ""}`}>
    <Link href="/" className="public-brand" aria-label="VDaAgent Trang chủ">
      <span className="public-brand-mark" aria-hidden="true">P</span>
      <span><b>Profile</b><small>Data intelligence</small></span>
    </Link>
    <nav className="public-nav" aria-label="Public navigation">
      <div className="public-nav-group">
        <Link className={pathname === "/" ? "active" : ""} href="/">Trang chủ</Link>
        <Link className={pathname.startsWith("/guide") ? "active" : ""} href="/guide">Hướng dẫn</Link>
      </div>
      {showRoleGroup && <>
        <span className="public-nav-separator" aria-hidden="true">|</span>
        <div className="public-nav-group public-nav-roles" aria-label={showTrialRoles ? "Choose a trial role" : "Signed-in role"}>
          {showTrialRoles ? <button
            className={guestRole === trialRole.value && !isOverviewPage ? "active" : ""}
            type="button"
            onClick={() => void enterGuestRole(trialRole.value)}
          >{trialRole.label}</button> : currentRole ? <span className="public-nav-current-role">{currentRole}</span> : null}
        </div>
      </>}
      <span className="public-nav-separator" aria-hidden="true">|</span>
      <div className="public-nav-group public-nav-actions">
        <button type="button" className="public-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} aria-pressed={theme === "dark"}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><small>{theme === "dark" ? "Sáng" : "Tối"}</small></button>
        {authenticated ? <>
          <Link className="public-nav-signin" href="/dashboard">Dashboard</Link>
          <button type="button" className="button primary public-nav-signup" onClick={() => void signOut()}>Đăng xuất</button>
        </> : isGuest ? <>
          <button type="button" className="public-nav-signin" onClick={() => void signOut()}>Kết thúc dùng thử</button>
          <Link className="button primary public-nav-signup" href="/signup">Đăng ký</Link>
        </> : <>
          <Link className="public-nav-signin" href="/login">Đăng nhập</Link>
          <Link className="button primary public-nav-signup" href="/signup">Đăng ký</Link>
        </>}
      </div>
    </nav>
  </header>;
}
