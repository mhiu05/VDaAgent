import { expect, test } from "@playwright/test";
import { useAnalystWorkspace } from "./workspace-fixture";

test("report detail does not show the redundant pinned-chart editor", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/reports/report-detail-test/export-source", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      profile: {
        run: { id: "run-report-detail-test", status: "completed", row_count: 10, column_count: 0, scan_mode: "full", created_at: new Date().toISOString(), risk_warnings: [], narrative_report: null },
        dataset: { name: "Sales" },
        drift_reports: [],
        column_stats: [],
        correlation_matrix: {},
      },
      report_snapshot: { title: "Sales report", items: [] },
    }),
  }));

  await page.goto("/reports/report-detail-test", { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: /Chỉnh sửa biểu đồ đã ghim/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Xuất báo cáo PDF/ })).toBeVisible();
});

test("report preview renders drift evidence values consistently", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/reports/report-drift-test/export-source", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      profile: {
        run: { id: "run-report-drift-test", status: "completed", row_count: 10, column_count: 2, scan_mode: "full", created_at: new Date().toISOString(), risk_warnings: [], narrative_report: null },
        dataset: { name: "Sales" },
        drift_reports: [{
          profile_run_id_a: "baseline-run",
          profile_run_id_b: "current-run",
          summary: "Revenue shifted.",
          drift_columns: [
            { column_name: "revenue", drift_type: "numeric_shift", severity: "major", psi: 0.12345, baseline_value: "10.1234", current_value: 20.98765, detail: "Mean increased." },
            { column_name: "revenue", drift_type: "null_rate_shift", severity: "minor", metric: "null_pct", baseline_value: null, current_value: 0.1, detail: "Missing values increased." },
          ],
        }],
        column_stats: [],
        correlation_matrix: {},
      },
      report_snapshot: { title: "Sales report", items: [] },
    }),
  }));

  await page.goto("/reports/report-drift-test", { waitUntil: "networkidle" });

  const driftSection = page.locator("#sec-drift");
  await expect(driftSection).toBeVisible();
  await expect(page.getByRole("heading", { name: "PHẦN 3: SO SÁNH DỮ LIỆU", exact: true })).toBeVisible();
  await expect(driftSection.getByText("PSI 0,123", { exact: true })).toHaveCount(2);
  await expect(driftSection.getByText("Tỷ lệ thiếu", { exact: true })).toHaveCount(1);
  await expect(page.getByText("10.1234", { exact: true })).toBeVisible();
  await expect(page.getByText("20,988", { exact: true })).toBeVisible();
  await expect(page.getByText("2 signal từ backend", { exact: true })).toBeVisible();
  await expect(driftSection.locator(".compare-severity-major")).toHaveCount(3);
});

test("report preview does not show an empty drift evidence table", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/reports/report-empty-drift-test/export-source", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      profile: {
        run: { id: "run-report-empty-drift-test", status: "completed", row_count: 10, column_count: 0, scan_mode: "full", created_at: new Date().toISOString(), risk_warnings: [], narrative_report: null },
        dataset: { name: "Sales" },
        drift_reports: [{ profile_run_id_a: "baseline-run", profile_run_id_b: "current-run", summary: "No material drift", drift_columns: [] }],
        column_stats: [],
        correlation_matrix: {},
      },
      report_snapshot: { title: "Sales report", items: [] },
    }),
  }));

  await page.goto("/reports/report-empty-drift-test", { waitUntil: "networkidle" });

  const driftSection = page.locator("#sec-drift");
  await expect(driftSection).toBeVisible();
  await expect(driftSection.locator(".report-drift-details .compare-table")).toHaveCount(0);
  await expect(driftSection.getByText("0 signal", { exact: true })).toBeVisible();
});
