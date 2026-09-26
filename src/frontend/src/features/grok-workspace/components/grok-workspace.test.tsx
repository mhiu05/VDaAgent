import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog } from '@vda/contracts';
import { GrokWorkspace } from './grok-workspace';
import type { WorkspaceContextState } from '../../workspace/context';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
  it('renders the contextual workspace for an empty conversation', () => {
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
    expect(output).toContain('Hội thoại và quy trình');
    expect(output).toContain('Không gian hội thoại');
    expect(output).toContain('Bối cảnh và bằng chứng');
    expect(output).toContain('Câu hỏi phân tích');
    expect(output.match(/aria-label="Nội dung hội thoại"/g)).toHaveLength(1);
    expect(output).toContain('Chưa có lượt chạy');
    expect(output).toContain('No report context');
    expect(output).toContain('Agent recipients');
    expect(output).toContain('Current run');
  });
});
