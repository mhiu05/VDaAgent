import { afterEach, describe, expect, it } from 'vitest';
import { ThreadContextSchema, type AgentTurnRequest } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { runtimeWorkspaceRoutes } from '../../src/frontend/server/api/routes/runtime-workspace';
import { conversationRoutes } from '../../src/frontend/server/api/routes/conversations';
import type { AuthenticatedRouteContext } from '../../src/frontend/server/api/routes/route-context';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../helpers/postgres';

const resources: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of resources.splice(0)) await close();
});

const turnInput: AgentTurnRequest = {
  org_id: TEST_ORGS.alpha,
  client_turn_id: '70000000-0000-4000-8000-000000000042',
  text: 'Analyze inventory',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};

function routeContext(
  repo: Repository,
  path: string[],
  options: {
    method?: string;
    payload?: unknown;
    org?: string;
    headers?: Record<string, string>;
  } = {},
): AuthenticatedRouteContext {
  const method = options.method ?? 'GET';
  const org = options.org ?? TEST_ORGS.alpha;
  const url = new URL(`http://localhost/api/${path.join('/')}?org_id=${org}`);
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...options.headers },
    ...(options.payload !== undefined ? { body: JSON.stringify(options.payload) } : {}),
  });
  return {
    request,
    path,
    method,
    url,
    route: path.join('/'),
    repo,
    actor: { user_id: TEST_USERS.owner, email: 'owner@example.test' },
    orgFromQuery: () => org,
    agentTurnFromBody: async () => turnInput,
    pageFromQuery: () => ({ limit: 30, cursor: null }),
  } as AuthenticatedRouteContext;
}

describe('authorized runtime workspace routes', () => {
  it('roundtrips an empty context through PUT and keeps definitions free of server instructions', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push(async () => {
      await repo.close();
      await pg.close();
    });
    const definitions = await runtimeWorkspaceRoutes(routeContext(repo, ['agent-definitions']));
    const registry = await definitions!.json();
    expect(registry.agents.map((agent: { id: string }) => agent.id)).toContain('reviewer');
    expect(
      registry.agents.every((agent: { instructions: string }) => agent.instructions === ''),
    ).toBe(true);

    const turn = await repo.startTurn(TEST_USERS.owner, turnInput, 'root-api-context');
    const path = ['conversations', turn.conversation.conversation_id, 'context'];
    const value = ThreadContextSchema.parse({});
    const put = await runtimeWorkspaceRoutes(
      routeContext(repo, path, { method: 'PUT', payload: value }),
    );
    expect(await put!.json()).toEqual(value);
    const get = await runtimeWorkspaceRoutes(routeContext(repo, path));
    expect(await get!.json()).toEqual(value);
    await expect(
      runtimeWorkspaceRoutes(routeContext(repo, path, { org: TEST_ORGS.beta })),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');
  });

  it('replays persisted run state without creating another run', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push(async () => {
      await repo.close();
      await pg.close();
    });
    const run = await repo.createRun(
      TEST_USERS.owner,
      {
        org_id: turnInput.org_id,
        scope: turnInput.scope!,
        data_as_of: turnInput.data_as_of!,
        question: turnInput.text,
        conversation_id: null,
      },
      'root-api-runtime',
    );
    const lease = await repo.claimRun('api-test', new Date(), 120_000);
    if (!lease) throw new Error('LEASE_REQUIRED');
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:data',
      agent_key: 'data',
      status: 'running',
      summary: 'Preparing context',
    });
    await repo.failRun(lease, 'TEST_FAILURE');
    const response = await runtimeWorkspaceRoutes(
      routeContext(repo, ['runs', run.run_id, 'events'], {
        headers: { accept: 'text/event-stream', 'last-event-id': '1' },
      }),
    );
    const content = await response!.text();
    expect(content).toContain('event: snapshot');
    expect(content).toContain('event: runtime');
    expect(content).toContain('event: terminal');
    expect(await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(1);
  });

  it('reconnects to a cancelled turn through public events without lease metadata', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push(async () => {
      await repo.close();
      await pg.close();
    });
    const accepted = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      turnInput,
      'root-api-cancelled-job',
    );
    await repo.cancelAgentTurnJob(TEST_USERS.owner, TEST_ORGS.alpha, accepted.job.job_id);
    const response = await conversationRoutes(
      routeContext(repo, ['agent-turn-jobs', accepted.job.job_id, 'events'], {
        headers: { accept: 'text/event-stream' },
      }),
    );
    const content = await response!.text();
    expect(content).toContain('event: execution');
    expect(content).toContain('event: terminal');
    expect(content).not.toMatch(/fencing_token|worker_id/);
  });

  it('serves scoped agent views and rejects foreign or invalid focus', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push(async () => {
      await repo.close();
      await pg.close();
    });
    const accepted = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      { ...turnInput, agent_target: 'data' },
      'agent-view-api',
    );
    const conversation = accepted.conversation.conversation_id;
    const summary = await runtimeWorkspaceRoutes(
      routeContext(repo, ['conversations', conversation, 'agents']),
    );
    expect((await summary!.json()).agents).toHaveLength(8);
    const path = ['conversations', conversation, 'agents', 'data', 'messages'];
    const feed = await runtimeWorkspaceRoutes(routeContext(repo, path));
    const items = (await feed!.json()).items;
    expect(items).toHaveLength(2);
    const focus = routeContext(repo, path);
    focus.url.searchParams.set('focus_item', items[0].item_id);
    expect((await (await runtimeWorkspaceRoutes(focus))!.json()).focus_item).toBe(items[0].item_id);
    const wrongAgent = routeContext(repo, [
      'conversations',
      conversation,
      'agents',
      'insight',
      'messages',
    ]);
    wrongAgent.url.searchParams.set('focus_item', items[0].item_id);
    await expect(runtimeWorkspaceRoutes(wrongAgent)).rejects.toThrow('AGENT_ITEM_NOT_FOUND');
    await expect(
      runtimeWorkspaceRoutes(routeContext(repo, path, { org: TEST_ORGS.beta })),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');
    const work = await runtimeWorkspaceRoutes(
      routeContext(repo, ['conversations', conversation, 'agents', 'data', 'work']),
    );
    expect((await work!.json()).items).toHaveLength(1);
  });
});
