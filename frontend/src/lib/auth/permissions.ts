export const PERMISSIONS = {
  reportPublishedRead: "report.published.read",
  reportPublishedExport: "report.published.export",
  qaPublishedAsk: "qa.published.ask",
  datasetRead: "dataset.read",
  datasetUpload: "dataset.upload",
  datasetDelete: "dataset.delete",
  profileRead: "profile.read",
  profileRun: "profile.run",
  profileReview: "profile.review",
  statsRun: "stats.run",
  driftRun: "drift.run",
  qaProfileAsk: "qa.profile.ask",
  analysisRun: "analysis.run",
  notebookRead: "notebook.read",
  notebookWrite: "notebook.write",
  notebookShare: "notebook.share",
  reportDraftWrite: "report.draft.write",
  reportSubmit: "report.submit",
  reportReview: "report.review",
  reportPublish: "report.publish",
  reportArchive: "report.archive",
  workspaceActivityRead: "workspace.activity.read",
  workspaceAuditRead: "workspace.audit.read",
  workspaceMembersManage: "workspace.members.manage",
  workspaceSettingsManage: "workspace.settings.manage",
  workspaceLifecycleManage: "workspace.lifecycle.manage",
  workspaceCreate: "workspace.create",
  workspaceDelete: "workspace.delete",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function can(permissions: readonly string[] | undefined, permission: Permission): boolean {
  return Boolean(permissions?.includes(permission));
}
