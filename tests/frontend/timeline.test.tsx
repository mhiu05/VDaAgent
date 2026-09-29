import { describe, expect, it } from 'vitest';
import type { Message } from '@vda/contracts';
import { mergeMessages } from '../../src/frontend/features/agent-chat/timeline-model';

function message(id: string, created_at: string, content = id): Message {
  return { message_id: id, created_at, updated_at: created_at, content } as Message;
}

describe('persisted conversation timeline', () => {
  it('updates a stage in place and inserts older pages once', () => {
    const stage = message('stage', '2026-09-24T10:00:00Z');
    const user = message('user', '2026-09-24T10:01:00Z');
    const updated = mergeMessages(
      [stage, user],
      [
        message('older', '2026-09-24T09:59:00Z'),
        { ...stage, content: 'complete', updated_at: '2026-09-24T10:03:00Z' },
        user,
      ],
    );
    expect(updated.map((item) => [item.message_id, item.content])).toEqual([
      ['older', 'older'],
      ['stage', 'complete'],
      ['user', 'user'],
    ]);
  });

  it('never replaces a terminal reply with stale progress after reconnect', () => {
    const progress = {
      ...message('reply', '2026-09-24T10:00:00Z', 'Working'),
      status: 'in_progress' as const,
    };
    const done = {
      ...progress,
      content: 'Ready',
      status: 'completed' as const,
      updated_at: '2026-09-24T10:01:00Z',
    };
    expect(mergeMessages([done], [progress])).toEqual([done]);
    expect(mergeMessages([done], [{ ...progress, updated_at: done.updated_at }])).toEqual([done]);
  });
});
