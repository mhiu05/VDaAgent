import type { ReactNode } from "react";
import { SystemShell } from "../shell/SystemShell";
export function AdminLayout({ children }: { children: ReactNode }) {
  return <SystemShell role="ADMIN">{children}</SystemShell>;
}
