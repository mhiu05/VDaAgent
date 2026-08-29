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
  await page.route("**/api/v1/profile/run-1/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile_run_id: "run-1", dataset_id: "dataset-1", dataset_name: "Sales", status: "completed", job_status: "succeeded", scan_mode: "full", row_count: 100, column_count: 2, warning_count: 0, pending_proposals: 0, next_action: "use_results" }) }));
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
  await expect(page.getByRole("link", { name: /Tạo biểu đồ & phân tích/ })).toHaveAttribute("href", "/charts?runId=run-1");
});

test("failed profiling job shows a safe summary without loading the full profile", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profile/run-failed/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile_run_id: "run-failed", dataset_id: "dataset-1", dataset_name: "Sales", status: "failed", job_status: "failed", scan_mode: "full", warning_count: 0, pending_proposals: 0, next_action: "retry" }) }));
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

  await expect(page.getByText("Profile chạy thất bại.")).toBeVisible();
  await expect(page.getByText("Hãy kiểm tra dataset rồi tạo một profile run mới.")).toBeVisible();
  await expect(page.getByText("Profiling could not process this dataset.")).toHaveCount(0);
  await expect(page.getByText(/stack trace|Traceback|database/i)).toHaveCount(0);
});

test("profile submission returns immediately and shows durable queued state", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profile/run-queued/summary", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile_run_id: "run-queued", dataset_id: "dataset-1", dataset_name: "Sales", status: "queued", job_status: "queued", scan_mode: "full", warning_count: 0, pending_proposals: 0, next_action: "wait" }) }));
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

test("legacy review route remains available as an inline-review fallback", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profile/review-fallback", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...profile,
      profile_run_id: "review-fallback",
      status: "pending_review",
      pending_proposals: 1,
      proposals: {
        pii: [{
          id: "proposal-pii-fallback", status: "pending", column_name: "email", pii_type: "email",
          confidence_score: 0.98, detection_method: "rule", evidence: "Email pattern",
        }],
      },
    }),
  }));

  await page.goto("/profiles/review-fallback/review");

  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Xác nhận tất cả" })).toBeVisible();
});

test("review confirmation hydrates the saved decision before returning to the detail", async ({ page }) => {
  await useAnalystWorkspace(page);
  let profileRequests = 0;
  let reviewSaved = false;
  let completed = false;
  let summaryRequests = 0;
  const reviewedProfile = {
    ...profile,
    profile_run_id: "review-run",
    status: "pending_review",
    pending_proposals: 1,
    proposals: {
      pii: [{
        id: "proposal-pii-1",
        status: "pending",
        column_name: "email",
        pii_type: "email",
        confidence_score: 0.98,
        detection_method: "rule",
        evidence: "Email pattern",
      }],
    },
  };

  await page.route("**/api/v1/profile/review-run/summary", async (route) => {
    summaryRequests += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile_run_id: "review-run", dataset_id: "dataset-1", dataset_name: "Sales", status: completed ? "completed" : reviewSaved ? "resuming" : "pending_review", job_status: completed ? "succeeded" : reviewSaved ? "queued" : "succeeded", scan_mode: "full", row_count: 100, column_count: 2, warning_count: 0, pending_proposals: reviewSaved || completed ? 0 : 1, next_action: completed ? "use_results" : reviewSaved ? "wait" : "review" }) });
  });

  await page.route("**/api/v1/profile/review-run/confirm", async (route) => {
    const request = route.request().postDataJSON() as { decisions?: Array<{ proposal_id: string; decision: string }> };
    expect(request.decisions).toEqual([{ kind: "pii", proposal_id: "proposal-pii-1", decision: "confirm" }]);
    reviewSaved = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        profile_run_id: "review-run",
        applied: 1,
        pending_proposals: 0,
        status: "resuming",
        proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] },
      }),
    });
  });
  await page.route("**/api/v1/profile/review-run", async (route) => {
    profileRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(completed
        ? { ...reviewedProfile, status: "completed", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }
        : reviewSaved
          // Exercise the guard independently of the transient domain status:
          // resolved proposals must never render a review action.
          ? { ...reviewedProfile, status: "pending_review", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }
          : reviewedProfile),
    });
  });
  await page.route("**/api/v1/profiling-jobs/review-run", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        job_id: "review-run",
        profiling_run_id: "review-run",
        dataset_id: "dataset-1",
        status: completed ? "succeeded" : reviewSaved ? "queued" : "succeeded",
        stage: completed ? "completed" : reviewSaved ? "resume_queued" : "completed",
        attempt_count: 1,
        created_at: new Date().toISOString(),
        duplicate: false,
      }),
    });
  });

  await page.goto("/profiles/review-run");
  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toBeVisible();
  await page.getByLabel("Quyết định").selectOption("confirm");
  await page.getByRole("button", { name: "Lưu quyết định & tiếp tục" }).click();

  await expect(page).toHaveURL(/\/profiles\/review-run$/);
  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toHaveCount(0);
  await expect(page.getByText("Đang tiếp tục profile sau review.")).toBeVisible();
  // The post-review profile is hydrated from the atomic PATCH snapshot; a
  // stale intermediate GET must not be required before navigation.
  expect(profileRequests).toBeGreaterThanOrEqual(1);
  // The Command Center owns progress through one lightweight summary query.
  expect(summaryRequests).toBeGreaterThanOrEqual(1);

  completed = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tạo biểu đồ & phân tích" })).toBeVisible();
});

test("review confirmation reconciles a committed decision when the first response races", async ({ page }) => {
  await useAnalystWorkspace(page);
  let saved = false;
  let patchAttempts = 0;
  await page.route("**/api/v1/profile/review-reconcile/summary", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ profile_run_id: "review-reconcile", dataset_id: "dataset-1", dataset_name: "Sales", status: saved ? "resuming" : "pending_review", job_status: "queued", scan_mode: "full", row_count: 100, column_count: 2, warning_count: 0, pending_proposals: saved ? 0 : 1, next_action: saved ? "wait" : "review" }) });
  });
  const reviewedProfile = {
    ...profile,
    profile_run_id: "review-reconcile",
    status: "pending_review",
    pending_proposals: 1,
    proposals: { pii: [{ id: "proposal-pii-reconcile", status: "pending", column_name: "email", pii_type: "email", confidence_score: 0.98, detection_method: "rule", evidence: "Email pattern" }] },
  };
  await page.route("**/api/v1/profile/review-reconcile/confirm", async (route) => {
    patchAttempts += 1;
    saved = true;
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Review khác đang resume run này." }) });
  });
  await page.route("**/api/v1/profile/review-reconcile", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(saved
      ? { ...reviewedProfile, status: "resuming", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }
      : reviewedProfile) });
  });
  await page.route("**/api/v1/profiling-jobs/review-reconcile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job_id: "review-reconcile", profiling_run_id: "review-reconcile", dataset_id: "dataset-1", status: "queued", stage: "resume_queued", attempt_count: 1, created_at: new Date().toISOString(), duplicate: false }),
  }));

  await page.goto("/profiles/review-reconcile");
  await page.getByRole("heading", { name: "Xác nhận metadata" }).waitFor();
  await page.getByLabel("Quyết định").selectOption("confirm");
  await page.getByRole("button", { name: "Lưu quyết định & tiếp tục" }).click();

  await expect(page).toHaveURL(/\/profiles\/review-reconcile$/);
  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toHaveCount(0);
  expect(patchAttempts).toBe(1);
});
