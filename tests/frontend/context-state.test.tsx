import { describe, expect, it } from 'vitest';
import {
  initialWorkspaceContextState,
  toWorkspaceContext,
  workspaceContextReducer,
} from '../../src/frontend/features/workspace/context';

const RUN_A = '10000000-0000-4000-8000-000000000001';
const RUN_B = '20000000-0000-4000-8000-000000000001';
const REPORT = '30000000-0000-4000-8000-000000000001';
const ARTIFACT = '40000000-0000-4000-8000-000000000001';
const turn = {
  org_id: '50000000-0000-4000-8000-000000000001',
  conversation_id: '60000000-0000-4000-8000-000000000001',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  mode: 'report_dashboard' as const,
};

describe('workspace selection isolation', () => {
  it('clears evidence and rejects delayed actions after the active run changes', () => {
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
    expect(
      workspaceContextReducer(changed, {
        type: 'apply_workspace_action',
        expected_revision: selected.revision,
        action: {
          type: 'open_evidence',
          run_id: RUN_A,
          artifact_id: ARTIFACT,
          evidence_path: null,
        },
      }),
    ).toBe(changed);
  });

  it('rejects a stale action after the workspace scope is cleared', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_dashboard', run_id: RUN_A, report_id: REPORT },
    });
    const cleared = workspaceContextReducer(selected, { type: 'clear_for_scope_change' });
    expect(
      workspaceContextReducer(cleared, {
        type: 'apply_workspace_action',
        expected_revision: selected.revision,
        action: {
          type: 'open_evidence',
          run_id: RUN_A,
          artifact_id: ARTIFACT,
          evidence_path: null,
        },
      }),
    ).toBe(cleared);
    expect(cleared.active_run_id).toBeNull();
  });

  it('serializes only typed references from the selected run', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_dashboard', run_id: RUN_A, report_id: REPORT },
    });
    const other = toWorkspaceContext(selected, { ...turn, active_run_id: RUN_B });
    expect(other).toMatchObject({
      active_run_ref: { run_id: RUN_B },
      active_report_ref: null,
      active_artifact_ref: null,
      dashboard_selection: null,
    });
    const visual = workspaceContextReducer(selected, {
      type: 'apply_workspace_action',
      action: { type: 'focus_visual', run_id: RUN_A, chart_id: 'chart:inventory' },
    });
    expect(toWorkspaceContext(visual, turn)).toMatchObject({
      active_report_ref: { run_id: RUN_A, report_id: REPORT },
      dashboard_selection: { chart_ref: { run_id: RUN_A, chart_id: 'chart:inventory' } },
    });
  });

  it('does not invent an evidence path for a selected artifact', () => {
    const selected = workspaceContextReducer(initialWorkspaceContextState, {
      type: 'apply_workspace_action',
      action: { type: 'open_evidence', run_id: RUN_A, artifact_id: ARTIFACT, evidence_path: null },
    });
    expect(toWorkspaceContext(selected, turn)).toMatchObject({
      active_artifact_ref: { run_id: RUN_A, artifact_id: ARTIFACT },
      evidence_ref: null,
    });
  });
});
