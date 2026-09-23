'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  ArtifactListSchema,
  DecisionIntelligenceResponseSchema,
  ReportDetailSchema,
  ReportRecordSchema,
  type ArtifactOf,
  type DashboardSelection,
} from '@vda/contracts';
import { ApiError, api, scoped } from '../lib/client-api';
import { ReportDashboard } from './report-dashboard';
import {
  toDashboardViewSelection,
  toWorkspaceDashboardSelection,
} from './workspace-dashboard-selection';
import type { WorkspaceContextState } from './workspace-context';

type ReportDetail = z.infer<typeof ReportDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;
type Decision = z.infer<typeof DecisionIntelligenceResponseSchema>;
type DashboardData = {
  detail: ReportDetail;
  bundle: ArtifactList;
  decision: Decision | null;
};

export function GrokDashboardSurface({
  orgId,
  context,
  onSelectionChange,
  onOpenEvidence,
  onAskGrok,
}: {
  orgId: string;
  context: WorkspaceContextState;
  onSelectionChange: (selection: DashboardSelection | null, runId: string) => void;
  onOpenEvidence: (artifactId: string, runId: string) => void;
  onAskGrok: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const shouldLoad =
    (context.mode === 'report' || context.mode === 'chart' || context.mode === 'insight') &&
    (context.active_report_id !== null ||
      context.active_dashboard_selection !== null ||
      context.active_drilldown_id !== null ||
      (context.mode === 'report' && context.active_run_id !== null));

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
          const reports = await api(
            scoped('/reports', orgId),
            z.object({ reports: z.array(ReportRecordSchema) }),
          );
          reportId = reports.reports.find((report) => report.run_id === runId)?.report_id ?? null;
        }
        if (!reportId) throw new Error('report unavailable');
        const detail = await api(scoped('/reports/' + reportId, orgId), ReportDetailSchema);
        if (detail.report.run_id !== runId || detail.artifact.kind !== 'report')
          throw new Error('report unavailable');
        const [bundle, decision] = await Promise.all([
          api(scoped('/runs/' + runId + '/artifacts', orgId), ArtifactListSchema),
          api(
            scoped('/runs/' + runId + '/decision-intelligence', orgId),
            DecisionIntelligenceResponseSchema,
          ).catch((cause: unknown) => {
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

  if (!shouldLoad) return null;
  const currentData = data && data.detail.report.run_id === context.active_run_id ? data : null;
  if (status === 'loading' || (data !== null && currentData === null))
    return (
      <section className="card grok-dashboard-state" role="status">
        Loading the authorized dashboard…
      </section>
    );
  if (!currentData || currentData.detail.artifact.kind !== 'report')
    return (
      <section className="card grok-dashboard-state" role="status">
        The selected dashboard is unavailable.
      </section>
    );

  const visualEvidence = currentData.bundle.artifacts.find(
    (artifact): artifact is ArtifactOf<'visual_evidence'> => artifact.kind === 'visual_evidence',
  )?.payload;
  return (
    <section className="grok-dashboard-surface" aria-label="Authorized dashboard">
      <ReportDashboard
        payload={currentData.detail.artifact.payload}
        dataAsOf={currentData.detail.artifact.data_as_of}
        decision={currentData.decision}
        visualEvidence={visualEvidence}
        selection={
          context.active_dashboard_selection
            ? toDashboardViewSelection(context.active_dashboard_selection)
            : null
        }
        activeDrilldownId={context.active_drilldown_id}
        onAskGrok={onAskGrok}
        onSelectionChange={(selection) =>
          onSelectionChange(
            selection ? toWorkspaceDashboardSelection(selection) : null,
            currentData.detail.report.run_id,
          )
        }
        onEvidence={(artifactId) => {
          if (currentData.bundle.artifacts.some((artifact) => artifact.artifact_id === artifactId))
            onOpenEvidence(artifactId, currentData.detail.report.run_id);
        }}
      />
    </section>
  );
}
