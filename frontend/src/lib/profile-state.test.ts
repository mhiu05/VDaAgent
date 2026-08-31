import { describe, expect, it } from "vitest";
import { deriveCommandCenterState, newestProfileSummary } from "@/lib/profile-state";
import type { ProfileSummary } from "@/lib/types";

const summary = (overrides: Partial<ProfileSummary> = {}): ProfileSummary => ({
  profile_run_id: "run-1", dataset_id: "dataset-1", status: "queued", job_status: "queued",
  warning_count: 0, pending_proposals: 0, next_action: "wait", ...overrides,
});

describe("deriveCommandCenterState", () => {
  it("maps queued to profiling and review checkpoints centrally", () => {
    expect(deriveCommandCenterState(summary())).toBe("queued");
    expect(deriveCommandCenterState(summary({ status: "running", job_status: "running" }))).toBe("profiling");
    expect(deriveCommandCenterState(summary({ status: "pending_review", job_status: "succeeded", pending_proposals: 2 }))).toBe("review_required");
    expect(deriveCommandCenterState(summary({ status: "running", job_status: "succeeded" }))).toBe("profiling");
    expect(deriveCommandCenterState(summary({ status: "running", pending_proposals: 2 }))).toBe("profiling");
  });

  it("maps review continuation through ready and failed", () => {
    expect(deriveCommandCenterState(summary({ status: "resuming", job_status: "queued" }))).toBe("resuming");
    expect(deriveCommandCenterState(summary({ status: "completed", job_status: "succeeded" }))).toBe("ready");
    expect(deriveCommandCenterState(summary({ status: "failed", job_status: "failed" }))).toBe("failed");
  });

  it("does not let a late poll overwrite an SSE milestone", () => {
    const resuming = summary({ status: "resuming", job_status: "queued", pending_proposals: 0 });
    expect(newestProfileSummary(resuming, summary({ status: "queued", job_status: "queued" }))).toBe(resuming);
    const failed = summary({ status: "failed", job_status: "failed" });
    expect(newestProfileSummary(resuming, failed)).toBe(failed);
  });
});
