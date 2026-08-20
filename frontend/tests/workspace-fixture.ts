import type { Page } from "@playwright/test";

const analystPermissions = [
  "report.published.read", "report.published.export", "qa.published.ask",
  "dataset.read", "dataset.upload", "dataset.delete", "profile.read",
  "profile.run", "profile.review", "stats.run", "drift.run", "qa.profile.ask",
  "analysis.run",
  "report.draft.write", "report.submit", "report.review", "report.publish",
  "report.archive", "workspace.activity.read", "workspace.audit.read",
  "workspace.members.manage", "workspace.settings.manage", "workspace.storage.connect",
  "workspace.lifecycle.manage", "workspace.create", "workspace.delete", "agent.run.read",
  "agent.trace.read", "agent.trace.debug.read",
];

export async function useAnalystWorkspace(page: Page): Promise<void> {
  const guestSession = { id: "5c4e4279-2d18-4b11-9cb1-b974f1c7dfa2-analyst", role: "analyst" };
  const workspace = { id: "workspace-e2e-analyst", name: "Workspace E2E Analyst", slug: "workspace-e2e-analyst", role: "analyst" };
  await page.addInitScript((session) => {
    window.sessionStorage.setItem("p170-guest-session-v1", JSON.stringify(session));
  }, guestSession);
  await page.route("**/api/v1/session", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "guest-analyst-e2e", email: null }, workspace, effective_permissions: analystPermissions, workspaces: [workspace] }) });
  });
}
