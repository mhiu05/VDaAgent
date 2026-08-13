"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { GuestRole } from "@/lib/auth/guest-session";

const trialRoles: Array<{ value: GuestRole; label: string }> = [
  { value: "viewer", label: "Viewer" },
  { value: "analyst", label: "Analyst" },
  { value: "admin", label: "Admin" },
];

export function PublicNavbar() {
  const pathname = usePathname();
  const { authenticated, isGuest, guestRole, me, enterGuestRole, signOut } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const currentRole = me?.workspace.role;
  const isOverviewPage = pathname === "/" || pathname.startsWith("/guide");
  const showRoleGroup = !authenticated || !isOverviewPage;

  useEffect(() => {
    const saved = window.localStorage.getItem("p170-theme");
    const nextTheme: "light" | "dark" = saved === "dark" || saved === "light"
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

  return <header className={`public-navbar${isGuest ? " guest-navbar" : ""}`}>
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
        <div className="public-nav-group public-nav-roles" aria-label={authenticated ? "Signed-in role" : "Choose a trial role"}>
          {authenticated && currentRole ? <span className="public-nav-current-role">{currentRole}</span> : trialRoles.map((role) => <button
            className={guestRole === role.value && !isOverviewPage ? "active" : ""}
            type="button"
            key={role.value}
            onClick={() => void enterGuestRole(role.value)}
          >{role.label}</button>)}
        </div>
      </>}
      <span className="public-nav-separator" aria-hidden="true">|</span>
      <div className="public-nav-group public-nav-actions">
        <button type="button" className="public-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} aria-pressed={theme === "dark"}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><small>{theme === "dark" ? "Sáng" : "Tối"}</small></button>
        {authenticated ? <>
          <Link className="public-nav-signin" href="/dashboard">Dashboard</Link>
          <button type="button" className="button primary public-nav-signup" onClick={() => void signOut()}>Đăng xuất</button>
        </> : <>
          <Link className="public-nav-signin" href="/login">Đăng nhập</Link>
          <Link className="button primary public-nav-signup" href="/signup">Đăng ký</Link>
        </>}
      </div>
    </nav>
  </header>;
}
