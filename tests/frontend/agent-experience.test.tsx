// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFeedPageSchema, AgentKeySchema, DelegationViewSchema } from '../../src/contracts';
import { agentConversationHref } from '../../src/frontend/components/shell/routes';
import { AgentConversationFeed } from '../../src/frontend/features/agent-workspace/components/agent-conversation-feed';
import { WorkspaceRail } from '../../src/frontend/features/agent-workspace/components/workspace-rail';
import { ANALYSIS_AGENT_DEFINITIONS } from '../../src/backend/agents/runtime/team/definitions';

const org = 'f1a3a5c1-5374-4ee8-b4a6-857b13071b2a';
const conversation = '4cbe66a9-714c-4ced-b01e-25dd8292a363';
const run = '40000000-0000-4000-8000-000000000003';
const request = '50000000-0000-4000-8000-000000000004';
const child = '60000000-0000-4000-8000-000000000005';
const date = '2026-09-29T12:34:56.000Z';
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('agent conversation navigation', () => {
  it('keeps the exact request and child identity when opening caller, callee, or execution', async () => {
    const delegation = DelegationViewSchema.parse({
      request_activity_id: request,
      response_activity_id: null,
      run_id: run,
      child: { source: 'runtime', run_id: run, activity_id: child },
      parent: null,
      root: null,
      caller_agent: 'insight',
      callee_agent: 'data',
      request_summary: 'Check evidence',
      result_summary: null,
      status: 'running',
      error_code: null,
      duration_ms: null,
      artifact_refs: [],
      evidence_refs: [],
      delegate_tool_activity_id: null,
      initiating_message_id: null,
      linkage: 'exact',
    });
    const page = AgentFeedPageSchema.parse({
      conversation_id: conversation,
      agent_key: 'data',
      items: [
        {
          kind: 'inbound_request',
          item_id: `activity:${request}`,
          created_at: date,
          run_id: run,
          delegation,
        },
      ],
      older_cursor: null,
      newer_cursor: null,
      focus_item: null,
      revision: '1',
    });
    const openAgent = vi.fn();
    const openExecution = vi.fn();
    await act(async () =>
      root.render(
        <AgentConversationFeed
          page={page}
          agent="data"
          loading={false}
          error={null}
          execution={null}
          onOlder={vi.fn()}
          onNewer={vi.fn()}
          canLoadNewer={false}
          onRun={vi.fn()}
          onReport={vi.fn()}
          onArtifact={vi.fn()}
          onAction={vi.fn()}
          onOpenAgent={openAgent}
          onExecution={openExecution}
        />,
      ),
    );
    expect(host.textContent).toContain('Từ');
    expect(host.textContent).toContain('Check evidence');
    await act(async () => host.querySelector<HTMLButtonElement>('.text-button')!.click());
    expect(openAgent).toHaveBeenCalledWith('insight', `activity:${request}`, run, child);
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.text-button')[1]!.click());
    expect(openExecution).toHaveBeenCalledWith(run, child, `activity:${request}`);
    const link = agentConversationHref(org, conversation, 'data', {
      item: `activity:${request}`,
      run,
      source: 'runtime',
      invocation: child,
    });
    expect(link).toContain('agent=data');
    expect(link).toContain(encodeURIComponent(`activity:${request}`));
    expect(link).toContain(`invocation=${child}`);
  });

  it('shows conversation-wide counts independently of selected agent state', async () => {
    const selected = vi.fn();
    const summaries = AgentKeySchema.options.map((agent_key) => ({
      agent_key,
      state: agent_key === 'data' ? ('working' as const) : ('idle' as const),
      active_count: agent_key === 'data' ? 2 : 0,
      queued_count: agent_key === 'data' ? 1 : 0,
      running_count: agent_key === 'data' ? 1 : 0,
      waiting_count: 0,
      recent_error: false,
      latest_activity_at: null,
      previews: [],
    }));
    await act(async () =>
      root.render(
        <WorkspaceRail
          orgId={org}
          conversations={[]}
          selectedConversation={null}
          selectedId={conversation}
          agents={[...ANALYSIS_AGENT_DEFINITIONS]}
          records={[]}
          recipient="data"
          summaries={summaries}
          onRecipient={selected}
          canWrite
          loading={false}
          hasMore={false}
          onNew={vi.fn()}
          onSelect={vi.fn()}
          onLoadMore={vi.fn()}
        />,
      ),
    );
    const data = host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    expect(data?.textContent).toContain('2 đang hoạt động');
    expect(data?.textContent).toContain('1 chờ');
    expect(host.textContent).toContain('Xem tất cả công việc');
    const other = host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]');
    expect(other).not.toBeNull();
    await act(async () => other!.click());
    expect(selected).toHaveBeenCalled();
  });

  it('explains accepted work and retains an error signal alongside active work', async () => {
    const summaries = AgentKeySchema.options.map((agent_key) => ({
      agent_key,
      state: agent_key === 'data' ? ('working' as const) : ('idle' as const),
      active_count: agent_key === 'data' ? 1 : 0,
      queued_count: 0,
      running_count: agent_key === 'data' ? 1 : 0,
      waiting_count: 0,
      recent_error: agent_key === 'data',
      latest_activity_at: null,
      previews:
        agent_key === 'data'
          ? [{
              work_id: 'job:example',
              kind: 'turn' as const,
              agent_key: 'data' as const,
              caller: 'human' as const,
              state: 'running' as const,
              summary: 'Analyze inventory ageing by project',
              accepted_at: date,
              started_at: null,
              execution: null,
              item_id: null,
              waiting_on: [],
              run_id: null,
            }]
          : [],
    }));
    await act(async () =>
      root.render(
        <WorkspaceRail
          orgId={org}
          conversations={[]}
          selectedConversation={null}
          selectedId={conversation}
          agents={[...ANALYSIS_AGENT_DEFINITIONS]}
          records={[]}
          recipient="data"
          summaries={summaries}
          onRecipient={vi.fn()}
          canWrite
          loading={false}
          hasMore={false}
          onNew={vi.fn()}
          onSelect={vi.fn()}
          onLoadMore={vi.fn()}
        />,
      ),
    );
    const data = host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    expect(data?.textContent).toContain('Đang xử lý: Analyze inventory ageing by project');
    expect(data?.textContent).toContain('Có lỗi gần đây');
    expect(data?.getAttribute('data-state')).toBe('working');
  });
});
