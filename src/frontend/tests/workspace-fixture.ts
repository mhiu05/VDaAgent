import type { Page } from "@playwright/test";

const analystPermissions = [
  "report.published.read", "report.published.export", "qa.published.ask",
  "dataset.read", "dataset.upload", "profile.read",
  "profile.run", "profile.review", "stats.run", "drift.run", "qa.profile.ask",
  "analysis.run",
  "report.draft.write", "report.submit", "workspace.activity.read", "agent.run.read",
  "agent.trace.read",
];

export async function useAnalystWorkspace(page: Page): Promise<void> {
  const guestSession = { id: "5c4e4279-2d18-4b11-9cb1-b974f1c7dfa2-analyst", role: "analyst" };
  const workspace = { id: "workspace-e2e-analyst", name: "Workspace E2E Analyst", slug: "workspace-e2e-analyst", role: "analyst" };
  await page.addInitScript((session) => {
    window.sessionStorage.setItem("p170-guest-session-v1", JSON.stringify(session));
  }, guestSession);
  await page.route("**/workspace-bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "http://127.0.0.1:3010",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "accept, authorization, x-workspace-id",
      },
      body: JSON.stringify({
        user: { id: "guest-analyst-e2e", email: null },
        workspace,
        effective_permissions: analystPermissions,
        workspaces: [workspace],
        dashboard: {
          kind: "analyst",
          counts: { datasets: 4, profiles: 6, analyses: 2, reports: 3 },
          reports: [{ id: "published-report", title: "Báo cáo đã xuất bản", status: "published" }],
        },
      }),
    });
  });
}
