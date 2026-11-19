// The reports list re-reads on `report.updated` (doc 14 "Realtime"): the SSE event reaches the
// page through the reports service and refetches the list.
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { App } from "../src/app/App";
import { createMockServices } from "../src/app/services/create-mock-services";
import type { ReportsService } from "../src/features/reports/services/reports-service";

describe("reports list refresh", () => {
  it("re-reads the list when a report updates", async () => {
    const services = createMockServices();
    await services.auth.login("user@vdaagent.test", "DemoUser!2026");
    const reports = services.workspace.reports as ReportsService;
    const list = vi.spyOn(reports, "list");
    const listeners = new Set<(id: string) => void>();
    reports.onChanged = (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    };
    history.replaceState({}, "", "/reports");
    render(<App services={services} />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0));
    const before = list.mock.calls.length;
    listeners.forEach((fn) => fn("R7"));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });
});
