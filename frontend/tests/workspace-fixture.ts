import type { Page } from "@playwright/test";

const analystPermissions = [
  "report.published.read",
  "report.published.export",
  "qa.published.ask",
  "dataset.read",
  "dataset.upload",
  "dataset.delete",
  "profile.read",
  "profile.run",
  "profile.review",
  "stats.run",
  "drift.run",
  "qa.profile.ask",
  "analysis.run",
  "notebook.read",
  "notebook.write",
  "notebook.share",
  "report.draft.write",
  "report.submit",
  "workspace.create",
  "workspace.delete",
];

const viewerPermissions = [
  "report.published.read",
  "report.published.export",
];

const adminPermissions = [
  ...analystPermissions.filter((permission) => permission !== "workspace.create"),
  "dataset.delete",
  "report.review",
  "report.publish",
  "report.archive",
  "workspace.activity.read",
  "workspace.audit.read",
  "workspace.members.manage",
  "workspace.settings.manage",
  "workspace.lifecycle.manage",
  "account.directory.read",
  "agent.trace.debug.read",
];

type WorkspaceRole = "admin" | "analyst" | "viewer";

const permissionsByRole: Record<WorkspaceRole, string[]> = {
  admin: adminPermissions,
  analyst: analystPermissions,
  viewer: viewerPermissions,
};

export async function useWorkspace(page: Page, role: WorkspaceRole): Promise<void> {
  const guestSession = {
    id: `5c4e4279-2d18-4b11-9cb1-b974f1c7dfa2-${role}`,
    role,
  };
  const workspace = {
    id: `workspace-e2e-${role}`,
    name: `Workspace E2E ${role}`,
    slug: `workspace-e2e-${role}`,
    role,
  };
  await page.addInitScript((session) => {
    window.sessionStorage.setItem("p170-guest-session-v1", JSON.stringify(session));
  }, guestSession);

  await page.route("**/api/v1/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: `guest-${role}-e2e`, email: null },
        workspace: { id: workspace.id, role: workspace.role },
        effective_permissions: permissionsByRole[role],
        workspaces: [workspace],
      }),
    });
  });
}

export function useAnalystWorkspace(page: Page): Promise<void> {
  return useWorkspace(page, "analyst");
}

export function useAdminWorkspace(page: Page): Promise<void> {
  return useWorkspace(page, "admin");
}

export function useViewerWorkspace(page: Page): Promise<void> {
  return useWorkspace(page, "viewer");
}
