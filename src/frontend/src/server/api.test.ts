import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  config: { GROK_RUNTIME_ENABLED: true, GROK_SSE_ENABLED: true },
  accepted: {
    conversation_id: '30000000-0000-4000-8000-000000000001',
    user_message_id: '40000000-0000-4000-8000-000000000001',
    assistant_message_id: '50000000-0000-4000-8000-000000000001',
    run_id: null,
    assistant_status: 'completed',
  },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@vda/config', () => ({ getConfig: () => fixture.config }));
vi.mock('./context', () => ({
  DEVELOPMENT_ROLE_COOKIE: 'development-role',
  developmentPrincipal: vi.fn(),
  principal: vi.fn(async () => ({ user_id: '60000000-0000-4000-8000-000000000001' })),
  readGrant: vi.fn(),
  repository: vi.fn(async () => ({})),
  signGrant: vi.fn(),
  supabaseClient: vi.fn(),
}));
vi.mock('@vda/agents', () => {
  class RuntimeContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  class AgentRuntime {
    private readonly sink: ((event: unknown) => void) | undefined;

    constructor(_repo: unknown, options: { activity_sink?: (event: unknown) => void } = {}) {
      this.sink = options.activity_sink;
    }

    async submit() {
      this.sink?.({
        version: 'agent-activity-v1',
        sequence: 0,
        type: 'context_started',
        label: 'understanding_context',
        capability: null,
        run_id: null,
        artifact_id: null,
        error_code: null,
      });
      return fixture.accepted;
    }
  }
  class AgentChatOrchestrator {
    async submit() {
      return fixture.accepted;
    }
  }
  const assertWorkspaceConversationCoherence = (
    value: { workspace_context?: { conversation_id: string | null } | null },
    routeConversationId?: string,
  ) => {
    if (
      value.workspace_context &&
      value.workspace_context.conversation_id !== (routeConversationId ?? null)
    )
      throw new RuntimeContextError('NO_AUTHORIZED_RESULT');
  };
  return {
    AgentRuntime,
    AgentChatOrchestrator,
    RuntimeContextError,
    assertWorkspaceConversationCoherence,
    exportReport: vi.fn(),
  };
});

import { api } from './api';

const input = {
  org_id: '10000000-0000-4000-8000-000000000001',
  client_turn_id: '20000000-0000-4000-8000-000000000001',
  text: 'Inspect the authorized result.',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};

function request(
  path: string,
  headers: Record<string, string> = {},
  payload: Record<string, unknown> = input,
) {
  const url = new URL('http://example.test/api/v1/' + path);
  url.searchParams.set('org_id', input.org_id);
  return new Request(url, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'turn-stream',
      Origin: 'http://example.test',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function workspaceContext(conversationId: string | null) {
  return {
    version: 1,
    mode: 'agent_chat',
    org_id: input.org_id,
    conversation_id: conversationId,
    scope: input.scope,
    data_as_of: input.data_as_of,
    active_run_ref: null,
    active_report_ref: null,
    active_artifact_ref: null,
    dashboard_selection: null,
    drilldown: null,
    evidence_ref: null,
  };
}

afterEach(() => {
  fixture.config.GROK_RUNTIME_ENABLED = true;
  fixture.config.GROK_SSE_ENABLED = true;
});

describe('SSE API routes', () => {
  it('uses the same POST safeguards and returns safe ordered stream frames', async () => {
    const response = await api(request('conversations/stream'), ['conversations', 'stream']);
    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('private, no-store, no-transform');
    const text = await response.text();
    expect(text).toContain('event: activity');
    expect(text).toContain('event: terminal');
    expect(text).toContain('context_started');
    expect(text).not.toContain('prompt');
  });

  it('keeps the JSON conversation route compatible', async () => {
    const response = await api(request('conversations', { Accept: 'application/json' }), [
      'conversations',
    ]);
    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject(fixture.accepted);
  });

  it('accepts the exact nested conversation stream route', async () => {
    const conversationId = '30000000-0000-4000-8000-000000000001';
    const response = await api(request('conversations/' + conversationId + '/messages/stream'), [
      'conversations',
      conversationId,
      'messages',
      'stream',
    ]);
    expect(response.status).toBe(202);
    expect(await response.text()).toContain('event: terminal');
  });

  it('makes the query organization authoritative before either chat runtime is selected', async () => {
    fixture.config.GROK_RUNTIME_ENABLED = false;
    const response = await api(
      request(
        'conversations',
        { Accept: 'application/json' },
        { ...input, org_id: '10000000-0000-4000-8000-000000000099' },
      ),
      ['conversations'],
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ title: 'NO_AUTHORIZED_RESULT' });
  });

  it('rejects conflicting workspace conversation snapshots before legacy JSON dispatch', async () => {
    fixture.config.GROK_RUNTIME_ENABLED = false;
    const response = await api(
      request(
        'conversations',
        { Accept: 'application/json' },
        {
          ...input,
          workspace_context: workspaceContext('30000000-0000-4000-8000-000000000001'),
        },
      ),
      ['conversations'],
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ title: 'NO_AUTHORIZED_RESULT' });
  });

  it('rejects a conflicting workspace conversation before opening an SSE stream', async () => {
    const conversationId = '30000000-0000-4000-8000-000000000001';
    const response = await api(
      request(
        'conversations/' + conversationId + '/messages/stream',
        {},
        { ...input, workspace_context: workspaceContext(null) },
      ),
      ['conversations', conversationId, 'messages', 'stream'],
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ title: 'NO_AUTHORIZED_RESULT' });
  });

  it('requires the flag and an SSE Accept header', async () => {
    fixture.config.GROK_SSE_ENABLED = false;
    let response = await api(request('conversations/stream'), ['conversations', 'stream']);
    expect(response.status).toBe(404);
    fixture.config.GROK_SSE_ENABLED = true;
    response = await api(request('conversations/stream', { Accept: 'application/json' }), [
      'conversations',
      'stream',
    ]);
    expect(response.status).toBe(406);
  });

  it('reuses the JSON body limit before opening a stream', async () => {
    const response = await api(request('conversations/stream', { 'Content-Length': '2100001' }), [
      'conversations',
      'stream',
    ]);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ title: 'BODY_TOO_LARGE' });
  });

  it('rejects a cross-origin stream request before it can run', async () => {
    const response = await api(
      request('conversations/stream', { Origin: 'https://evil.example' }),
      ['conversations', 'stream'],
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ title: 'ORIGIN_DENIED' });
  });
});
