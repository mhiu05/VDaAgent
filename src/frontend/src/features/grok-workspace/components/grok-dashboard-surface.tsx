'use client';

import { type ArtifactOf, type DashboardSelection } from '@vda/contracts';
import { useGrokDashboardData } from '../hooks/use-grok-dashboard-data';
import { ReportDashboard } from '../../reports/dashboard/report-dashboard';
import {
  toDashboardViewSelection,
  toWorkspaceDashboardSelection,
} from '../../reports/dashboard/selection';
import type { WorkspaceContextState } from '../../workspace/context';

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
  const shouldLoad =
    (context.mode === 'report' || context.mode === 'chart' || context.mode === 'insight') &&
    (context.active_report_id !== null ||
      context.active_dashboard_selection !== null ||
      context.active_drilldown_id !== null ||
      (context.mode === 'report' && context.active_run_id !== null));

  const { data, status, currentData } = useGrokDashboardData(orgId, context, shouldLoad);
  if (!shouldLoad) return null;
  if (status === 'loading' || (data !== null && currentData === null))
    return (
      <section className="card grok-dashboard-state" role="status">
        Đang tải tổng quan đã xác thực…
      </section>
    );
  if (!currentData || currentData.detail.artifact.kind !== 'report')
    return (
      <section className="card grok-dashboard-state" role="status">
        Tổng quan đã chọn hiện không khả dụng.
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
