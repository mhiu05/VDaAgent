// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationListItem, Message } from '@vda/contracts';
import { ApiError } from '../../src/frontend/lib/http/api-client';
import {
  getAgentTurnJob,
  getConversationAgentTurnJob,
  getConversationMessage,
  listConversationMessages,
  listConversations,
} from '../../src/frontend/features/agent-chat/api/conversations';
import { useMessages } from '../../src/frontend/features/agent-chat/hooks/use-messages';
import { useAgentExecution } from '../../src/frontend/features/agent-chat/hooks/use-agent-execution';
import { useConversations } from '../../src/frontend/features/agent-chat/hooks/use-conversations';

vi.mock('../../src/frontend/features/agent-chat/api/conversations', () => ({
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
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function message(
  id: string,
  status: Message['status'] = 'in_progress',
  updatedAt = '2026-09-25T00:00:00.000Z',
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
function conversation(id: string, updated_at: string): ConversationListItem {
  return {
    conversation_id: id,
    org_id: orgA,
    created_by: oldId,
    kind: 'interactive',
    title: id,
    created_at: '2026-09-20T00:00:00.000Z',
    updated_at,
    latest_status: 'completed',
  };
}

describe('conversation and message history', () => {
  it('keeps older pages and exhausted cursor through a newest-page refresh', async () => {
    let state!: ReturnType<typeof useConversations>;
    function Harness() {
      state = useConversations(orgA, () => undefined);
      return null;
    }
    await act(async () => root.render(<Harness />));
    vi.mocked(listConversations).mockResolvedValueOnce({
      conversations: [conversation(convA, '2026-09-25T00:00:01Z')],
      next_cursor: 'older',
    });
    await act(async () => {
      await state.loadConversations(null, false);
    });
    vi.mocked(listConversations).mockResolvedValueOnce({
      conversations: [conversation(convB, '2026-09-20T00:00:01Z')],
      next_cursor: null,
    });
    await act(async () => {
      await state.loadConversations('older', true);
    });
    vi.mocked(listConversations).mockResolvedValueOnce({
      conversations: [conversation(convA, '2026-09-25T00:00:02Z')],
      next_cursor: 'new-older',
    });
    await act(async () => {
      await state.loadConversations(null, false);
    });
    expect(state.conversations.map((item) => item.conversation_id)).toEqual([convA, convB]);
    expect(state.conversations[0]?.updated_at).toBe('2026-09-25T00:00:02Z');
    expect(state.conversationCursor).toBeNull();
  });

  it('refreshes an older assistant in place without regressing terminal content', async () => {
    let state!: ReturnType<typeof useMessages>;
    const errors: string[] = [];
    function Harness() {
      state = useMessages(orgA, (text) => errors.push(text));
      return null;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => state.activateConversation(convA));
    vi.mocked(listConversationMessages).mockResolvedValueOnce({
      messages: [message(newId)],
      next_cursor: 'older',
    });
    await act(async () => {
      expect(await state.loadMessages(convA, null, false)).toBe('ok');
    });
    vi.mocked(listConversationMessages).mockResolvedValueOnce({
      messages: [message(oldId)],
      next_cursor: 'oldest',
    });
    await act(async () => {
      expect(await state.loadMessages(convA, 'older', true)).toBe('ok');
    });
    vi.mocked(getConversationMessage).mockResolvedValueOnce(
      message(oldId, 'completed', '2026-09-25T00:00:02Z'),
    );
    await act(async () => {
      expect(await state.refreshMessage(convA, oldId)).toBe('terminal');
    });
    expect(state.messages.map((item) => item.message_id)).toEqual([oldId, newId]);
    expect(state.messageCursor).toBe('oldest');
    vi.mocked(getConversationMessage).mockResolvedValueOnce(message(oldId));
    await act(async () => {
      await state.refreshMessage(convA, oldId);
    });
    expect(state.messages.find((item) => item.message_id === oldId)?.status).toBe('completed');
    expect(errors).toEqual([]);
  });

  it('discards delayed old-tenant reads and clears revoked conversation data', async () => {
    let state!: ReturnType<typeof useMessages>;
    function Harness({ orgId }: { orgId: string }) {
      state = useMessages(orgId, () => undefined);
      return null;
    }
    await act(async () => root.render(<Harness orgId={orgA} />));
    await act(async () => state.activateConversation(convA));
    const delayed = deferred<Message>();
    vi.mocked(getConversationMessage).mockReturnValueOnce(delayed.promise);
    const pending = state.refreshMessage(convA, oldId);
    await act(async () => root.render(<Harness orgId={orgB} />));
    await act(async () => state.activateConversation(convB));
    await act(async () => delayed.resolve(message(oldId, 'completed')));
    expect(await pending).toBe('stale');
    expect(state.messages).toEqual([]);
    vi.mocked(listConversationMessages).mockResolvedValueOnce({
      messages: [{ ...message(newId), org_id: orgB, conversation_id: convB }],
      next_cursor: null,
    });
    await act(async () => {
      await state.loadMessages(convB, null, false);
    });
    vi.mocked(getConversationMessage).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    await act(async () => {
      expect(await state.refreshMessage(convB, newId)).toBe('unauthorized');
    });
    expect(state.messages).toEqual([]);
    expect(state.messageCursor).toBeNull();
  });

  it('stops polling a missing job after conversation selection changes', async () => {
    vi.useFakeTimers();
    let state!: ReturnType<typeof useAgentExecution>;
    function Harness({ conversationId, jobId }: { conversationId: string; jobId: string | null }) {
      state = useAgentExecution(orgA, conversationId, jobId);
      return null;
    }
    const delayed = deferred<Awaited<ReturnType<typeof getConversationAgentTurnJob>>>();
    vi.mocked(getConversationAgentTurnJob).mockReturnValueOnce(delayed.promise);
    await act(async () => root.render(<Harness conversationId={convA} jobId={null} />));
    vi.mocked(getAgentTurnJob).mockRejectedValueOnce(new ApiError('Missing', 404));
    await act(async () => root.render(<Harness conversationId={convB} jobId={oldId} />));
    await act(async () => delayed.resolve(null));
    await act(async () => Promise.resolve());
    expect(state.snapshot).toBeNull();
    expect(state.error).toBe('Missing');
    expect(vi.getTimerCount()).toBe(0);
  });
});
