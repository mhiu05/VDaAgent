import type { DashboardSelection as WorkspaceDashboardSelection } from '@vda/contracts';
import type {
  DashboardSelection as DashboardViewSelection,
  ReportDashboardModel,
} from './report-dashboard-model';

export function toWorkspaceDashboardSelection(
  selection: DashboardViewSelection,
): WorkspaceDashboardSelection {
  switch (selection.kind) {
    case 'kpi':
      return { kind: 'kpi', kpi_id: selection.id };
    case 'chart':
      return { kind: 'chart', chart_id: selection.id };
    case 'priority':
      return { kind: 'priority', priority_entity_id: selection.id };
    case 'insight':
      return { kind: 'insight', insight_id: selection.id };
    case 'action':
      return { kind: 'action', action_candidate_id: selection.id };
  }
}

export function toDashboardViewSelection(
  selection: WorkspaceDashboardSelection,
): DashboardViewSelection {
  switch (selection.kind) {
    case 'kpi':
      return { kind: 'kpi', id: selection.kpi_id };
    case 'chart':
      return { kind: 'chart', id: selection.chart_id };
    case 'priority':
      return { kind: 'priority', id: selection.priority_entity_id };
    case 'insight':
      return { kind: 'insight', id: selection.insight_id };
    case 'action':
      return { kind: 'action', id: selection.action_candidate_id };
  }
}

export function dashboardSelectionForDrilldown(
  model: Pick<ReportDashboardModel, 'priorities' | 'actions'>,
  drilldownId: string,
): DashboardViewSelection | null {
  const priority = model.priorities.find((candidate) => candidate.drilldownId === drilldownId);
  if (priority) return { kind: 'priority', id: priority.id };
  const action = model.actions.find((candidate) => candidate.drilldownId === drilldownId);
  return action ? { kind: 'action', id: action.id } : null;
}
