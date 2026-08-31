import { expect, test } from "@playwright/test";
import { useAnalystWorkspace } from "./workspace-fixture";

const runId = "run-pin-optimistic";
const chartState = {
  id: "chart-pin-optimistic",
  question: "Doanh thu theo khu vực",
  problem: "compare",
  algorithm: "sum",
  x_column: "region",
  y_column: "revenue",
  second_dimension: "",
  time_grain: "",
  date_from: "",
  date_to: "",
  forecast_horizon: 12,
  season_length: 12,
  chart_type: "bar",
  renderer: "native-css",
  title: "Doanh thu theo khu vực",
  status: "official",
  generated: true,
  execution: {
    id: "execution-pin-optimistic",
    context_version_id: "context-pin-optimistic",
    query_spec: { analysis_kind: "aggregate", aggregate: "sum", column: "revenue", dimensions: ["region"], filters: [], limit: 50, sort: "desc" },
    result: { data: [{ region: "North", value: 120 }], columns: ["region", "value"], row_count: 1 },
    result_hash: "hash-pin-optimistic",
    limitations: [],
    is_approximate: false,
    execution_kind: "official",
    query_summary: "Sum revenue by region",
  },
  insight: "North leads revenue.",
  insight_reviewed: false,
  pin_idempotency_key: "pin-key-optimistic",
  pinned: false,
};

const profile = {
  profile_run_id: runId,
  dataset_id: "dataset-pin-optimistic",
  dataset_name: "Sales",
  run_name: "Pin optimistic UI",
  version: 1,
  status: "completed",
  scan_mode: "full",
  is_approximate: false,
  row_count: 10,
  column_count: 2,
  pending_proposals: 0,
  risk_warnings: [],
  quasi_identifiers: [],
  narrative_report: null,
  correlation_matrix: {},
  proposals: {},
  column_stats: {
    region: { column_name: "region", dtype: "string", row_count: 10, null_count: 0, null_pct: 0, cardinality: 2, uniqueness_ratio: 0.2 },
    revenue: { column_name: "revenue", dtype: "float", row_count: 10, null_count: 0, null_pct: 0, cardinality: 10, uniqueness_ratio: 1, mean: 120 },
  },
};

async function setupChartsPage(page: Parameters<typeof useAnalystWorkspace>[0]) {
  await useAnalystWorkspace(page);
  await page.addInitScript(({ state }) => {
    window.localStorage.setItem("p170_charts_state_run-pin-optimistic", JSON.stringify([state]));
  }, { state: chartState });

  await page.route("**/api/v1/datasets", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "dataset-pin-optimistic", name: "Sales" }]),
  }));
  await page.route("**/api/v1/datasets/dataset-pin-optimistic/runs", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: runId, run_name: "Pin optimistic UI", version: 1, status: "completed", scan_mode: "full", row_count: 10, created_at: new Date().toISOString() }]),
  }));
  await page.route(`**/api/v1/profile/${runId}`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(profile),
  }));
  await page.route(`**/api/v1/profile/${runId}/explorer/session`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "session-pin-optimistic",
      mode: "deep",
      status: "ready",
      goal: "chart",
      context: { id: "context-pin-optimistic", version: 1, status: "approved", context: { dimensions: ["region"], measures: ["revenue"], keys: [], ignored_columns: [], limitations: [] } },
    }),
  }));
  await page.route(`**/api/v1/profile/${runId}/charts/algorithms`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ algorithms: [] }),
  }));
  await page.route(`**/api/v1/profile/${runId}/report-draft`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "report-draft-optimistic", title: "Sales report", profile_run_id: runId, status: "draft", draft_version: 1, version_id: "version-1", items: [], stale_reasons: [] }),
  }));
}

test("shows optimistic pin progress before the report request finishes", async ({ page }) => {
  await setupChartsPage(page);
  let pinRequestStarted = false;
  let releasePinRequest!: () => void;
  const pinRequestHeld = new Promise<void>((resolve) => { releasePinRequest = resolve; });
  await page.route("**/api/v1/reports/report-draft-optimistic/items", async (route) => {
    pinRequestStarted = true;
    await pinRequestHeld;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "report-draft-optimistic", title: "Sales report", profile_run_id: runId, status: "draft", draft_version: 2, version_id: "version-2", items: [{ id: "item-1", item_type: "chart", position: 0 }], stale_reasons: [] }),
    });
  });

  await page.goto(`/charts?runId=${runId}`, { waitUntil: "networkidle" });
  const pinButton = page.locator(".chart-pin-button");
  await expect(pinButton).toBeVisible();
  await pinButton.click();

  await expect.poll(() => pinRequestStarted).toBe(true);
  await expect(page.locator(".workspace-action-progress")).toBeVisible();
  await expect(page.locator(".chart-pin-status.pending")).toHaveText(/Đang ghim/);
  await expect(page.locator(".chart-pin-button")).toHaveCount(0);

  releasePinRequest();
  await expect(page.locator(".chart-pin-status.confirmed")).toHaveText(/Đã ghim vào Báo cáo/);
});

test("rolls back the optimistic pin when the report request fails", async ({ page }) => {
  await setupChartsPage(page);
  let releasePinRequest!: () => void;
  const pinRequestHeld = new Promise<void>((resolve) => { releasePinRequest = resolve; });
  await page.route("**/api/v1/reports/report-draft-optimistic/items", async (route) => {
    await pinRequestHeld;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Report service unavailable" }),
    });
  });

  await page.goto(`/charts?runId=${runId}`, { waitUntil: "networkidle" });
  await page.locator(".chart-pin-button").click();
  await expect(page.locator(".chart-pin-status.pending")).toBeVisible();
  releasePinRequest();
  await expect(page.locator(".chart-pin-button")).toBeVisible();
  await expect(page.locator(".chart-pin-status")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText("Report service unavailable");
});
