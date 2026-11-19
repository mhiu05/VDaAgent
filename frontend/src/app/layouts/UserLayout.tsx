import type { ReactNode } from "react";
import { SystemShell } from "../shell/SystemShell";
import { NotificationsProvider } from "../../features/notifications/state/NotificationsProvider";
export function UserLayout({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <SystemShell role="USER">{children}</SystemShell>
    </NotificationsProvider>
  );
}
