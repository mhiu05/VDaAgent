import type { NotificationTarget } from "../../shared/contracts/notification-target";
import { targetPath } from "../../shared/contracts/notification-target";
import type { Role } from "../../shared/contracts/auth";
export function resolveTarget(
  target: NotificationTarget,
  role: Role,
  conversationIds: readonly string[],
  hasReport: (id: string) => boolean,
): string | null {
  if (role !== "USER") return null;
  if (
    target.kind === "chat" &&
    !conversationIds.includes(target.conversationId)
  )
    return null;
  if (target.kind === "report" && !hasReport(target.reportId)) return null;
  return targetPath(target);
}
