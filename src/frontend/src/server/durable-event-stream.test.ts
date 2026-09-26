import { describe, expect, it, vi } from 'vitest';
import { durableEventStream } from './durable-event-stream';

type Snapshot = { status: string; events: { sequence: number; summary: string }[] };
const terminal = (snapshot: Snapshot) => snapshot.status === 'completed' ? { status: snapshot.status } : null;
const event = (sequence: number) => ({ sequence, summary: `Event ${sequence}` });

describe('durable snapshot and replay stream', () => {
  it('replays ordered unique events, drains terminal pages, and reconnects from the cursor', async () => {
    const load = vi.fn(async (after: number): Promise<Snapshot> => ({
      status: 'completed', events: after < 4 ? [event(3), event(4)] : [],
    }));
    const response = durableEventStream({
      initial: { status: 'completed', events: [event(3), event(2), event(3), event(1)] },
      after: 1, load, events: (s) => s.events, terminal, eventName: 'runtime',
      signal: new AbortController().signal,
    });
    const body = await response.text();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.match(/^id: \d+$/gm)).toEqual(['id: 2', 'id: 3', 'id: 4']);
    expect(body).toContain('event: snapshot');
    expect(body).toContain('event: terminal');
    expect(load.mock.calls.map(([cursor]) => cursor)).toEqual([3, 4]);
  });

  it('ends an already completed stream without restarting execution', async () => {
    const load = vi.fn();
    const response = durableEventStream({
      initial: { status: 'completed', events: [] }, after: 12, load,
      events: (s: Snapshot) => s.events, terminal, eventName: 'execution',
      signal: new AbortController().signal,
    });
    expect(await response.text()).toContain('event: terminal');
    expect(load).not.toHaveBeenCalled();
  });

  it('disconnect stops reads without touching the worker or its signal', async () => {
    const request = new AbortController();
    const load = vi.fn();
    const response = durableEventStream({
      initial: { status: 'running', events: [] }, after: 0, load,
      events: (s: Snapshot) => s.events, terminal, eventName: 'runtime', signal: request.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(request.signal.aborted).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('redacts stream errors after authorization is lost', async () => {
    const response = durableEventStream({
      initial: { status: 'running', events: [event(1)] }, after: 0,
      load: async () => { throw new Error('secret database detail'); },
      events: (s: Snapshot) => s.events, terminal, eventName: 'runtime',
      signal: new AbortController().signal,
    });
    const body = await response.text();
    expect(body).toContain('STREAM_UNAVAILABLE');
    expect(body).not.toContain('secret');
  });
});
