import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn(async () => Response.json({ ok: true })));
vi.mock('../../src/frontend/server/api/router', () => ({ api }));

import {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  runtime,
  dynamic,
} from '../../src/frontend/app/api/[...path]/route';

describe('/api adapter', () => {
  it('forwards every supported verb and the resolved path to the same router', async () => {
    const path = ['conversations', 'thread-id', 'context'];
    for (const [method, handler] of Object.entries({ GET, POST, PUT, PATCH, DELETE })) {
      const request = new Request('http://localhost/api/conversations/thread-id/context', {
        method,
      });
      expect((await handler(request, { params: Promise.resolve({ path }) })).status).toBe(200);
      expect(api).toHaveBeenLastCalledWith(request, path);
    }
    expect(api).toHaveBeenCalledTimes(5);
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });
});
