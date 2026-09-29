import { describe, expect, it, vi } from 'vitest';
import { durableEventStream } from '../../src/frontend/server/durable-event-stream';

type Snapshot = { status: string; events: Array<{ sequence: number; summary: string }> };
const terminal = (snapshot: Snapshot) =>
  snapshot.status === 'completed' ? { status: snapshot.status } : null;
const event = (sequence: number) => ({ sequence, summary: `Event ${sequence}` });

describe('durable SSE replay', () => {
  it('sends heartbeats while queued without inventing progress, then expires for reconnect', async () => {
    vi.useFakeTimers();
    try {
      const initial: Snapshot = { status: 'queued', events: [] };
      const response = durableEventStream({
        initial,
        after: 0,
        load: async () => initial,
        events: (snapshot) => snapshot.events,
        terminal,
        eventName: 'runtime',
        signal: new AbortController().signal,
        heartbeatMs: 10,
        pollMs: 5,
        lifetimeMs: 35,
      });
      const body = response.text();
      await vi.advanceTimersByTimeAsync(40);
      const text = await body;
      expect(text.match(/: heartbeat/g)).toHaveLength(3);
      expect(text).toContain('event: snapshot');
      expect(text).not.toMatch(/event: runtime|event: terminal/);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays ordered unique events and drains terminal pages from the cursor', async () => {
    const load = vi.fn(async (after: number): Promise<Snapshot> => ({
      status: 'completed',
      events: after < 4 ? [event(3), event(4)] : [],
    }));
    const response = durableEventStream({
      initial: { status: 'completed', events: [event(3), event(2), event(3), event(1)] },
      after: 1,
      load,
      events: (snapshot) => snapshot.events,
      terminal,
      eventName: 'runtime',
      signal: new AbortController().signal,
    });
    const body = await response.text();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.match(/^id: \d+$/gm)).toEqual(['id: 2', 'id: 3', 'id: 4']);
    expect(body).toContain('event: terminal');
    expect(load.mock.calls.map(([cursor]) => cursor)).toEqual([3, 4]);
  });

  it('ends an already completed stream without another execution read', async () => {
    const load = vi.fn();
    const response = durableEventStream({
      initial: { status: 'completed', events: [] },
      after: 12,
      load,
      events: (snapshot: Snapshot) => snapshot.events,
      terminal,
      eventName: 'execution',
      signal: new AbortController().signal,
    });
    expect(await response.text()).toContain('event: terminal');
    expect(load).not.toHaveBeenCalled();
  });

  it('stops reading after disconnect without aborting the worker signal', async () => {
    const request = new AbortController();
    const load = vi.fn();
    const response = durableEventStream({
      initial: { status: 'running', events: [] },
      after: 0,
      load,
      events: (snapshot: Snapshot) => snapshot.events,
      terminal,
      eventName: 'runtime',
      signal: request.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(request.signal.aborted).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('redacts a failed read after authorization is lost', async () => {
    const response = durableEventStream({
      initial: { status: 'running', events: [event(1)] },
      after: 0,
      load: async () => {
        throw new Error('secret database detail');
      },
      events: (snapshot: Snapshot) => snapshot.events,
      terminal,
      eventName: 'runtime',
      signal: new AbortController().signal,
    });
    const body = await response.text();
    expect(body).toContain('STREAM_UNAVAILABLE');
    expect(body).not.toContain('secret');
  });
});
