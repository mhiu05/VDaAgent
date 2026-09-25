import { describe, expect, it } from 'vitest';
import {
  initialWorkspaceContextState,
  toWorkspaceContext,
  workspaceContextReducer,
} from './context';

const RUN_A = '10000000-0000-4000-8000-000000000001';
const RUN_B = '20000000-0000-4000-8000-000000000001';
const REPORT = '30000000-0000-4000-8000-000000000001';
const ARTIFACT = '40000000-0000-4000-8000-000000000001';
const turnInput = {
  org_id: '50000000-0000-4000-8000-000000000001',
  conversation_id: '60000000-0000-4000-8000-000000000001',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  mode: 'report_dashboard' as const,
};

describe('WorkspaceContextState', () => {
  it('clears stale selections when a different active run is selected', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: {
        type: 'open_evidence',
        run_id: RUN_A,
        artifact_id: ARTIFACT,
        evidence_path: '$.evidence[0]',
      },
    });
    const changed = workspaceContextReducer(selected, { type: 'set_active_run', run_id: RUN_B });

    expect(changed).toMatchObject({
      active_run_id: RUN_B,
      active_artifact_id: null,
      active_evidence_ref: null,
      stale_selection_cleared: true,
    });
  });

  it('rejects a delayed workspace action after the active run changes', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: {
        type: 'open_evidence',
        run_id: RUN_A,
        artifact_id: ARTIFACT,
        evidence_path: '$.evidence[0]',
      },
    });
    const changed = workspaceContextReducer(selected, {
      type: 'set_active_run',
      run_id: RUN_B,
    });
    const rejected = workspaceContextReducer(changed, {
      type: 'apply_workspace_action',
      expected_revision: selected.revision,
      action: {
        type: 'open_evidence',
        run_id: RUN_A,
        artifact_id: ARTIFACT,
        evidence_path: '$.evidence[0]',
      },
    });

    expect(rejected).toBe(changed);
    expect(rejected).toMatchObject({
      active_run_id: RUN_B,
      active_artifact_id: null,
      active_evidence_ref: null,
    });
  });

  it('rejects a delayed workspace action after the workspace scope is cleared', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_dashboard', run_id: RUN_A, report_id: REPORT },
    });
    const cleared = workspaceContextReducer(selected, {
      type: 'clear_for_scope_change',
    });
    const rejected = workspaceContextReducer(cleared, {
      type: 'apply_workspace_action',
      expected_revision: selected.revision,
      action: {
        type: 'open_evidence',
        run_id: RUN_A,
        artifact_id: ARTIFACT,
        evidence_path: null,
      },
    });

    expect(rejected).toBe(cleared);
    expect(rejected).toMatchObject({
      active_run_id: null,
      active_report_id: null,
      active_artifact_id: null,
      active_evidence_ref: null,
    });
  });

  it('maps server-validated actions to typed context without copying labels or values', () => {
    const dashboard = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_dashboard', run_id: RUN_A, report_id: REPORT },
    });
    const visual = workspaceContextReducer(dashboard, {
      type: 'apply_workspace_action',
      action: { type: 'focus_visual', run_id: RUN_A, chart_id: 'chart:inventory' },
    });

    expect(toWorkspaceContext(visual, turnInput)).toEqual({
      version: 1,
      mode: 'report_dashboard',
      org_id: turnInput.org_id,
      conversation_id: turnInput.conversation_id,
      scope: turnInput.scope,
      data_as_of: turnInput.data_as_of,
      active_run_ref: { run_id: RUN_A },
      active_report_ref: { run_id: RUN_A, report_id: REPORT },
      active_artifact_ref: null,
      dashboard_selection: {
        chart_ref: { run_id: RUN_A, chart_id: 'chart:inventory' },
        priority_entity_ref: null,
      },
      drilldown: null,
      evidence_ref: null,
    });
    expect(JSON.stringify(visual)).not.toContain('label');
  });

  it('drops descendants when a turn is rooted in a different run', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_dashboard', run_id: RUN_A, report_id: REPORT },
    });
    const snapshot = toWorkspaceContext(selected, {
      ...turnInput,
      active_run_id: RUN_B,
    });

    expect(snapshot).toMatchObject({
      active_run_ref: { run_id: RUN_B },
      active_report_ref: null,
      active_artifact_ref: null,
      dashboard_selection: null,
      drilldown: null,
      evidence_ref: null,
    });
  });

  it('does not invent an evidence path when navigation only selected an artifact', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_evidence', run_id: RUN_A, artifact_id: ARTIFACT, evidence_path: null },
    });
    const snapshot = toWorkspaceContext(selected, turnInput);

    expect(snapshot).toMatchObject({
      active_artifact_ref: { run_id: RUN_A, artifact_id: ARTIFACT },
      evidence_ref: null,
    });
  });

  it('opens a dashboard overview without retaining a previous evidence focus', () => {
    const evidence = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_evidence', run_id: RUN_A, artifact_id: ARTIFACT, evidence_path: null },
    });
    const dashboard = workspaceContextReducer(evidence, {
      type: 'apply_workspace_action',
      action: { type: 'open_dashboard', run_id: RUN_A, report_id: REPORT },
    });
    expect(dashboard).toMatchObject({
      active_report_id: REPORT,
      active_artifact_id: null,
      active_dashboard_selection: null,
      active_evidence_ref: null,
    });
  });

  it('clears an incompatible dashboard focus when opening an exact drill-down', () => {
    const visual = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'focus_visual', run_id: RUN_A, chart_id: 'chart:inventory' },
    });
    const drilldown = workspaceContextReducer(visual, {
      type: 'apply_workspace_action',
      action: { type: 'open_drilldown', run_id: RUN_A, drilldown_id: 'drilldown:unit:u-1' },
    });
    expect(drilldown).toMatchObject({
      active_dashboard_selection: null,
      active_drilldown_id: 'drilldown:unit:u-1',
    });
  });

  it('switches capability mode without granting a selection', () => {
    const next = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'switch_capability_mode', mode: 'compare' },
    });
    expect(next).toMatchObject({ mode: 'compare', active_run_id: null });
  });
});
