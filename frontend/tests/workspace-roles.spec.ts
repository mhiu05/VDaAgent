import { expect, test } from "@playwright/test";
import { useAdminWorkspace, useViewerWorkspace } from "./workspace-fixture";

test("viewer only sees published-report workspace flow", async ({ page }) => {
  await useViewerWorkspace(page);
  await page.route("**/api/v1/dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ kind: "viewer", reports: [{ id: "published-report", title: "Báo cáo đã duyệt", status: "published" }] }),
    });
  });
  await page.goto("/dashboard", { waitUntil: "networkidle" });

  await expect(page.locator("h1")).toHaveText("Báo cáo đã xuất bản");
  await expect(page.getByText("Báo cáo đã duyệt")).toBeVisible();
  await expect(page.getByText("Lịch sử chat")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Bộ dữ liệu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Phiên phân tích" })).toHaveCount(0);

  await page.route("**/api/v1/workspaces", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ workspaces: [{ id: "workspace-e2e-viewer", name: "Workspace E2E viewer", slug: "workspace-e2e-viewer", role: "viewer" }] }) });
  });
  await page.goto("/workspaces", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Tạo workspace" })).toHaveCount(0);
});

test("admin can open the workspace-member management surface", async ({ page }) => {
  await useAdminWorkspace(page);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/api/v1/dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        kind: "admin",
        counts: { datasets: 4, profiles: 6, analyses: 2, reports: 3 },
        reports: [{ id: "published-report", title: "Báo cáo đã xuất bản", status: "published" }],
        pending_review: [{ id: "pending-report", title: "Báo cáo chờ phê duyệt" }],
      }),
    });
  });
  await page.route("**/api/v1/workspaces/current/members", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ members: [{ workspace_id: "workspace-e2e-admin", user_id: "guest-admin-e2e", email: "admin@example.com", role: "admin", status: "active", created_at: "2026-08-15T00:00:00Z", updated_at: "2026-08-15T00:00:00Z" }] }) });
  });
  await page.route("**/api/v1/accounts", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ accounts: [{ user_id: "analyst-e2e", email: "minhhieuhh2k5@gmail.com", display_name: null, created_at: "2026-08-15T00:00:00Z", memberships: [{ workspace_id: "workspace-e2e-analyst", workspace_name: "Workspace E2E analyst", workspace_slug: "workspace-e2e-analyst", workspace_status: "active", role: "analyst", status: "active" }] }] }) });
  });
  await page.route("**/api/v1/workspaces/current/invitations", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ invitations: [] }) });
  });
  await page.route("**/api/v1/google-drive/status", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ provider: "local", configured: true, connected: false, folder_id: null, can_connect: true }) });
  });
  await page.goto("/dashboard", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "Quản trị workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Báo cáo & phê duyệt" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nhật ký hoạt động" })).toBeVisible();
  await expect(page.getByText("Báo cáo chờ phê duyệt")).toBeVisible();
  await expect(page.getByText("Lịch sử chat")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Bộ dữ liệu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Phân tích chuyên sâu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Phiên phân tích" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "So sánh phiên bản" })).toHaveCount(0);

  await page.getByRole("link", { name: "Quản trị thành viên" }).click();
  await expect(page).toHaveURL(/\/workspaces\/manage$/);

  await expect(page.getByRole("heading", { name: "Quản trị workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Thêm người vào workspace" })).toBeVisible();
  await expect(page.getByText("admin@example.com")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tài khoản đã đăng ký" })).toBeVisible();
  await expect(page.getByText("minhhieuhh2k5@gmail.com")).toBeVisible();
  await expect(page.getByRole("link", { name: "Kết nối từ trang tải dữ liệu" })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  expect((await page.screenshot()).byteLength).toBeGreaterThan(1_000);
});
