import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceInspector } from '../../src/frontend/features/agent-workspace/components/workspace-inspector';
import { initialWorkspaceContextState } from '../../src/frontend/features/workspace/context';

describe('current workspace inspector', () => {
  it('shows authorized context and an empty run without private draft artifacts', () => {
    const controller = {
      currentRunDetail: null,
      bundle: { artifacts: [], validations: [], sources: [] },
      readState: 'ready',
      canWrite: false,
      busy: false,
      messages: [],
      messageContextRefs: [],
      project: '',
      dataAsOf: '',
      catalog: { projects: [] },
      threadWorkspace: {
        context: {
          dataset_ids: [],
          referenced_artifact_ids: [],
          active_report_id: null,
          active_artifact_id: null,
        },
        datasets: [],
        reports: [],
        memory: [],
        agents: [],
        saving: false,
      },
      runtime: { snapshot: { records: [] }, connection: 'idle' },
    } as unknown as Parameters<typeof WorkspaceInspector>[0]['controller'];
    const output = renderToStaticMarkup(
      <WorkspaceInspector
        controller={controller}
        context={initialWorkspaceContextState}
        organizationName="Authorized workspace"
        onArtifact={() => undefined}
      />,
    );
    expect(output).toContain('role="tablist"');
    expect(output).toContain('Authorized workspace');
    expect(output).toContain('Chưa có kết quả đang chọn');
    expect(output).not.toMatch(/report_draft|review_result/);
  });
});
