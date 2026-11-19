import {
  Bot,
  Database,
  FileChartColumn,
  Fingerprint,
  Layers3,
  Network,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { WindowId } from "./window-state";

const icons: Record<WindowId, LucideIcon> = {
  login: Fingerprint,
  workspace: Network,
  reports: FileChartColumn,
  data: Database,
  skills: Layers3,
  automations: Workflow,
  about: Bot,
};
export function DesktopIcon({
  id,
  small = false,
}: {
  id: WindowId;
  small?: boolean;
}) {
  const Icon = icons[id];
  return (
    <span
      className={`sd-app-icon sd-icon-${id}${small ? " sd-icon-small" : ""}`}
      aria-hidden="true"
    >
      <Icon size={small ? 16 : 25} strokeWidth={1.65} />
    </span>
  );
}
