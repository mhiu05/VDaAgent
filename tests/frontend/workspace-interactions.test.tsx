// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentDefinitionSchema,
  MessageSchema,
  RuntimeActivityRecordSchema,
  type MessageContextRef,
} from '@vda/contracts';
import { ANALYSIS_AGENT_DEFINITIONS } from '@vda/agents';
import { agentSuggestions } from '../../src/frontend/features/agent-chat/agent-suggestions';
import { Composer } from '../../src/frontend/features/agent-chat/composer';
import { MessageThread } from '../../src/frontend/features/agent-chat/message-thread';
import { RuntimeConversation } from '../../src/frontend/features/agent-workspace/components/runtime-conversation';
import { WorkspaceRail } from '../../src/frontend/features/agent-workspace/components/workspace-rail';
import {
  MessageContextControls,
  ThreadContextControls,
} from '../../src/frontend/features/agent-workspace/components/thread-context-controls';

const agents = ['coordinator', 'data', 'comparison', 'insight', 'chart', 'report', 'reviewer'].map(
  (id) =>
    AgentDefinitionSchema.parse({
      id,
      name: id === 'coordinator' ? 'Main Agent' : `${id} Agent`,
      role: id,
      description: `Work with ${id}`,
      instructions: '',
      allowed_tools: [],
      capabilities: [],
      avatar: { initials: id.slice(0, 2), color: 'blue' },
    }),
);
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

describe('agent workspace interactions', () => {
  it('shows distinct agent suggestions only for an empty, idle thread', async () => {
    for (const agent of ANALYSIS_AGENT_DEFINITIONS) {
      const suggestions = agentSuggestions[agent.id as keyof typeof agentSuggestions];
      expect(suggestions).toHaveLength(2);
      expect(new Set(suggestions).size).toBe(2);
    }
    const select = vi.fn();
    const props = {
      messages: [],
      loading: false,
      hasEarlier: false,
      onLoadEarlier: vi.fn(),
      onOpenRun: vi.fn(),
      onOpenReport: vi.fn(),
      onOpenArtifact: vi.fn(),
      onSuggestion: select,
    };
    await act(async () =>
      root.render(<MessageThread {...props} suggestions={agentSuggestions.data} />),
    );
    const chooser = host.querySelector('[aria-label="Câu hỏi gợi ý cho tác nhân đang chọn"]');
    expect(chooser?.querySelectorAll('button')).toHaveLength(2);
    await act(async () => chooser!.querySelector('button')!.click());
    expect(select).toHaveBeenCalledWith(agentSuggestions.data[0]);
    await act(async () =>
      root.render(<MessageThread {...props} suggestions={agentSuggestions.chart} />),
    );
    expect(host.textContent).toContain(agentSuggestions.chart[0]);
    expect(host.textContent).not.toContain(agentSuggestions.data[0]);
    await act(async () =>
      root.render(<MessageThread {...props} loading suggestions={agentSuggestions.chart} />),
    );
    expect(host.querySelector('[aria-label="Câu hỏi gợi ý cho tác nhân đang chọn"]')).toBeNull();
    const existing = MessageSchema.parse({
      message_id: crypto.randomUUID(),
      org_id: crypto.randomUUID(),
      conversation_id: crypto.randomUUID(),
      run_id: null,
      role: 'user',
      status: 'completed',
      content: 'Đã hỏi',
      parts: [],
      created_at: '2026-09-19T00:00:00Z',
    });
    await act(async () =>
      root.render(
        <MessageThread {...props} messages={[existing]} suggestions={agentSuggestions.chart} />,
      ),
    );
    expect(host.querySelector('[aria-label="Câu hỏi gợi ý cho tác nhân đang chọn"]')).toBeNull();
  });

  it('replies to an artifact-bearing message and lets the user clear reply context', async () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const message = MessageSchema.parse({
      message_id: id,
      org_id: id,
      conversation_id: id,
      run_id: id,
      role: 'assistant',
      status: 'completed',
      content: 'Here is the analysis',
      parts: [{ type: 'artifact_ref', artifact_id: id, run_id: id, kind: 'data_analysis_pack' }],
      created_at: '2026-09-26T00:00:00Z',
    });
    const reply = vi.fn();
    await act(async () =>
      root.render(
        <MessageThread
          messages={[message]}
          loading={false}
          hasEarlier={false}
          onLoadEarlier={vi.fn()}
          onOpenRun={vi.fn()}
          onOpenReport={vi.fn()}
          onOpenArtifact={vi.fn()}
          onReply={reply}
        />,
      ),
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Trả lời với bằng chứng của tin nhắn này"]')!
        .click(),
    );
    expect(reply).toHaveBeenCalledWith(id);
    const clear = vi.fn();
    const chat = {
      replyToMessageId: id,
      setReplyToMessageId: clear,
      messages: [message],
      messageContextRefs: [],
      threadWorkspace: { context: {}, reports: [] },
      bundle: { artifacts: [] },
      canWrite: true,
    } as unknown as Parameters<typeof MessageContextControls>[0]['chat'];
    await act(async () => root.render(<MessageContextControls chat={chat} />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Xóa ngữ cảnh trả lời"]')!.click(),
    );
    expect(clear).toHaveBeenCalledWith(null);
  });

  it('selects a specialist without selecting another conversation', async () => {
    const recipient = vi.fn();
    const selectThread = vi.fn();
    await act(async () =>
      root.render(
        <WorkspaceRail
          orgId="test-org"
          agents={agents}
          records={[]}
          recipient={null}
          onRecipient={recipient}
          conversations={[]}
          selectedConversation={null}
          selectedId="thread-a"
          canWrite
          loading={false}
          hasMore={false}
          onNew={vi.fn()}
          onSelect={selectThread}
          onLoadMore={vi.fn()}
        />,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>('[data-agent="data"]')?.closest('button');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(recipient).toHaveBeenCalledWith('data');
    expect(selectThread).not.toHaveBeenCalled();
    expect(host.querySelectorAll('button[aria-pressed]')).toHaveLength(7);
  });

  it('selects a registry mention with the keyboard', async () => {
    const target = vi.fn();
    const draft = vi.fn();
    await act(async () =>
      root.render(
        <Composer
          agents={agents}
          catalog={{ projects: [], latest_snapshot_date: null }}
          canWrite
          project="p"
          zone=""
          dataAsOf="2026-09-26"
          draft="@Da"
          busy={false}
          agentTarget={null}
          scheduledReadOnly={false}
          onProject={vi.fn()}
          onZone={vi.fn()}
          onDate={vi.fn()}
          onDraft={draft}
          onAgentTarget={target}
          onSubmit={vi.fn()}
        />,
      ),
    );
    const textarea = host.querySelector('textarea')!;
    textarea.setSelectionRange(3, 3);
    await act(async () => textarea.click());
    expect(host.querySelector('[role="listbox"]')?.textContent).toContain('Tác nhân dữ liệu');
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
        }),
      ),
    );
    expect(target).toHaveBeenCalledWith('data');
    expect(draft).toHaveBeenCalledWith('@Data ');
  });

  it('renders meaningful persisted agent communication without tool chatter', async () => {
    const base = {
      activity_id: crypto.randomUUID(),
      org_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      conversation_id: null,
      step_key: 'request',
      agent_key: 'insight',
      target_agent_key: 'data',
      kind: 'message',
      message_type: 'data_request',
      summary: 'Request product breakdown',
      created_at: '2026-09-26T00:00:00Z',
      updated_at: '2026-09-26T00:00:00Z',
    };
    const message = RuntimeActivityRecordSchema.parse(base);
    const tool = RuntimeActivityRecordSchema.parse({
      ...base,
      activity_id: crypto.randomUUID(),
      kind: 'tool',
      summary: 'Parsing tool arguments',
    });
    await act(async () =>
      root.render(
        <RuntimeConversation agents={agents} records={[message, tool]} onEvidence={vi.fn()} />,
      ),
    );
    expect(host.textContent).toContain('Request product breakdown');
    expect(host.textContent).not.toContain('Parsing tool arguments');
    expect(host.querySelector('.lucide-lightbulb')).not.toBeNull();
    expect(host.querySelector('.lucide-database')).not.toBeNull();
  });

  it('clears the thread report without changing the recipient', async () => {
    const update = vi.fn();
    const recipient = vi.fn();
    const chat = {
      threadWorkspace: {
        context: { active_report_id: 'report-a' },
        reports: [],
        saving: false,
        update,
      },
      selectedConversationId: 'thread-a',
      messages: [],
      visibleRunId: null,
      reportIntent: null,
      project: 'dataset-a',
      catalog: { projects: [{ project_external_id: 'dataset-a' }] },
      dataAsOf: '2026-09-26',
      canWrite: true,
      busy: false,
      setReportIntent: vi.fn(),
      setAgentTarget: recipient,
    } as unknown as Parameters<typeof ThreadContextControls>[0]['chat'];
    await act(async () => root.render(<ThreadContextControls chat={chat} />));
    const selector = host.querySelector<HTMLSelectElement>('[aria-label="Báo cáo đang chọn"]')!;
    await act(async () => {
      selector.value = '';
      selector.dispatchEvent(
        new Event('change', {
          bubbles: true,
        }),
      );
    });
    expect(update).toHaveBeenCalledWith({
      active_report_id: null,
      active_artifact_id: null,
      referenced_artifact_ids: [],
    });
    expect(recipient).not.toHaveBeenCalled();
  });

  it('attaches two reports to one message without changing the thread default', async () => {
    const update = vi.fn();
    let refs: MessageContextRef[] = [];
    function Harness() {
      const [selected, setSelected] = useState<MessageContextRef[]>([]);
      refs = selected;
      const chat = {
        threadWorkspace: {
          context: { active_report_id: 'report-a' },
          reports: [
            {
              report_id: 'report-a',
              conversation_id: 'thread-a',
              run_id: 'run-a',
              artifact_id: 'artifact-a',
              version: 1,
            },
            {
              report_id: 'report-b',
              conversation_id: 'thread-a',
              run_id: 'run-b',
              artifact_id: 'artifact-b',
              version: 2,
            },
          ],
          update,
        },
        selectedConversationId: 'thread-a',
        messages: [],
        bundle: { artifacts: [] },
        messageContextRefs: selected,
        setMessageContextRefs: setSelected,
        canWrite: true,
        busy: false,
      } as unknown as Parameters<typeof MessageContextControls>[0]['chat'];
      return <MessageContextControls chat={chat} />;
    }
    await act(async () => root.render(<Harness />));
    const selector = host.querySelector('select')!;
    for (const id of ['report-a', 'report-b'])
      await act(async () => {
        selector.value = `report:${id}`;
        selector.dispatchEvent(new Event('change', { bubbles: true }));
      });
    expect(refs).toEqual([
      { type: 'report', id: 'report-a' },
      { type: 'report', id: 'report-b' },
    ]);
    expect(host.querySelectorAll('button')).toHaveLength(2);
    expect(update).not.toHaveBeenCalled();
  });
});
