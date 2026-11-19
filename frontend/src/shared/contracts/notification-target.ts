export type NotificationTarget =
  | { kind: "chat"; conversationId: string }
  | { kind: "report"; reportId: string; versionId?: string }
  | { kind: "account" }
  | { kind: "system-detail"; notificationId: string };
export function targetPath(target: NotificationTarget) {
  switch (target.kind) {
    case "chat":
      return `/chat?conversation=${encodeURIComponent(target.conversationId)}`;
    case "report":
      return `/reports?${new URLSearchParams({ report: target.reportId, ...(target.versionId ? { version: target.versionId } : {}) })}`;
    case "account":
      return "/setting";
    case "system-detail":
      return null;
  }
}
