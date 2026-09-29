import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { ReportDetailSchema, type DecisionIntelligenceResponse } from '@vda/contracts';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import { getRunArtifacts, getRunDecision } from '../../analysis/api/run-data';
import type { useAnalysisRun } from '../../analysis/hooks/use-analysis-run';
import { workspaceRouteHref, type WorkspaceSurface } from '../../../components/shell/routes';
import { getReportDetail, listReports, requestReportExport } from '../api/reports';

type ReportDetail = z.infer<typeof ReportDetailSchema>;

export function useWorkspaceReport(
  orgId: string,
  runId: string | null,
  setBundle: ReturnType<typeof useAnalysisRun>['setBundle'],
  setDecision: Dispatch<SetStateAction<DecisionIntelligenceResponse | null>>,
  setTab: Dispatch<SetStateAction<WorkspaceSurface>>,
  setBusy: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<string>>,
) {
  const router = useRouter();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const openReport = useCallback(
    async (id: string, navigate = true) => {
      setBusy(true);
      setError('');
      setDecision(null);
      try {
        const detail = await getReportDetail(orgId, id);
        const [nextBundle, nextDecision] = await Promise.all([
          getRunArtifacts(orgId, detail.report.run_id),
          getRunDecision(orgId, detail.report.run_id).catch((cause: unknown) => {
            if (cause instanceof ApiError && cause.status === 404) return null;
            throw cause;
          }),
        ]);
        setBundle(nextBundle);
        setDecision(nextDecision);
        setReport(detail);
        setTab('reports');
        if (navigate) router.push(workspaceRouteHref({ page: 'reports', reportId: id }, orgId));
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [orgId, router, setBundle, setDecision, setTab, setBusy, setError],
  );
  async function openRunReport() {
    setBusy(true);
    setError('');
    try {
      const { reports } = await listReports(orgId);
      const found = reports.find((item) => item.run_id === runId);
      if (!found) throw new Error('Báo cáo chưa được xuất bản. Hãy thử lại sau.');
      await openReport(found.report_id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function exportReport(format: 'json' | 'csv') {
    if (!report) return;
    setBusy(true);
    setError('');
    try {
      const exported = await requestReportExport(orgId, report.report.report_id, format);
      const anchor = document.createElement('a');
      anchor.href = exported.url;
      anchor.download = `report-${report.report.report_id}.${format}`;
      anchor.rel = 'noopener';
      anchor.click();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return { report, setReport, openReport, openRunReport, exportReport };
}
