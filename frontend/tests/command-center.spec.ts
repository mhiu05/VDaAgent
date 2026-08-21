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
  let promotedContextId = "";
  let promotionAttempts = 0;
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("status of 409")) consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profile/run-1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) }));
  await page.route("**/api/v1/profile/run-1/explorer/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "session-1", mode: "quick", status: "needs_context", goal: "Explore", context: { id: "context-1", status: "draft", context: { dimensions: ["city"], measures: ["revenue"], keys: [], ignored_columns: [], limitations: [] } } }) }));
  await page.route("**/api/v1/profile/run-1/explorer/previews", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "preview-1", context_version_id: "context-preview-1", execution_kind: "preview", status: "ready", query_spec: { aggregate: "count", dimensions: [], filters: [], limit: 50, sort: "desc" }, result: { columns: ["value"], data: [{ value: 42 }], row_count: 1 }, result_hash: "a".repeat(64), limitations: ["Preview sample"], is_approximate: true, duration_ms: 10, query_summary: "Count rows" }) }));
  await page.route("**/api/v1/profile/run-1/explorer/previews/preview-1/promote", async (route) => {
    promotedContextId = JSON.parse(route.request().postData() || "{}").expected_context_version_id;
    promotionAttempts += 1;
    if (promotionAttempts === 1) {
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "context_stale: reload Explorer and confirm the latest context" }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "official-1", context_version_id: "context-preview-1", execution_kind: "official", status: "ready", query_spec: { aggregate: "count", dimensions: [], filters: [], limit: 50, sort: "desc" }, result: { columns: ["value"], data: [{ value: 100 }], row_count: 1 }, result_hash: "b".repeat(64), limitations: [], is_approximate: false, duration_ms: 20, query_summary: "Count rows" }) });
  });
  await page.route("**/api/v1/qa/stream", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `event: token
data: {"text":"Giải thích tự động đã hoàn tất."}

event: done
data: {"agent_run_id":"agent-1","evidence_status":"verified","analysis_execution_id":"official-1"}

`,
  }));

  await page.goto("/profiles/run-1?tab=explorer", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "Phân tích chuyên sâu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Phiên phân tích" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Khám phá" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Chạy preview" })).toBeVisible();
  await page.getByRole("button", { name: "Chạy preview" }).click();
  await expect(page.getByRole("heading", { name: "Kết quả xem trước" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nhân bản Preview" })).toHaveCount(0);
  await expect(page.getByText(/Bước tiếp theo: Chỉnh Aggregate/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ghim vào báo cáo" })).toBeDisabled();
  await page.getByRole("button", { name: "Chạy kết quả chính thức" }).click();
  await expect(page.locator(".command-promote-error")).toBeVisible();
  await expect(page.locator(".command-promote-error")).toHaveText(/Chưa thể chạy kết quả chính thức/);
  expect(promotedContextId).toBe("context-preview-1");
  const previewBounds = await page.locator(".command-result").boundingBox();
  const errorBounds = await page.locator(".command-promote-error").boundingBox();
  expect(errorBounds?.x).toBe(previewBounds?.x);
  expect(errorBounds?.width).toBe(previewBounds?.width);
  await page.locator(".command-promote-error").getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Kết quả chính thức" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ghim vào báo cáo" })).toBeEnabled();
  await page.getByRole("button", { name: "Giải thích" }).click();
  await expect(page.getByRole("tab", { name: "Hỏi Agent" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Giải thích tự động đã hoàn tất.")).toBeVisible();
  const composer = page.getByPlaceholder("Đặt câu hỏi về Profile Run này…");
  await composer.fill("Dòng một");
  await composer.press("Shift+Enter");
  await composer.type("Dòng hai");
  await expect(composer).toHaveValue(/Dòng một\s+Dòng hai/);
  await composer.press("Enter");
  await expect(page.locator(".agent-message.user").filter({ hasText: "Dòng một" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByPlaceholder("Đặt câu hỏi về Profile Run này…")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
