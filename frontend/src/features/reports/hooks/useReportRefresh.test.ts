// Re-reads on `report.updated` (doc 14 "Realtime"): the open viewer/card and the reports list.
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useReportRefresh } from "./useReportRefresh";
import type { ReportsService } from "../services/reports-service";

function fakeService() {
  const listeners = new Set<(id: string) => void>();
  return {
    service: {
      onChanged(listener: (id: string) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as ReportsService,
    emit: (id: string) => listeners.forEach((fn) => fn(id)),
  };
}

describe("useReportRefresh", () => {
  it("retries when its report changes and ignores other reports", () => {
    const { service, emit } = fakeService();
    const retry = vi.fn();
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useReportRefresh(service, id, retry),
      { initialProps: { id: "R7" as string | null } },
    );
    emit("R8");
    expect(retry).not.toHaveBeenCalled();
    emit("R7");
    expect(retry).toHaveBeenCalledTimes(1);
    rerender({ id: null });
    emit("R8");
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
