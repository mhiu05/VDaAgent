// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, Message } from '@vda/contracts';
import { ApiError } from '../../../lib/http/api-client';
import {
  getAgentTurnJob,
  getConversationAgentTurnJob,
  getConversationMessage,
  listConversationMessages,
  listConversations,
} from '../api/conversations';
import { useMessages } from './use-messages';
import { useAgentExecution } from './use-agent-execution';
import { useConversations } from './use-conversations';

vi.mock('../api/conversations', () => ({
  getAgentTurnJob: vi.fn(),
  getConversationAgentTurnJob: vi.fn(),
  getConversationMessage: vi.fn(),
  listConversationMessages: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
}));

const orgA = '10000000-0000-4000-8000-000000000001';
const orgB = '10000000-0000-4000-8000-000000000002';
const convA = '81000000-0000-4000-8000-000000000001';
const convB = '81000000-0000-4000-8000-000000000002';
const oldId = '82000000-0000-4000-8000-000000000001';
const newId = '82000000-0000-4000-8000-000000000002';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function message(
  id: string,
  updatedAt = '2026-09-25T00:00:00.000Z',
  status: Message['status'] = 'in_progress',
): Message {
  return {
    message_id: id,
    org_id: orgA,
    conversation_id: convA,
    run_id: null,
    client_turn_id: null,
    role: 'assistant',
    status,
    content: status,
    parts: [{ type: 'text', text: status }],
    created_at: id === oldId ? '2026-09-20T00:00:00.000Z' : '2026-09-25T00:00:00.000Z',
    updated_at: updatedAt,
  };
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

describe('message and job polling', () => {
  it('keeps older conversation pages and the exhausted cursor during a newest-page refresh', async () => {
    let current!: ReturnType<typeof useConversations>;
    function Harness() {
      current = useConversations(orgA, () => undefined);
      return null;
    }
    const item = (id: string, updated_at: string): ConversationListItem => ({
      conversation_id: id,
      org_id: orgA,
      created_by: oldId,
      kind: 'interactive',
      title: id,
      created_at: '2026-09-20T00:00:00.000Z',
      updated_at,
      latest_status: 'completed',
    });
    await act(async () => {
      root.render(<Harness />);
    });
    vi.mocked(listConversations).mockResolvedValueOnce({
      conversations: [item(convA, '2026-09-25T00:00:01.000Z')],
      next_cursor: 'older',
    });
    await act(async () => {
      await current.loadConversations(null, false);
    });
    vi.mocked(listConversations).mockResolvedValueOnce({
      conversations: [item(convB, '2026-09-20T00:00:01.000Z')],
      next_cursor: null,
    });
    await act(async () => {
      await current.loadConversations('older', true);
    });
    vi.mocked(listConversations).mockResolvedValueOnce({
      conversations: [item(convA, '2026-09-25T00:00:02.000Z')],
      next_cursor: 'new-older',
    });
    await act(async () => {
      await current.loadConversations(null, false);
    });
    expect(current.conversations.map((entry) => entry.conversation_id)).toEqual([convA, convB]);
    expect(current.conversations[0]?.updated_at).toBe('2026-09-25T00:00:02.000Z');
    expect(current.conversationCursor).toBeNull();
  });
  it('refreshes an assistant outside the newest page without losing loaded history or cursor', async () => {
    let current!: ReturnType<typeof useMessages>;
    const errors: string[] = [];
    function Harness({ orgId }: { orgId: string }) {
      current = useMessages(orgId, (text) => errors.push(text));
      return null;
    }
    await act(async () => {
      root.render(<Harness orgId={orgA} />);
    });
    await act(async () => {
      current.activateConversation(convA);
    });
    vi.mocked(listConversationMessages).mockResolvedValueOnce({
      messages: [message(newId)],
      next_cursor: 'older-cursor',
    });
    await act(async () => {
      expect(await current.loadMessages(convA, null, false)).toBe('ok');
    });
    vi.mocked(listConversationMessages).mockResolvedValueOnce({
      messages: [message(oldId)],
      next_cursor: 'oldest-cursor',
    });
    await act(async () => {
      expect(await current.loadMessages(convA, 'older-cursor', true)).toBe('ok');
    });
    expect(current.messageCursor).toBe('oldest-cursor');
    vi.mocked(getConversationMessage).mockResolvedValueOnce(
      message(oldId, '2026-09-25T00:00:02.000Z', 'completed'),
    );
    await act(async () => {
      expect(await current.refreshMessage(convA, oldId)).toBe('terminal');
    });
    expect(current.messages.find((item) => item.message_id === oldId)?.status).toBe('completed');
    expect(current.messages.map((item) => item.message_id)).toEqual([oldId, newId]);
    expect(current.messageCursor).toBe('oldest-cursor');
    vi.mocked(getConversationMessage).mockResolvedValueOnce(message(oldId));
    await act(async () => {
      await current.refreshMessage(convA, oldId);
    });
    expect(current.messages.find((item) => item.message_id === oldId)?.status).toBe('completed');
    expect(errors).toEqual([]);
  });

  it('ignores a delayed response after selection changes and clears revoked data', async () => {
    let current!: ReturnType<typeof useMessages>;
    function Harness({ orgId }: { orgId: string }) {
      current = useMessages(orgId, () => undefined);
      return null;
    }
    await act(async () => {
      root.render(<Harness orgId={orgA} />);
    });
    await act(async () => {
      current.activateConversation(convA);
    });
    const delayed = deferred<ReturnType<typeof message>>();
    vi.mocked(getConversationMessage).mockReturnValueOnce(delayed.promise);
    const pending = current.refreshMessage(convA, oldId);
    await act(async () => {
      root.render(<Harness orgId={orgB} />);
    });
    await act(async () => {
      current.activateConversation(convB);
    });
    await act(async () => {
      delayed.resolve(message(oldId, '2026-09-25T00:00:03.000Z', 'completed'));
    });
    expect(await pending).toBe('stale');
    expect(current.messages).toEqual([]);
    vi.mocked(listConversationMessages).mockResolvedValueOnce({
      messages: [{ ...message(newId), org_id: orgB, conversation_id: convB }],
      next_cursor: null,
    });
    await act(async () => {
      await current.loadMessages(convB, null, false);
    });
    expect(current.messages).toHaveLength(1);
    vi.mocked(getConversationMessage).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    await act(async () => {
      expect(await current.refreshMessage(convB, newId)).toBe('unauthorized');
    });
    expect(current.messages).toEqual([]);
    expect(current.messageCursor).toBeNull();
  });

  it('stops polling a missing accepted job and ignores an old conversation response', async () => {
    vi.useFakeTimers();
    let current!: ReturnType<typeof useAgentExecution>;
    function Harness({ conversationId, jobId }: { conversationId: string; jobId: string | null }) {
      current = useAgentExecution(orgA, conversationId, jobId);
      return null;
    }
    const delayed = deferred<Awaited<ReturnType<typeof getConversationAgentTurnJob>>>();
    vi.mocked(getConversationAgentTurnJob).mockReturnValueOnce(delayed.promise);
    await act(async () => {
      root.render(<Harness conversationId={convA} jobId={null} />);
    });
    vi.mocked(getAgentTurnJob).mockRejectedValueOnce(new ApiError('Missing', 404));
    await act(async () => {
      root.render(<Harness conversationId={convB} jobId={oldId} />);
    });
    await act(async () => {
      delayed.resolve(null);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(current.snapshot).toBeNull();
    expect(current.error).toBe('Missing');
    expect(vi.getTimerCount()).toBe(0);
  });
});
