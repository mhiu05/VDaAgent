import { expect, test } from "@playwright/test";
import { useAnalystWorkspace } from "./workspace-fixture";

const profile = {
  profile_run_id: "run-1",
  dataset_id: "dataset-1",
  dataset_name: "Sales",
  run_name: "May full scan",
  version: 3,
  status: "completed",
  scan_mode: "full",
  is_approximate: false,
  row_count: 100,
  column_count: 2,
  pending_proposals: 0,
  risk_warnings: [],
  quasi_identifiers: [],
  narrative_report: null,
  correlation_matrix: {},
  proposals: {},
  column_stats: {
    city: { column_name: "city", dtype: "string", row_count: 100, null_count: 0, null_pct: 0, cardinality: 2, uniqueness_ratio: 0.02 },
    revenue: { column_name: "revenue", dtype: "float", row_count: 100, null_count: 0, null_pct: 0, cardinality: 100, uniqueness_ratio: 1, mean: 12 },
  },
};

test("completed profile routes analysis through the chart workspace", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profiling-jobs/run-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job_id: "run-1", profiling_run_id: "run-1", dataset_id: "dataset-1", status: "succeeded", stage: "completed", attempt_count: 1, created_at: new Date().toISOString(), result_id: "run-1", duplicate: false }),
  }));
  await page.route("**/api/v1/profile/run-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(profile),
  }));

  await page.goto("/profiles/run-1?tab=explorer", { waitUntil: "networkidle" });

  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tạo biểu đồ & phân tích" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Tạo biểu đồ & phân tích/ })).toHaveAttribute("href", "/charts");
});

test("failed profiling job shows only its safe persisted error", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profiling-jobs/run-failed", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      job_id: "run-failed",
      profiling_run_id: "run-failed",
      dataset_id: "dataset-1",
      status: "failed",
      stage: "failed",
      attempt_count: 1,
      created_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error: { code: "invalid_dataset", message: "Profiling could not process this dataset." },
      duplicate: false,
    }),
  }));
  await page.route("**/api/v1/profile/run-failed", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...profile,
      profile_run_id: "run-failed",
      status: "failed",
      version: 4,
      row_count: null,
      column_count: 0,
      pending_proposals: 0,
      column_stats: {},
      proposals: {},
      error: "Profiling could not process this dataset.",
    }),
  }));

  await page.goto("/profiles/run-failed", { waitUntil: "networkidle" });

  await expect(page.getByText("Profiling không hoàn thành.")).toBeVisible();
  await expect(page.getByText("Profiling could not process this dataset.").first()).toBeVisible();
  await expect(page.getByText(/stack trace|Traceback|database/i)).toHaveCount(0);
});

test("profile submission returns immediately and shows durable queued state", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/datasets/dataset-1/runs", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]",
  }));
  await page.route("**/api/v1/profile", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ job_id: "run-queued", profiling_run_id: "run-queued", dataset_id: "dataset-1", status: "queued", stage: "queued", attempt_count: 0, created_at: new Date().toISOString(), duplicate: false }),
    });
  });
  await page.route("**/api/v1/profiling-jobs/run-queued", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job_id: "run-queued", profiling_run_id: "run-queued", dataset_id: "dataset-1", status: "queued", stage: "queued", attempt_count: 0, created_at: new Date().toISOString(), duplicate: false }),
  }));
  await page.route("**/api/v1/profile/run-queued", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...profile, profile_run_id: "run-queued", status: "queued", row_count: null, column_count: 0, pending_proposals: 0, column_stats: {}, proposals: {} }),
  }));

  await page.goto("/datasets/dataset-1/runs");
  await page.getByRole("button", { name: "Profiling phiên bản mới" }).click();
  await page.getByRole("button", { name: "Bắt đầu profiling" }).click();

  await expect(page).toHaveURL(/\/profiles\/run-queued$/);
  await expect(page.getByText("Profiling đã được xếp hàng.")).toBeVisible();
});
