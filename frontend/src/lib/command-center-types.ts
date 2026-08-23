export const COMMAND_CENTER_TABS = ["overview"] as const;

export type CommandCenterTab = (typeof COMMAND_CENTER_TABS)[number];
export type CommandCenterProfileState = "queued" | "running" | "pending_review" | "completed" | "failed" | "cancelled";
export type ExplorerState = "idle" | "editing" | "previewing" | "preview_ready" | "promoting" | "blocked" | "failed" | "ready" | "cancelled";
export type CommandCenterAgentState = "idle" | "streaming" | "completed" | "no_evidence" | "rate_limited" | "failed";
export type CommandCenterReportState = "empty" | "draft" | "stale" | "snapshotting" | "exporting" | "exported" | "export_failed";

export const COMMAND_CENTER_TAB_LABELS: Record<CommandCenterTab, string> = {
  overview: "Tổng quan",
};

export function isCommandCenterTab(value: string | null): value is CommandCenterTab {
  return Boolean(value && COMMAND_CENTER_TABS.includes(value as CommandCenterTab));
}
