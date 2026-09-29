import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog } from '@vda/contracts';
import { AgentWorkspace } from '../../src/frontend/features/agent-workspace/components/agent-workspace';
import { initialWorkspaceContextState } from '../../src/frontend/features/workspace/context';

vi.mock('../../src/frontend/node_modules/next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('empty analysis workspace', () => {
  it('renders a question composer, conversation, and separate evidence context', () => {
    const catalog: Catalog = { projects: [], latest_snapshot_date: null };
    const noop = () => undefined;
    const output = renderToStaticMarkup(
      <AgentWorkspace
        orgId="10000000-0000-4000-8000-000000000001"
        organizationName="Authorized workspace"
        catalog={catalog}
        canWrite={false}
        sseEnabled={false}
        project=""
        zone=""
        dataAsOf=""
        workspaceState={initialWorkspaceContextState}
        workspaceRevision={0}
        staleSelectionCleared={false}
        onProject={noop}
        onZone={noop}
        onDataAsOf={noop}
        onActiveRunChange={noop}
        onWorkspaceAction={noop}
        onDashboardSelectionChange={noop}
        onActiveArtifactChange={noop}
        onClearStaleNotice={noop}
      />,
    );
    expect(output).toContain('Authorized workspace');
    expect(output).toContain('Nội dung hội thoại');
    expect(output).toContain('Câu hỏi phân tích');
    expect(output).toContain('Bối cảnh và bằng chứng');
    expect(output).toContain('Chưa chọn lượt chạy');
    expect(output).toContain('Chưa chọn báo cáo');
    expect(output.match(/aria-label="Nội dung hội thoại"/g)).toHaveLength(1);
  });
});
