import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/globals.css";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "Profile — Data intelligence",
  description: "Evidence-first data profiling with human review.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="vi" suppressHydrationWarning><body><Providers><AppShell>{children}</AppShell></Providers></body></html>;
}
