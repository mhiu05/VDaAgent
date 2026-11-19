import type { NotificationTarget } from "../../../shared/contracts/notification-target";
export type NotificationKind =
  | "account-created"
  | "system"
  | "report-ready"
  | "task-failed"
  | "action-required";
export interface Notification {
  id: string;
  kind: NotificationKind;
  title: { vi: string; en: string };
  summary: { vi: string; en: string };
  occurredAt: string;
  readAt: string | null;
  target: NotificationTarget;
  access: "available" | "missing" | "restricted";
}
