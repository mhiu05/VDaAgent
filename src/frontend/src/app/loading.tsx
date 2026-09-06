"use client";

import React from "react";
import { usePathname } from "next/navigation";

const standaloneRoutePrefixes = [
  "/about",
  "/guide",
  "/docs",
  "/contact",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
  "/forgot-password",
  "/auth",
  "/account/update-password",
];

function isStandaloneRoute(pathname: string): boolean {
  return pathname === "/"
    || pathname === "/health"
    || standaloneRoutePrefixes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export default function Loading() {
  const pathname = usePathname();

  // The root loading boundary is shared by public and workspace routes. Public
  // pages have their own content shell, so showing workspace auth copy here is
  // misleading while navigating between public pages.
  if (isStandaloneRoute(pathname)) return null;

  return <main className="dashboard-page" aria-live="polite" aria-busy="true">
    <section className="dashboard-loading">
      <span className="dashboard-loading-mark" aria-hidden="true" />
      <div>
        <b>Đang mở không gian làm việc...</b>
        <p>Đang chuẩn bị nội dung trang.</p>
      </div>
    </section>
  </main>;
}
