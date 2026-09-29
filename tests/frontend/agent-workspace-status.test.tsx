import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentDefinition, AgentInvocation, RuntimeActivity } from '@vda/contracts';
import { WorkspaceRail } from '../../src/frontend/features/agent-workspace/components/workspace-rail';
import { RuntimeTree } from '../../src/frontend/features/agent-workspace/components/runtime-tree';

const agents = ['coordinator', 'data', 'comparison', 'report'].map((id) => ({
  id,
  name: id,
})) as AgentDefinition[];

describe('canonical workspace execution status', () => {
  it('renders persisted specialist status without inventing activity for historical threads', () => {
    const props = {
      conversations: [],
      selectedConversation: null,
      selectedId: null,
      agents,
      records: [],
      recipient: 'comparison' as const,
      onRecipient: () => undefined,
      canWrite: true,
      loading: false,
      hasMore: false,
      onNew: () => undefined,
      onSelect: () => undefined,
      onLoadMore: () => undefined,
    };
    const invocations = [
      { agent_key: 'data', status: 'completed' },
      { agent_key: 'compare', status: 'running' },
      { agent_key: 'report', status: 'queued' },
    ] as AgentInvocation[];
    const current = renderToStaticMarkup(<WorkspaceRail {...props} invocations={invocations} />);
    expect(current).toContain('Tác nhân dữ liệu · Hoàn tất');
    expect(current).toContain('Tác nhân so sánh · Đang chạy');
    expect(current).toContain('Tác nhân báo cáo · Đang chờ');
    expect(current).toContain('aria-pressed="true"');
    const historical = renderToStaticMarkup(<WorkspaceRail {...props} invocations={[]} />);
    expect(historical).not.toContain('Tác nhân so sánh · Đang chạy');
  });

  it('shows saved specialist stages and safe labels in the runtime tree', () => {
    const records = [
      {
        activity_id: '10000000-0000-4000-8000-000000000001',
        kind: 'invocation',
        step_key: 'team:analyst',
        agent_key: 'analyst',
        status: 'completed',
        summary: 'Verified inventory findings',
      },
    ] as RuntimeActivity[];
    const html = renderToStaticMarkup(<RuntimeTree records={records} agents={agents} />);
    expect(html).toContain('Các tác nhân và công cụ đang thực thi');
    expect(html).toContain('Tác nhân phân tích');
    expect(html).toContain('Hoàn tất');
    expect(html).toContain('Verified inventory findings');
  });
});
