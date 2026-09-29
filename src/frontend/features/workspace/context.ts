import {
  WorkspaceActionV1Schema,
  WorkspaceContextV1Schema,
  type CapabilityMode,
  type DashboardSelection,
  type EvidenceReference,
  type Scope,
  type WorkspaceActionV1,
  type WorkspaceContextV1,
  type WorkspaceModeV1,
} from '@vda/contracts';

/**
 * Client navigation state deliberately retains the existing, more detailed UI
 * modes and identifier-only selections. It is not the wire contract: a fresh
 * WorkspaceContextV1 is derived only when a turn is submitted, after the
 * current organization, conversation, scope, and date are known.
 */
export type WorkspaceContextState = {
  mode: CapabilityMode;
  active_run_id: string | null;
  active_report_id: string | null;
  active_artifact_id: string | null;
  active_dashboard_selection: DashboardSelection | null;
  active_drilldown_id: string | null;
  active_evidence_ref: EvidenceReference | null;
  stale_selection_cleared: boolean;
  revision: number;
};

export const initialWorkspaceContextState: WorkspaceContextState = {
  mode: 'grok',
  active_run_id: null,
  active_report_id: null,
  active_artifact_id: null,
  active_dashboard_selection: null,
  active_drilldown_id: null,
  active_evidence_ref: null,
  stale_selection_cleared: false,
  revision: 0,
};

export type WorkspaceContextAction =
  | { type: 'set_mode'; mode: CapabilityMode }
  | { type: 'set_active_run'; run_id: string | null }
  | { type: 'set_active_report'; report_id: string | null; run_id?: string | null }
  | { type: 'set_active_artifact'; artifact_id: string | null; run_id?: string | null }
  | {
      type: 'set_dashboard_selection';
      selection: DashboardSelection | null;
      run_id?: string | null;
    }
  | { type: 'set_active_drilldown'; drilldown_id: string | null; run_id?: string | null }
  | { type: 'set_active_evidence'; evidence: EvidenceReference | null; run_id?: string | null }
  | { type: 'clear_for_scope_change' }
  | {
      type: 'apply_workspace_action';
      action: WorkspaceActionV1;
      expected_revision?: number;
    }
  | { type: 'clear_stale_notice' };

function advanceRevision(state: WorkspaceContextState): WorkspaceContextState {
  return { ...state, revision: state.revision + 1 };
}

function clearSelection(
  state: WorkspaceContextState,
  run_id: string | null,
): WorkspaceContextState {
  const hadSelection =
    state.active_report_id !== null ||
    state.active_artifact_id !== null ||
    state.active_dashboard_selection !== null ||
    state.active_drilldown_id !== null ||
    state.active_evidence_ref !== null;
  return {
    ...state,
    active_run_id: run_id,
    active_report_id: null,
    active_artifact_id: null,
    active_dashboard_selection: null,
    active_drilldown_id: null,
    active_evidence_ref: null,
    stale_selection_cleared: state.stale_selection_cleared || hadSelection,
  };
}

function setRun(
  state: WorkspaceContextState,
  run_id: string | null | undefined,
): WorkspaceContextState {
  if (run_id === undefined || run_id === state.active_run_id) return state;
  return clearSelection(state, run_id);
}

export function workspaceContextReducer(
  state: WorkspaceContextState,
  action: WorkspaceContextAction,
): WorkspaceContextState {
  switch (action.type) {
    case 'set_mode':
      return advanceRevision({ ...state, mode: action.mode });
    case 'set_active_run': {
      const next = setRun(state, action.run_id);
      return next === state ? state : advanceRevision(next);
    }
    case 'set_active_report': {
      const next = setRun(state, action.run_id);
      return advanceRevision({ ...next, active_report_id: action.report_id });
    }
    case 'set_active_artifact': {
      const next = setRun(state, action.run_id);
      return advanceRevision({
        ...next,
        active_artifact_id: action.artifact_id,
        active_evidence_ref:
          next.active_evidence_ref?.artifact_id === action.artifact_id
            ? next.active_evidence_ref
            : null,
      });
    }
    case 'set_dashboard_selection': {
      const next = setRun(state, action.run_id);
      return advanceRevision({
        ...next,
        active_dashboard_selection: action.selection,
        active_drilldown_id: null,
      });
    }
    case 'set_active_drilldown': {
      const next = setRun(state, action.run_id);
      return advanceRevision({ ...next, active_drilldown_id: action.drilldown_id });
    }
    case 'set_active_evidence': {
      const next = setRun(state, action.run_id);
      return advanceRevision({
        ...next,
        active_artifact_id: action.evidence?.artifact_id ?? next.active_artifact_id,
        active_evidence_ref: action.evidence,
      });
    }
    case 'clear_for_scope_change':
      return advanceRevision(clearSelection(state, null));
    case 'clear_stale_notice':
      return { ...state, stale_selection_cleared: false };
    case 'apply_workspace_action': {
      if (action.expected_revision !== undefined && action.expected_revision !== state.revision)
        return state;
      const workspaceAction = WorkspaceActionV1Schema.parse(action.action);
      switch (workspaceAction.type) {
        case 'open_dashboard': {
          const next = setRun(state, workspaceAction.run_id);
          return advanceRevision({
            ...next,
            mode: 'report',
            active_report_id: workspaceAction.report_id,
            active_artifact_id: null,
            active_dashboard_selection: null,
            active_drilldown_id: null,
            active_evidence_ref: null,
          });
        }
        case 'open_drilldown': {
          const next = setRun(state, workspaceAction.run_id);
          return advanceRevision({
            ...next,
            mode: 'insight',
            active_dashboard_selection: null,
            active_drilldown_id: workspaceAction.drilldown_id,
          });
        }
        case 'focus_visual': {
          const next = setRun(state, workspaceAction.run_id);
          return advanceRevision({
            ...next,
            mode: 'chart',
            active_dashboard_selection: {
              kind: 'chart',
              chart_id: workspaceAction.chart_id,
            },
            active_drilldown_id: null,
          });
        }
        case 'focus_priority_entity': {
          const next = setRun(state, workspaceAction.run_id);
          return advanceRevision({
            ...next,
            mode: 'insight',
            active_dashboard_selection: {
              kind: 'priority',
              priority_entity_id: workspaceAction.priority_entity_id,
            },
            active_drilldown_id: null,
          });
        }
        case 'open_evidence': {
          const next = setRun(state, workspaceAction.run_id);
          return advanceRevision({
            ...next,
            active_artifact_id: workspaceAction.artifact_id,
            active_evidence_ref: {
              artifact_id: workspaceAction.artifact_id,
              evidence_path: workspaceAction.evidence_path,
            },
          });
        }
        case 'switch_capability_mode':
          return advanceRevision({ ...state, mode: workspaceAction.mode });
      }
    }
  }
}

export type WorkspaceContextTurnInput = {
  org_id: string;
  conversation_id: string | null;
  scope: Scope;
  data_as_of: string;
  mode: WorkspaceModeV1;
  /**
   * A turn can be opened from a run before the reducer has observed that
   * navigation event. In that case retain only selections already rooted in
   * the same run; never attach descendants from a prior result.
   */
  active_run_id?: string | null;
};

export function toWorkspaceContext(
  state: WorkspaceContextState,
  input: WorkspaceContextTurnInput,
): WorkspaceContextV1 {
  const activeRunId = input.active_run_id === undefined ? state.active_run_id : input.active_run_id;
  const retainDescendants = activeRunId !== null && activeRunId === state.active_run_id;
  const activeArtifactId = retainDescendants ? state.active_artifact_id : null;
  const selection = retainDescendants ? state.active_dashboard_selection : null;
  const dashboardSelection =
    selection?.kind === 'chart'
      ? {
          chart_ref: { run_id: activeRunId!, chart_id: selection.chart_id },
          priority_entity_ref: null,
        }
      : selection?.kind === 'priority'
        ? {
            chart_ref: null,
            priority_entity_ref: {
              run_id: activeRunId!,
              priority_entity_id: selection.priority_entity_id,
            },
          }
        : null;
  const evidence =
    retainDescendants &&
    activeArtifactId !== null &&
    state.active_evidence_ref !== null &&
    state.active_evidence_ref.artifact_id === activeArtifactId &&
    state.active_evidence_ref.evidence_path !== null
      ? {
          run_id: activeRunId!,
          artifact_id: activeArtifactId,
          evidence_path: state.active_evidence_ref.evidence_path,
        }
      : null;

  return WorkspaceContextV1Schema.parse({
    version: 1,
    mode: input.mode,
    org_id: input.org_id,
    conversation_id: input.conversation_id,
    scope: input.scope,
    data_as_of: input.data_as_of,
    active_run_ref: activeRunId === null ? null : { run_id: activeRunId },
    active_report_ref:
      retainDescendants && state.active_report_id !== null
        ? { run_id: activeRunId!, report_id: state.active_report_id }
        : null,
    active_artifact_ref:
      activeArtifactId === null ? null : { run_id: activeRunId!, artifact_id: activeArtifactId },
    dashboard_selection: dashboardSelection,
    drilldown:
      retainDescendants && state.active_drilldown_id !== null
        ? { run_id: activeRunId!, drilldown_id: state.active_drilldown_id }
        : null,
    evidence_ref: evidence,
  });
}
