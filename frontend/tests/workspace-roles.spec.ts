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
  await expect(page.getByText("Lịch sử chat")).toBeVisible();
  await expect(page.getByRole("link", { name: "Bộ dữ liệu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Phiên phân tích" })).toBeVisible();
  await expect(page.getByText("Admin")).toHaveCount(0);
  await expect(page.getByText("Viewer")).toHaveCount(0);
});
