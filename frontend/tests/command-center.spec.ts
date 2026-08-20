import { expect, test } from "@playwright/test";
import { useAnalystWorkspace } from "./workspace-fixture";

const profile = {
  profile_run_id: "run-1", dataset_id: "dataset-1", dataset_name: "Sales", run_name: "May full scan", version: 3,
  status: "completed", scan_mode: "full", is_approximate: false, row_count: 100, column_count: 2,
  pending_proposals: 0, risk_warnings: [], quasi_identifiers: [], narrative_report: null, correlation_matrix: {}, proposals: {},
  column_stats: { city: { column_name: "city", dtype: "string", row_count: 100, null_count: 0, null_pct: 0, cardinality: 2, uniqueness_ratio: 0.02 }, revenue: { column_name: "revenue", dtype: "float", row_count: 100, null_count: 0, null_pct: 0, cardinality: 100, uniqueness_ratio: 1, mean: 12 } },
};

test("Explorer deep-link keeps Preview separate from Official evidence", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profile/run-1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) }));
  await page.route("**/api/v1/profile/run-1/explorer/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "session-1", mode: "quick", status: "needs_context", goal: "Explore", context: { id: "context-1", status: "draft", context: { dimensions: ["city"], measures: ["revenue"], keys: [], ignored_columns: [], limitations: [] } } }) }));
  await page.route("**/api/v1/analysis-sessions/session-1/previews", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "preview-1", execution_kind: "preview", status: "ready", query_spec: { aggregate: "count", dimensions: [], filters: [], limit: 50, sort: "desc" }, result: { columns: ["value"], data: [{ value: 42 }], row_count: 1 }, result_hash: "a".repeat(64), limitations: ["Preview sample"], is_approximate: true, duration_ms: 10, query_summary: "Count rows" }) }));
  await page.route("**/api/v1/analysis-sessions/session-1/previews/preview-1/promote", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "official-1", execution_kind: "official", status: "ready", query_spec: { aggregate: "count", dimensions: [], filters: [], limit: 50, sort: "desc" }, result: { columns: ["value"], data: [{ value: 100 }], row_count: 1 }, result_hash: "b".repeat(64), limitations: [], is_approximate: false, duration_ms: 20, query_summary: "Count rows" }) }));

  await page.goto("/profiles/run-1?tab=explorer", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "Phân tích chuyên sâu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Phiên phân tích" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Khám phá" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Chạy preview" })).toBeVisible();
  await page.getByRole("button", { name: "Chạy preview" }).click();
  await expect(page.getByText("Preview result")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pin vào báo cáo" })).toBeDisabled();
  await page.getByRole("button", { name: "Xác nhận kết quả" }).click();
  await expect(page.getByText("Official result")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pin vào báo cáo" })).toBeEnabled();
  await page.getByRole("button", { name: "Giải thích" }).click();
  await expect(page.getByRole("tab", { name: "Hỏi Agent" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Đang giải thích execution official-1/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByPlaceholder("Đặt câu hỏi về Profile Run này…")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
