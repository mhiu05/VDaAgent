import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/globals.css";
import "@/app/public.css";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/app/providers";

const themeInitScript = `
(function () {
  try {
    var saved = window.localStorage.getItem("p170-theme");
    var theme = saved === "dark" || saved === "light"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

export const metadata: Metadata = {
  title: "Profile — Phân tích dữ liệu",
  description: "Profiling dữ liệu dựa trên evidence với quy trình human review.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="vi" suppressHydrationWarning><head><script id="theme-init" dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head><body><Providers><AppShell>{children}</AppShell></Providers></body></html>;
}
