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
        summary: "One numeric drift signal detected.",
        findings: [{
          column_name: "net_revenue",
          drift_type: "numeric_shift",
          severity: "major",
          metric: "mean",
          baseline_value: 120,
          current_value: 220,
          psi: null,
          detail: "mean shifted from the baseline.",
        }],
      }),
    });
  });

  await page.goto("/compare", { waitUntil: "networkidle" });
  await expect(page.locator("#compare-baseline option")).toHaveCount(3);
  await expect(page.locator("#compare-baseline option[value='pending-run']")).toHaveCount(0);

  await page.locator("#compare-baseline").selectOption("baseline-run");
  await page.locator("#compare-current").selectOption("current-run");
  await page.getByRole("button", { name: "So sánh dữ liệu", exact: true }).click();

  await expect(page.getByText("One numeric drift signal detected.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "net_revenue" })).toBeVisible();
  await expect(page.getByText("220", { exact: true })).toBeVisible();
});
