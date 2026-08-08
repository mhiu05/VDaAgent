import { expect, test } from "@playwright/test";

test("renders agent report markdown without raw formatting markers", async ({ page }) => {
  await page.route("**/api/v1/profile/run-ux-test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile_run_id: "run-ux-test",
        dataset_id: "dataset-ux-test",
        dataset_name: "UX test dataset",
        status: "completed",
        version: 1,
        row_count: 10,
        column_count: 2,
        scan_mode: "full",
        random_seed: 42,
        is_approximate: false,
        narrative_report: "**Báo cáo hồ sơ dữ liệu**\n\n## Chất lượng\n- **email** có 1 giá trị thiếu.\n- Kiểm tra `null_pct` đã hoàn tất.\n- Uniqueness:\n- Invoice: 5.02%\n- StockCode: 0.497%\n- Outlier:\n- Quantity: 116,489",
        risk_warnings: [],
        quasi_identifiers: [],
        pending_proposals: 0,
        column_stats: {
          Category: { column_name: "Category", row_count: 10, top_k_values: [{ value: "A", count: 6 }, { value: "B", count: 4 }] },
          Amount: { column_name: "Amount", row_count: 10, top_k_values: [{ value: "10", count: 7 }, { value: "20", count: 3 }] },
        },
        correlation_matrix: { Amount: { Amount: 1, Category: 0.9 }, Category: { Amount: 0.9, Category: 1 } },
        proposals: { pii: [], candidate_key: [], semantic_type: [] },
        test_results: [],
      }),
    });
  });

  await page.goto("/profiles/run-ux-test", { waitUntil: "networkidle" });

  const report = page.locator(".report-markdown");
  await expect(report.locator("strong").first()).toHaveText("Báo cáo hồ sơ dữ liệu");
  await expect(report.locator("h3").first()).toHaveText("Chất lượng");
  await expect(report.locator(".report-markdown-list-section").nth(0)).toHaveText("Uniqueness");
  await expect(report.locator(".report-markdown-list-section").nth(1)).toHaveText("Outlier");
  await expect(report.locator(".report-markdown-list-detail").nth(0)).toHaveText("Invoice: 5.02%");
  await expect(report.locator(".report-markdown-list-detail").nth(2)).toHaveText("Quantity: 116,489");
  await expect(report).not.toContainText("**");
  await expect(report).not.toContainText("`");
  await expect(page.locator(".chart-bars .bar-row")).toHaveCount(4);
  await expect(page.locator(".chart-bars .bar-row").first()).toContainText("60");
  await expect(page.locator(".bar-fill").first()).toHaveCSS("display", "block");
  await expect(page.locator(".correlation-cell")).toHaveCount(1);
  await expect(page.locator(".correlation-legend")).toBeVisible();
  await expect(page.locator(".correlation-note")).toBeVisible();
});
