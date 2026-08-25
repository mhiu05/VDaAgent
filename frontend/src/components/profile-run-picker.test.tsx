import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileRunPicker } from "./profile-run-picker";

const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listDatasets: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock("@/lib/api", () => api);

const dataset = { id: "dataset-a", name: "Doanh thu", source_type: "file", source_ref: null, collection_name: null, last_profiled_at: null };
const run = { id: "run-a", dataset_id: dataset.id, run_name: "Tháng 1", version: 1, status: "completed", scan_mode: "full", row_count: 100, is_approximate: false, created_at: "2026-01-12T10:00:00Z" };

describe("ProfileRunPicker", () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.getProfile.mockReset();
    api.listDatasets.mockReset();
    api.listRuns.mockReset();
  });

  it("uses the shared dataset, profile, and run caches without another loading request", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["datasets"], [dataset]);
    queryClient.setQueryData(["profile", run.id], { dataset_id: dataset.id });
    queryClient.setQueryData(["runs", dataset.id], [run]);

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ProfileRunPicker id="chart-profile-run" label="Dataset" value={run.id} onChange={() => {}} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect((container.querySelector("#chart-profile-run-dataset") as HTMLSelectElement).value).toBe(dataset.id));
    expect((container.querySelector("#chart-profile-run") as HTMLSelectElement).value).toBe(run.id);
    expect(api.listDatasets).not.toHaveBeenCalled();
    expect(api.getProfile).not.toHaveBeenCalled();
    expect(api.listRuns).not.toHaveBeenCalled();
  });
});
