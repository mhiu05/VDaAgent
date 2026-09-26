// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentDefinitionSchema } from '@vda/contracts';
import { WorkspaceRail } from './workspace-rail';
import { Composer } from '../../agent-chat/composer';
import { RuntimeConversation } from './runtime-conversation';
import { RuntimeActivityRecordSchema } from '@vda/contracts';
import type { MessageContextRef } from '@vda/contracts';
import { MessageContextControls, ThreadContextControls } from './thread-context-controls';
import { MessageThread } from '../../agent-chat/message-thread';
import { MessageSchema } from '@vda/contracts';

const agents = ['coordinator', 'data', 'comparison', 'insight', 'chart', 'report', 'reviewer'].map((id) => AgentDefinitionSchema.parse({ id, name: id === 'coordinator' ? 'Main Agent' : `${id} Agent`, role: id, description: `Work with ${id}`, instructions: '', allowed_tools: [], capabilities: [], avatar: { initials: id.slice(0, 2), color: 'blue' } }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('agent workspace interactions', () => {
  it('replies to artifact-bearing messages and lets the composer clear that context', async () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const message = MessageSchema.parse({ message_id: id, org_id: id, conversation_id: id, run_id: id, role: 'assistant', status: 'completed', content: 'Here is the analysis', parts: [{ type: 'artifact_ref', artifact_id: id, run_id: id, kind: 'data_analysis_pack' }], created_at: '2026-09-26T00:00:00Z' });
    const reply = vi.fn();
    await act(async () => root.render(<MessageThread messages={[message]} loading={false} hasEarlier={false} onLoadEarlier={vi.fn()} onOpenRun={vi.fn()} onOpenReport={vi.fn()} onOpenArtifact={vi.fn()} onReply={reply} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Reply with this message\'s artifact context"]')!.click());
    expect(reply).toHaveBeenCalledWith(id);
    const clear = vi.fn();
    const chat = { replyToMessageId: id, setReplyToMessageId: clear, messages: [message], messageContextRefs: [], threadWorkspace: { context: {}, reports: [] }, bundle: { artifacts: [] }, canWrite: true } as unknown as Parameters<typeof MessageContextControls>[0]['chat'];
    await act(async () => root.render(<MessageContextControls chat={chat} />));
    expect(host.querySelector('[aria-label="Clear reply context"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Clear reply context"]')!.click());
    expect(clear).toHaveBeenCalledWith(null);
  });
  it('selects a specialist without opening another thread', async () => {
    const recipient = vi.fn(); const selectThread = vi.fn();
    await act(async () => root.render(<WorkspaceRail agents={agents} records={[]} recipient={null} onRecipient={recipient} conversations={[]} selectedConversation={null} selectedId="thread-a" canWrite loading={false} hasMore={false} onNew={vi.fn()} onSelect={selectThread} onLoadMore={vi.fn()} />));
    const button = Array.from(host.querySelectorAll('button')).find((element) => element.textContent?.includes('data Agent'))!;
    await act(async () => button.click());
    expect(recipient).toHaveBeenCalledWith('data');
    expect(selectThread).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[aria-pressed]')).toHaveLength(7);
  });
  it('autocompletes a registry mention with keyboard selection', async () => {
    const target = vi.fn(); const draft = vi.fn();
    await act(async () => root.render(<Composer agents={agents} catalog={{ projects: [], latest_snapshot_date: null }} canWrite project="p" zone="" dataAsOf="2026-09-26" draft="@Da" busy={false} agentTarget={null} scheduledReadOnly={false} onProject={vi.fn()} onZone={vi.fn()} onDate={vi.fn()} onDraft={draft} onAgentTarget={target} onSubmit={vi.fn()} />));
    const textarea = host.querySelector('textarea')!;
    textarea.setSelectionRange(3, 3);
    await act(async () => textarea.click());
    expect(host.querySelector('[role="listbox"]')?.textContent).toContain('data Agent');
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(target).toHaveBeenCalledWith('data');
    expect(draft).toHaveBeenCalledWith('@Data ');
  });
  it('renders only meaningful persisted agent communication', async () => {
    const base = { activity_id: crypto.randomUUID(), org_id: crypto.randomUUID(), run_id: crypto.randomUUID(), conversation_id: null, step_key: 'request', agent_key: 'insight', target_agent_key: 'data', kind: 'message', message_type: 'data_request', summary: 'Request product breakdown', created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T00:00:00Z' };
    const message = RuntimeActivityRecordSchema.parse(base);
    const tool = RuntimeActivityRecordSchema.parse({ ...base, activity_id: crypto.randomUUID(), kind: 'tool', summary: 'Parsing tool arguments' });
    await act(async () => root.render(<RuntimeConversation agents={agents} records={[message, tool]} onEvidence={vi.fn()} />));
    expect(host.textContent).toContain('Request product breakdown');
    expect(host.textContent).not.toContain('Parsing tool arguments');
  });

  it('clears report context without changing the chosen agent or thread', async () => {
    const update = vi.fn();
    const recipient = vi.fn();
    const chat = {
      threadWorkspace: { context: { active_report_id: 'report-a' }, reports: [], saving: false, update },
      selectedConversationId: 'thread-a', messages: [], visibleRunId: null, reportIntent: null,
      project: 'dataset-a', catalog: { projects: [{ project_external_id: 'dataset-a' }] }, dataAsOf: '2026-09-26',
      canWrite: true, busy: false, setReportIntent: vi.fn(), setAgentTarget: recipient,
    } as unknown as Parameters<typeof ThreadContextControls>[0]['chat'];
    await act(async () => root.render(<ThreadContextControls chat={chat} />));
    const selector = host.querySelector<HTMLSelectElement>('[aria-label="Active report"]')!;
    await act(async () => { selector.value = ''; selector.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(update).toHaveBeenCalledWith({ active_report_id: null, active_artifact_id: null, referenced_artifact_ids: [] });
    expect(recipient).not.toHaveBeenCalled();
  });

  it('retains multiple report attachments for one message without mutating thread defaults', async () => {
    const update = vi.fn();
    let refs: MessageContextRef[] = [];
    function ContextHarness() {
      const [selected, setSelected] = useState<MessageContextRef[]>([]);
      refs = selected;
      const chat = {
        threadWorkspace: { context: { active_report_id: 'report-a' }, reports: [
          { report_id: 'report-a', conversation_id: 'thread-a', run_id: 'run-a', artifact_id: 'artifact-a', version: 1 },
          { report_id: 'report-b', conversation_id: 'thread-a', run_id: 'run-b', artifact_id: 'artifact-b', version: 2 },
        ], update }, selectedConversationId: 'thread-a', messages: [], bundle: { artifacts: [] },
        messageContextRefs: selected, setMessageContextRefs: setSelected, canWrite: true, busy: false,
      } as unknown as Parameters<typeof MessageContextControls>[0]['chat'];
      return <MessageContextControls chat={chat} />;
    }
    await act(async () => root.render(<ContextHarness />));
    const selector = host.querySelector('select')!;
    for (const id of ['report-a', 'report-b']) await act(async () => { selector.value = `report:${id}`; selector.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(refs).toEqual([{ type: 'report', id: 'report-a' }, { type: 'report', id: 'report-b' }]);
    expect(host.querySelectorAll('button')).toHaveLength(2);
    expect(update).not.toHaveBeenCalled();
  });
});
