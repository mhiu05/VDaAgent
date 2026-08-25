import { expect, test } from "@playwright/test";

const workspace = { id: "workspace-login", name: "Workspace Login", slug: "workspace-login", role: "analyst" };

test("one successful login navigates to the workspace without looping or blanking", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/auth/v1/token*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLWxvZ2luIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjo0MTAyNDQ0ODAwLCJpYXQiOjE3MDAwMDAwMDB9.",
        refresh_token: "refresh-login",
        expires_in: 3600,
        expires_at: 4102444800,
        token_type: "bearer",
        user: { id: "user-login", email: "analyst@example.com", user_metadata: {} },
      }),
    });
  });
  await page.route("**/api/v1/workspace-bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "user-login", email: "analyst@example.com" },
        workspace,
        effective_permissions: ["dataset.read", "dataset.upload", "workspace.create", "report.published.read"],
        workspaces: [workspace],
        dashboard: { kind: "analyst", counts: { datasets: 0 } },
      }),
    });
  });
  await page.route("**/api/v1/workspaces", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ workspaces: [workspace] }) });
  });
  await page.route("**/api/v1/datasets", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.goto("/login");
  await expect(page.locator("#login-title")).toBeVisible();
  await page.locator("#login-email").fill("analyst@example.com");
  await page.locator("#login-password").fill("password");
  await page.locator("button.auth-submit").click();

  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.locator(".workspace-page")).toBeVisible();
  await expect(page.getByText("Workspace Login")).toBeVisible();
  await expect(page.locator("body")).not.toHaveText("");
  expect(pageErrors).toEqual([]);
});
