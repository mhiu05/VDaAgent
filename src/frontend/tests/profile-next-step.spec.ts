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
  column_count: 3,
  pending_proposals: 0,
  risk_warnings: [],
  quasi_identifiers: [],
  narrative_report: "## Tổng quan\n\nDoanh thu ổn định trong sample kiểm thử.",
  executed_query: "SELECT * FROM sales",
  correlation_matrix: { revenue: { profit: 0.82 }, profit: { revenue: 0.82 } },
  proposals: {},
  column_stats: {
    city: { column_name: "city", dtype: "string", row_count: 100, null_count: 0, null_pct: 0, cardinality: 2, uniqueness_ratio: 0.02, top_k_values: [{ value: "Hanoi", count: 60 }, { value: "Danang", count: 40 }] },
    revenue: { column_name: "revenue", dtype: "float", row_count: 100, null_count: 0, null_pct: 0, cardinality: 100, uniqueness_ratio: 1, mean: 12, min_value: 1, max_value: 25, outlier_count: 2, top_k_values: [{ value: 12, count: 10 }] },
    profit: { column_name: "profit", dtype: "float", row_count: 100, null_count: 2, null_pct: 0.02, cardinality: 98, uniqueness_ratio: 0.98, mean: 4, min_value: 0, max_value: 10, outlier_count: 1 },
  },
};

test("completed profile review opens the report preview", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.route("**/api/v1/profile/run-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(profile),
  }));

  await page.goto("/profiles/run-1/review?tab=explorer", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/profiles\/run-1\/preview$/);
  await expect(page.getByRole("heading", { name: /Rủi ro & privacy/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Nguồn & cách tạo báo cáo/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Hồ sơ cột/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Tỷ lệ null theo cột/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Tỷ lệ unique theo cột/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Phân phối/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Tương quan/ })).toBeVisible();
  await page.locator("details.provenance-technical summary").click();
  await expect(page.getByText("SELECT * FROM sales", { exact: true })).toBeVisible();
  await expect(page.locator("#column_profiles").getByText("Hanoi", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tóm tắt từ Agent" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở biểu đồ & phân tích" })).toHaveAttribute("href", "/charts?runId=run-1");
});

test("failed profiling job shows a safe summary without loading the full profile", async ({ page }) => {
  await useAnalystWorkspace(page);
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

  await page.goto("/profiles/run-failed/review", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Profile chạy thất bại.")).toBeVisible();
  await expect(page.getByText("Hãy kiểm tra dataset và tạo một profile run mới.")).toBeVisible();
  await expect(page.getByText("Profiling could not process this dataset.")).toHaveCount(0);
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
  await page.route("**/api/v1/profile/run-queued", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...profile, profile_run_id: "run-queued", status: "queued", row_count: null, column_count: 0, pending_proposals: 0, column_stats: {}, proposals: {} }),
  }));

  await page.goto("/datasets/dataset-1/runs");
  await page.getByRole("button", { name: "Profiling phiên bản mới" }).click();
  await page.getByRole("button", { name: "Bắt đầu profiling" }).click();

  await expect(page).toHaveURL(/\/profiles\/run-queued\/review$/);
  await expect(page.getByText("Profiling đang được xử lý.", { exact: true })).toBeVisible();
});

test("review resume surfaces a worker failure instead of waiting forever", async ({ page }) => {
  await useAnalystWorkspace(page);
  let resumed = false;
  const reviewedProfile = {
    ...profile,
    profile_run_id: "review-failed",
    status: "pending_review",
    pending_proposals: 1,
    proposals: {
      pii: [{
        id: "proposal-pii-failed",
        status: "pending",
        column_name: "email",
        pii_type: "email",
        confidence_score: 0.98,
        detection_method: "rule",
        evidence: "Email pattern",
      }],
    },
  };

  await page.route("**/api/v1/profile/review-failed/confirm", async (route) => {
    resumed = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ profile_run_id: "review-failed", applied: 1, pending_proposals: 0, status: "resuming", proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }),
    });
  });
  await page.route("**/api/v1/profile/review-failed", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(resumed
        ? { ...reviewedProfile, status: "failed", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] }, error: "Resume workflow failed." }
        : reviewedProfile),
    });
  });

  await page.goto("/profiles/review-failed/review");
  await page.getByLabel("Quyết định").selectOption("confirm");
  await page.getByRole("button", { name: "Lưu quyết định & tiếp tục pipeline" }).click();

  await expect(page.getByRole("heading", { name: "Profiling chưa hoàn tất" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Profile chạy thất bại.")).toBeVisible();
});

test("review resume keeps polling when report generation outlives the watch warning", async ({ page }) => {
  await useAnalystWorkspace(page);
  await page.clock.install();
  let resumed = false;
  let workerDone = false;
  const reviewedProfile = {
    ...profile,
    profile_run_id: "review-slow-resume",
    status: "pending_review",
    pending_proposals: 1,
    proposals: {
      pii: [{
        id: "proposal-pii-slow-resume",
        status: "pending",
        column_name: "email",
        pii_type: "email",
        confidence_score: 0.98,
        detection_method: "rule",
        evidence: "Email pattern",
      }],
    },
  };

  await page.route("**/api/v1/profile/review-slow-resume/confirm", async (route) => {
    resumed = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ profile_run_id: "review-slow-resume", applied: 1, pending_proposals: 0, status: "resuming", proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }),
    });
  });
  await page.route("**/api/v1/profile/review-slow-resume", async (route) => {
    const completed = workerDone && resumed;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(completed
        ? { ...reviewedProfile, status: "completed", narrative_report: "Profile ready", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }
        : resumed
          ? { ...reviewedProfile, status: "resuming", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }
          : reviewedProfile),
    });
  });

  await page.goto("/profiles/review-slow-resume/review");
  await page.getByLabel("Quyết định").selectOption("confirm");
  await page.getByRole("button", { name: "Lưu quyết định & tiếp tục pipeline" }).click();
  await expect(page.getByRole("heading", { name: "Đang tiếp tục profiling" })).toBeVisible();

  await page.clock.fastForward(30 * 60_000 + 1);
  await expect(page.getByText("Worker chưa hoàn tất báo cáo trong thời gian chờ.", { exact: false })).toBeVisible();

  workerDone = true;
  await page.clock.runFor(10_000);
  await expect(page).toHaveURL(/\/profiles\/review-slow-resume\/preview$/);
});

test("review route shows pending metadata proposals", async ({ page }) => {
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

test("review confirmation hydrates the saved decision before opening analysis", async ({ page }) => {
  await useAnalystWorkspace(page);
  let profileRequests = 0;
  let reviewSaved = false;
  let completed = false;
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

  await page.route("**/api/v1/profile/review-run/confirm", async (route) => {
    const request = route.request().postDataJSON() as { decisions?: Array<{ proposal_id: string; decision: string }> };
    expect(request.decisions).toEqual([{ kind: "pii", proposal_id: "proposal-pii-1", decision: "confirm" }]);
    reviewSaved = true;
    completed = true;
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
        ? { ...reviewedProfile, status: "completed", narrative_report: "Profile ready", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }
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

  await page.goto("/profiles/review-run/review");
  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toBeVisible();
  await page.getByLabel("Quyết định").selectOption("confirm");
  await page.getByRole("button", { name: "Lưu quyết định & tiếp tục" }).click();

  await expect(page).toHaveURL(/\/profiles\/review-run\/preview$/);
  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tóm tắt từ Agent" })).toBeVisible();
  // The post-review profile is hydrated from the atomic PATCH snapshot before
  // the app opens the analysis workspace.
  expect(profileRequests).toBeGreaterThanOrEqual(1);
});

test("review confirmation reconciles a committed decision when the first response races", async ({ page }) => {
  await useAnalystWorkspace(page);
  let saved = false;
  let patchAttempts = 0;
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
      ? { ...reviewedProfile, status: "completed", narrative_report: "Profile ready", pending_proposals: 0, proposals: { pii: [{ ...reviewedProfile.proposals.pii[0], status: "confirmed" }] } }
      : reviewedProfile) });
  });
  await page.route("**/api/v1/profiling-jobs/review-reconcile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job_id: "review-reconcile", profiling_run_id: "review-reconcile", dataset_id: "dataset-1", status: "queued", stage: "resume_queued", attempt_count: 1, created_at: new Date().toISOString(), duplicate: false }),
  }));

  await page.goto("/profiles/review-reconcile/review");
  await page.getByRole("heading", { name: "Xác nhận metadata" }).waitFor();
  await page.getByLabel("Quyết định").selectOption("confirm");
  await page.getByRole("button", { name: "Lưu quyết định & tiếp tục" }).click();

  await expect(page).toHaveURL(/\/profiles\/review-reconcile\/preview$/);
  await expect(page.getByRole("heading", { name: "Xác nhận metadata" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mở biểu đồ phân tích" })).toHaveAttribute("href", "/charts?runId=review-reconcile");
  expect(patchAttempts).toBe(1);
});
