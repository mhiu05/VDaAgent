import { useEffect, useRef } from "react";
import type { ReportsService } from "../services/reports-service";

/** Re-reads on `report.updated` (doc 14 "Realtime"): a `reportId` of null re-reads for any
 * report (the reports list); otherwise only for that report (an open card or viewer). */
export function useReportRefresh(
  service: ReportsService,
  reportId: string | null,
  retry: () => void,
) {
  const latest = useRef(retry);
  useEffect(() => {
    latest.current = retry;
  }, [retry]);
  useEffect(
    () =>
      service.onChanged((changed) => {
        if (reportId === null || changed === reportId) latest.current();
      }),
    [service, reportId],
  );
}
