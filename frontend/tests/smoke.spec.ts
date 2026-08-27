import { expect, test } from "@playwright/test";
import { useAnalystWorkspace } from "./workspace-fixture";

test("analyst can navigate from dataset list to safe upload workflow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/datasets", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/v1/google-drive/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ provider: "local", configured: true, connected: true, can_connect: true }),
    });
  });

  await page.goto("/datasets", { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/datasets$/);
  await expect(page.getByRole("heading", { name: "Bộ dữ liệu", exact: true })).toBeVisible();
  await page.locator(".sidebar").hover();
  await expect(page.getByRole("button", { name: "Dữ liệu", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "Tải dữ liệu", exact: true })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/datasets\/new$/, { timeout: 30_000 }),
    page.getByRole("link", { name: "+ Bộ dữ liệu mới" }).click(),
  ]);
  // The dev server compiles this route on demand, so first paint can outlast the default expect timeout.
  await expect(page.getByRole("heading", { name: "Tải lên và bắt đầu profiling" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("CSV, TSV, Parquet hoặc JSON")).toBeVisible();
  await expect(page.getByLabel("Chế độ scan")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
