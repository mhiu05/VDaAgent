import type { WorkspaceActionV1 } from '@vda/contracts';
import { getRunArtifacts, getRunDecision, getRunDetail } from '../../analysis/api/run-data';
import { getReportDetail } from '../../reports/api/reports';

export async function rehydrateAction(orgId: string, action: WorkspaceActionV1) {
  switch (action.type) {
    case 'switch_capability_mode':
      return;
    case 'open_dashboard':
      if (action.report_id) {
        const detail = await getReportDetail(orgId, action.report_id);
        if (detail.report.run_id !== action.run_id) throw new Error('stale workspace action');
        return;
      }
      await getRunDetail(orgId, action.run_id);
      return;
    case 'open_evidence': {
      const bundle = await getRunArtifacts(orgId, action.run_id);
      if (!bundle.artifacts.some((artifact) => artifact.artifact_id === action.artifact_id))
        throw new Error('stale workspace action');
      return;
    }
    case 'focus_visual':
    case 'focus_priority_entity':
    case 'open_drilldown': {
      const response = await getRunDecision(orgId, action.run_id);
      if (response.status !== 'available') throw new Error('stale workspace action');
      const isPresent =
        action.type === 'focus_visual'
          ? response.decision_intelligence.visual_story.ordered_visuals.some(
              (visual) => visual.chart_id === action.chart_id,
            )
          : action.type === 'focus_priority_entity'
            ? response.decision_intelligence.priority_entities.some(
                (entity) => entity.priority_entity_id === action.priority_entity_id,
              )
            : response.decision_intelligence.drilldowns.some(
                (drilldown) => drilldown.drilldown_id === action.drilldown_id,
              );
      if (!isPresent) throw new Error('stale workspace action');
    }
  }
}
