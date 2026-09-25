import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  config: { GROK_RUNTIME_ENABLED: true, GROK_SSE_ENABLED: true, DURABLE_AGENT_EXECUTION_ENABLED: false },
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
import { readGrant, repository } from './context';
import { RepositoryError, type Repository } from '@vda/db';
import { exportReport } from '@vda/agents';

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
  fixture.config.DURABLE_AGENT_EXECUTION_ENABLED = false;
  vi.mocked(repository).mockResolvedValue({} as Repository);
});

describe('SSE API routes', () => {
  it('enqueues durable JSON turns and keeps request-bound SSE disabled behind the flag', async () => {
    fixture.config.DURABLE_AGENT_EXECUTION_ENABLED = true;
    const enqueueAgentTurn = vi.fn().mockResolvedValue({
      conversation: { conversation_id: fixture.accepted.conversation_id },
      user_message: { message_id: fixture.accepted.user_message_id },
      assistant_message: { message_id: fixture.accepted.assistant_message_id,run_id:null,status:'in_progress' },
      job: { job_id: '70000000-0000-4000-8000-000000000001' },
    });
    vi.mocked(repository).mockResolvedValue({enqueueAgentTurn} as unknown as Repository);
    const durableInput = {...input,text:'Analyze the inventory'};
    const response = await api(request('conversations',{Accept:'application/json'},durableInput),['conversations']);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      agent_turn_job_id:'70000000-0000-4000-8000-000000000001',assistant_status:'in_progress',
    });
    expect(enqueueAgentTurn).toHaveBeenCalledOnce();
    const stream = await api(request('conversations/stream',{},durableInput),['conversations','stream']);
    expect(stream.status).toBe(404);
    const unsupported = await api(request('conversations',{Accept:'application/json'}),['conversations']);
    await expect(unsupported.json()).resolves.toMatchObject(fixture.accepted);
    expect(enqueueAgentTurn).toHaveBeenCalledOnce();
  });

  it('serves a bounded durable job snapshot and explicit cancel', async () => {
    const jobId = '70000000-0000-4000-8000-000000000001';
    const job = {
      job_id:jobId,org_id:input.org_id,conversation_id:fixture.accepted.conversation_id,
      user_message_id:fixture.accepted.user_message_id,
      assistant_message_id:fixture.accepted.assistant_message_id,
      created_by:'60000000-0000-4000-8000-000000000001',status:'queued',run_id:null,
      attempt:0,fencing_token:0,worker_id:null,lease_until:null,error_code:null,
      created_at:'2026-09-24T00:00:00.000Z',updated_at:'2026-09-24T00:00:00.000Z',
    };
    const getAgentTurnJob = vi.fn().mockResolvedValue({job,invocations:[],events:[]});
    const getLatestAgentTurnJob = vi.fn().mockResolvedValue({job,invocations:[],events:[]});
    const cancelAgentTurnJob = vi.fn().mockResolvedValue({...job,status:'cancelled'});
    vi.mocked(repository).mockResolvedValue({getAgentTurnJob,getLatestAgentTurnJob,cancelAgentTurnJob} as unknown as Repository);
    const url = new URL(`http://example.test/api/v1/agent-turn-jobs/${jobId}`);
    url.searchParams.set('org_id',input.org_id);
    url.searchParams.set('after','3');
    const snapshot = await api(new Request(url),['agent-turn-jobs',jobId]);
    expect(snapshot.status).toBe(200);
    expect(getAgentTurnJob).toHaveBeenCalledWith('60000000-0000-4000-8000-000000000001',input.org_id,jobId,3);
    const latestUrl = new URL(`http://example.test/api/v1/conversations/${job.conversation_id}/agent-turn-job`);
    latestUrl.searchParams.set('org_id',input.org_id);
    const latest = await api(new Request(latestUrl),['conversations',job.conversation_id,'agent-turn-job']);
    expect(latest.status).toBe(200);
    const latestBody = await latest.json();
    expect(latestBody).toMatchObject({job:{job_id:jobId,status:'queued'}});
    expect(latestBody.job.created_by).toBeUndefined();
    const cancelled = await api(request(`agent-turn-jobs/${jobId}/cancel`),['agent-turn-jobs',jobId,'cancel']);
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({status:'cancelled'});
  });
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

describe('workflow status API authorization', () => {
  const runId = '70000000-0000-4000-8000-000000000001';
  const url = `http://example.test/api/v1/runs/${runId}/workflow-status?org_id=${input.org_id}`;

  it('authorizes mutation access before reading private workflow state', async () => {
    const authorize = vi.fn(async () => 'owner' as const);
    const getRun = vi.fn(async () => ({
      run: { run_id: runId, org_id: input.org_id, workflow_version: 'agent-v1' },
      tasks: [],
    }));
    const artifacts = vi.fn(async () => ({ artifacts: [] }));
    vi.mocked(repository).mockResolvedValue({
      authorize,
      getRun,
      artifacts,
    } as unknown as Repository);

    const response = await api(new Request(url), ['runs', runId, 'workflow-status']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run_id: runId,
      org_id: input.org_id,
      workflow_version: 'agent-v1',
      draft_revision: null,
      review: null,
    });
    expect(authorize).toHaveBeenCalledWith(
      '60000000-0000-4000-8000-000000000001',
      input.org_id,
      true,
    );
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(getRun.mock.invocationCallOrder[0]);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      artifacts.mock.invocationCallOrder[0],
    );
  });

  it('does not read private workflow state after authorization fails', async () => {
    const authorize = vi.fn(async () => {
      throw new RepositoryError('FORBIDDEN', 403);
    });
    const getRun = vi.fn();
    const artifacts = vi.fn();
    vi.mocked(repository).mockResolvedValue({
      authorize,
      getRun,
      artifacts,
    } as unknown as Repository);

    const response = await api(new Request(url), ['runs', runId, 'workflow-status']);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ title: 'FORBIDDEN' });
    expect(getRun).not.toHaveBeenCalled();
    expect(artifacts).not.toHaveBeenCalled();
  });
});

describe('GET resource route parity', () => {
  const id = '70000000-0000-4000-8000-000000000001';
  const routes = [
    { path: ['session'], method: 'session' },
    { path: ['catalog'], method: 'catalog' },
    { path: ['workspace-summary'], method: 'listRuns' },
    { path: ['runs'], method: 'listRuns' },
    { path: ['runs', id], method: 'getRun' },
    { path: ['runs', id, 'artifacts'], method: 'artifacts' },
    { path: ['runs', id, 'workflow-status'], method: 'authorize' },
    { path: ['runs', id, 'brief'], method: 'decisionBrief' },
    { path: ['runs', id, 'decision-intelligence'], method: 'decisionIntelligence' },
    { path: ['messages'], method: 'messages' },
    { path: ['conversations'], method: 'listConversations' },
    { path: ['conversations', id], method: 'getConversation' },
    { path: ['conversations', id, 'messages'], method: 'listMessages' },
    { path: ['imports'], method: 'listImports' },
    { path: ['report-definitions'], method: 'listDefinitions' },
    { path: ['reports'], method: 'listReports' },
    { path: ['reports', id], method: 'getReport' },
  ] as const;

  it.each(routes)('dispatches $path to $method after authentication', async ({ path, method }) => {
    const selected = vi.fn(async () => {
      throw new RepositoryError('ROUTE_SENTINEL', 418);
    });
    const workspaceReads =
      path[0] === 'workspace-summary'
        ? {
            listReports: vi.fn(async () => []),
            listImports: vi.fn(async () => []),
            listConversations: vi.fn(async () => ({ conversations: [] })),
            listDefinitions: vi.fn(async () => []),
          }
        : {};
    vi.mocked(repository).mockResolvedValue({
      [method]: selected,
      ...workspaceReads,
    } as unknown as Repository);
    const url = new URL(`http://example.test/api/v1/${path.join('/')}`);
    url.searchParams.set('org_id', input.org_id);
    url.searchParams.set('conversation_id', id);

    const response = await api(new Request(url), [...path]);
    expect(response.status).toBe(418);
    await expect(response.json()).resolves.toMatchObject({ title: 'ROUTE_SENTINEL' });
    expect(selected).toHaveBeenCalledTimes(1);
  });
});

describe('mutation route parity', () => {
  const id = '70000000-0000-4000-8000-000000000001';
  const reportDefinition = {
    org_id: input.org_id,
    name: 'Daily report',
    scope: input.scope,
    timezone: 'UTC',
    local_time: '09:00',
  };
  const routes = [
    {
      path: ['analyses'],
      method: 'POST',
      repositoryMethod: 'createRun',
      payload: {
        org_id: input.org_id,
        scope: input.scope,
        data_as_of: input.data_as_of,
        question: 'Inspect inventory.',
      },
    },
    {
      path: ['runs', id, 'cancel'],
      method: 'POST',
      repositoryMethod: 'cancelRun',
      payload: { org_id: input.org_id },
    },
    {
      path: ['imports'],
      method: 'POST',
      repositoryMethod: 'importCsv',
      payload: {
        org_id: input.org_id,
        source_name: 'inventory.csv',
        csv: 'project_id,zone_id\nP-ALPHA,Z-1',
      },
    },
    {
      path: ['report-definitions'],
      method: 'POST',
      repositoryMethod: 'createDefinition',
      payload: reportDefinition,
    },
    {
      path: ['report-definitions', id],
      method: 'PATCH',
      repositoryMethod: 'updateDefinition',
      payload: reportDefinition,
    },
    {
      path: ['report-definitions', id],
      method: 'DELETE',
      repositoryMethod: 'deleteDefinition',
      payload: null,
    },
    {
      path: ['report-definitions', id, 'trigger'],
      method: 'POST',
      repositoryMethod: 'triggerDefinition',
      payload: { org_id: input.org_id },
    },
    {
      path: ['scheduler', 'tick'],
      method: 'POST',
      repositoryMethod: 'tick',
      payload: { org_id: input.org_id },
    },
    {
      path: ['reports', id, 'exports'],
      method: 'POST',
      repositoryMethod: 'getReport',
      payload: { format: 'json' },
    },
  ] as const;

  it.each(routes)(
    'dispatches $method $path to $repositoryMethod',
    async ({ path, method, repositoryMethod, payload }) => {
      const selected = vi.fn(async () => {
        throw new RepositoryError('ROUTE_SENTINEL', 418);
      });
      vi.mocked(repository).mockResolvedValue({
        [repositoryMethod]: selected,
      } as unknown as Repository);
      const url = new URL(`http://example.test/api/v1/${path.join('/')}`);
      url.searchParams.set('org_id', input.org_id);
      const response = await api(
        new Request(url, {
          method,
          headers: payload
            ? { 'Content-Type': 'application/json', 'Idempotency-Key': 'route-test' }
            : {},
          body: payload ? JSON.stringify(payload) : undefined,
        }),
        [...path],
      );
      expect(response.status).toBe(418);
      await expect(response.json()).resolves.toMatchObject({ title: 'ROUTE_SENTINEL' });
      expect(selected).toHaveBeenCalledTimes(1);
    },
  );
});

describe('report download route', () => {
  const id = '70000000-0000-4000-8000-000000000001';
  const url = `http://example.test/api/v1/reports/${id}/download?token=download-token`;

  it('keeps attachment headers and resolves the signed tenant through the repository', async () => {
    vi.mocked(readGrant).mockReturnValue({
      user_id: '60000000-0000-4000-8000-000000000001',
      org_id: input.org_id,
      report_id: id,
      format: 'csv',
      expires: Date.now() + 60_000,
    });
    const getReport = vi.fn(async () => ({ artifact: { kind: 'report' } }));
    vi.mocked(repository).mockResolvedValue({ getReport } as unknown as Repository);
    vi.mocked(exportReport).mockReturnValue({
      body: 'col\nvalue',
      contentType: 'text/csv',
    } as ReturnType<typeof exportReport>);

    const response = await api(new Request(url), ['reports', id, 'download']);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="vda-report-${id}.csv"`,
    );
    expect(response.headers.get('content-type')).toBe('text/csv');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('col\nvalue');
    expect(getReport).toHaveBeenCalledWith(
      '60000000-0000-4000-8000-000000000001',
      input.org_id,
      id,
    );
  });

  it('rejects a signed grant for a different report before repository reads', async () => {
    vi.mocked(readGrant).mockReturnValue({
      user_id: '60000000-0000-4000-8000-000000000001',
      org_id: input.org_id,
      report_id: '70000000-0000-4000-8000-000000000099',
      format: 'json',
      expires: Date.now() + 60_000,
    });
    const getReport = vi.fn();
    vi.mocked(repository).mockResolvedValue({ getReport } as unknown as Repository);

    const response = await api(new Request(url), ['reports', id, 'download']);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ title: 'DOWNLOAD_DENIED' });
    expect(getReport).not.toHaveBeenCalled();
  });
});
