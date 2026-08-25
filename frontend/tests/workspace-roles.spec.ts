import { expect, test } from "@playwright/test";
import { useAnalystWorkspace } from "./workspace-fixture";

test("Analyst sees the complete workspace flow", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ kind: "analyst", counts: { datasets: 4, profiles: 6, analyses: 2, reports: 3 }, reports: [{ id: "published-report", title: "Báo cáo đã xuất bản", status: "published" }], pending_review: [] }),
    });
  });
  await page.goto("/dashboard", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "Sẵn sàng phân tích" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Báo cáo đã xuất bản" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mở Trợ lý AI Copilot" })).toBeVisible();
  await expect(page.locator('a[href="/datasets"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Phiên phân tích" })).toHaveCount(0);
  await expect(page.locator('a[href="/reports"]')).toBeVisible();
  await expect(page.getByText("Admin")).toHaveCount(0);
  await expect(page.getByText("Viewer")).toHaveCount(0);
});

test("Analyst keeps the floating AI Copilot launcher on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ kind: "analyst", counts: { datasets: 4, profiles: 6, analyses: 2, reports: 3 }, reports: [], pending_review: [] }),
    });
  });

  await page.goto("/dashboard", { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: "Mở Trợ lý AI Copilot" })).toBeVisible();
});
