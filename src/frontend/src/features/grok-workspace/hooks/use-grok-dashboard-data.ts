import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  ArtifactListSchema,
  DecisionIntelligenceResponseSchema,
  ReportDetailSchema,
} from '@vda/contracts';
import { ApiError } from '../../../lib/http/api-client';
import { getRunArtifacts, getRunDecision } from '../../analysis/api/run-data';
import { getReportDetail, listReports } from '../../reports/api/reports';
import type { WorkspaceContextState } from '../../workspace/context';

type ReportDetail = z.infer<typeof ReportDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;
type Decision = z.infer<typeof DecisionIntelligenceResponseSchema>;
type DashboardData = {
  detail: ReportDetail;
  bundle: ArtifactList;
  decision: Decision | null;
};

export function useGrokDashboardData(
  orgId: string,
  context: WorkspaceContextState,
  shouldLoad: boolean,
) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  useEffect(() => {
    const runId = context.active_run_id;
    if (!shouldLoad || !runId) {
      setData(null);
      setStatus('idle');
      return;
    }
    let obsolete = false;
    setData(null);
    setStatus('loading');
    void (async () => {
      try {
        let reportId = context.active_report_id;
        if (!reportId) {
          const reports = await listReports(orgId);
          reportId = reports.reports.find((report) => report.run_id === runId)?.report_id ?? null;
        }
        if (!reportId) throw new Error('report unavailable');
        const detail = await getReportDetail(orgId, reportId);
        if (detail.report.run_id !== runId || detail.artifact.kind !== 'report')
          throw new Error('report unavailable');
        const [bundle, decision] = await Promise.all([
          getRunArtifacts(orgId, runId),
          getRunDecision(orgId, runId).catch((cause: unknown) => {
            if (cause instanceof ApiError && cause.status === 404) return null;
            throw cause;
          }),
        ]);
        if (obsolete) return;
        setData({ detail, bundle, decision });
        setStatus('idle');
      } catch {
        if (!obsolete) {
          setData(null);
          setStatus('unavailable');
        }
      }
    })();
    return () => {
      obsolete = true;
    };
  }, [context.active_report_id, context.active_run_id, orgId, shouldLoad]);

  const currentData = data && data.detail.report.run_id === context.active_run_id ? data : null;
  return { data, status, currentData };
}
