import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '@vda/contracts';
import { GrokWorkspace } from './grok-workspace';
import type { WorkspaceContextState } from './workspace-context';

const catalog: Catalog = { projects: [], latest_snapshot_date: null };
const workspaceState: WorkspaceContextState = {
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

describe('GrokWorkspace', () => {
  it('renders the main and context panes without a second conversation rail', () => {
    const output = renderToStaticMarkup(
      <GrokWorkspace
        orgId="10000000-0000-4000-8000-000000000001"
        organizationName="Authorized workspace"
        catalog={catalog}
        canWrite={false}
        sseEnabled={false}
        project=""
        zone=""
        dataAsOf=""
        workspaceState={workspaceState}
        workspaceRevision={0}
        staleSelectionCleared={false}
        onProject={() => undefined}
        onZone={() => undefined}
        onDataAsOf={() => undefined}
        onActiveRunChange={() => undefined}
        onWorkspaceAction={() => undefined}
        onDashboardSelectionChange={() => undefined}
        onActiveArtifactChange={() => undefined}
        onClearStaleNotice={() => undefined}
      />,
    );
    expect(output).toContain('grok-workspace');
    expect(output).toContain('grok-main-surface');
    expect(output).toContain('grok-context-shell');
    expect(output).toContain('agent-chat-compact-controls');
    expect(output).not.toContain('agent-conversation-list');
    expect(output).toContain('No active result.');
  });
});
