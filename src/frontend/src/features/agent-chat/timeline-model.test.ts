import { describe, expect, it } from 'vitest';
import type { Message } from '@vda/contracts';
import { mergeMessages } from './timeline-model';

const message = (id: string, created: string, content = id): Message => ({
  message_id: id, created_at: created, updated_at: created, content,
} as Message);

describe('mergeMessages', () => {
  it('upserts a changed stage message in its persisted position', () => {
    const first = message('stage', '2026-09-24T10:00:00Z');
    const second = message('user', '2026-09-24T10:01:00Z');
    expect(mergeMessages([first, second], [{ ...first, content: 'complete', updated_at: '2026-09-24T10:03:00Z' }])
      .map((item) => [item.message_id, item.content])).toEqual([['stage', 'complete'], ['user', 'user']]);
  });
  it('prepends older history without duplicating a polled message', () => {
    const later = message('later', '2026-09-24T10:01:00Z');
    expect(mergeMessages([later], [message('earlier', '2026-09-24T09:59:00Z'), later])
      .map((item) => item.message_id)).toEqual(['earlier', 'later']);
  });
  it('does not let an older response replace a completed message', () => {
    const started = { ...message('reply', '2026-09-24T10:00:00Z'),
      status: 'in_progress' as const, content: 'Working' };
    const completed = { ...started, status: 'completed' as const,
      content: 'Ready', updated_at: '2026-09-24T10:01:00Z' };
    expect(mergeMessages([completed], [started])).toEqual([completed]);
    expect(mergeMessages([completed], [{ ...started, updated_at: completed.updated_at }]))
      .toEqual([completed]);
  });
});
