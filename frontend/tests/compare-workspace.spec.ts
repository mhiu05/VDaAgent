import { expect, test } from "@playwright/test";

import { useAnalystWorkspace } from "./workspace-fixture";

test("analyst compares two completed Profile Runs through the drift API", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/datasets", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([
      { id: "dataset-base", name: "Sales January", source_type: "file", source_ref: null, collection_name: null, last_profiled_at: null },
      { id: "dataset-current", name: "Sales February", source_type: "file", source_ref: null, collection_name: null, last_profiled_at: null },
    ]),
  }));
  await page.route("**/api/v1/datasets/dataset-base/runs", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([
      { id: "baseline-run", dataset_id: "dataset-base", run_name: "January full scan", version: 1, status: "completed", scan_mode: "full", row_count: 100, is_approximate: false, created_at: "2026-01-12T10:00:00Z" },
      { id: "pending-run", dataset_id: "dataset-base", run_name: "Pending scan", version: 2, status: "running", scan_mode: "sample", row_count: null, is_approximate: false, created_at: "2026-02-01T10:00:00Z" },
    ]),
  }));
  await page.route("**/api/v1/datasets/dataset-current/runs", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([
      { id: "current-run", dataset_id: "dataset-current", run_name: "February full scan", version: 1, status: "completed", scan_mode: "full", row_count: 120, is_approximate: false, created_at: "2026-02-12T10:00:00Z" },
    ]),
  }));
  await page.route("**/api/v1/profile/current-run/drift", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ baseline_run_id: "baseline-run" });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        baseline_run_id: "baseline-run",
        current_run_id: "current-run",
        summary: "Three drift signals detected.",
        findings: [{
          column_name: "net_revenue",
          drift_type: "numeric_shift",
          severity: "major",
          metric: "mean",
          baseline_value: 120,
          current_value: 220,
          psi: null,
          detail: "mean shifted from the baseline.",
        }, {
          column_name: "net_revenue",
          drift_type: "null_rate_shift",
          severity: "minor",
          metric: "null_pct",
          baseline_value: 0,
          current_value: 10,
          psi: null,
          detail: "null shifted from the baseline.",
        }, {
          column_name: "region",
          drift_type: "column_added",
          severity: "minor",
          metric: null,
          baseline_value: null,
          current_value: null,
          psi: null,
          detail: "new column appeared.",
        }],
      }),
    });
  });

  await page.goto("/compare", { waitUntil: "networkidle" });
  const finalReportLink = page.locator(".workspace-page-header .page-action a[href='/reports']");
  await expect(finalReportLink).toHaveCount(1);
  await expect(finalReportLink).toHaveAttribute("aria-label", "Đi đến báo cáo cuối cùng");
  await expect(page.locator("#compare-baseline option")).toHaveCount(3);
  await expect(page.locator("#compare-baseline option[value='pending-run']")).toHaveCount(0);

  await page.locator("#compare-baseline").selectOption("baseline-run");
  await page.locator("#compare-current").selectOption("current-run");
  await page.getByRole("button", { name: "So sánh dữ liệu", exact: true }).click();

  await expect(page.getByText("Three drift signals detected.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "net_revenue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "region" })).toBeVisible();
  await expect(page.getByText("220", { exact: true })).toBeVisible();
  await expect(page.locator(".compare-detail-panel")).toHaveCount(2);
  await expect(page.locator(".compare-summary-grid article b").nth(0)).toHaveText("1");
  await expect(page.locator(".compare-summary-grid article b").nth(1)).toHaveText("2");
});
