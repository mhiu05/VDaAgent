import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { ThreadContextSchema, type AgentTurnRequest } from '@vda/contracts';
import { createTestRepository } from '../../../backend/tests/helpers/postgres';
import { runtimeWorkspaceRoutes } from './api/routes/runtime-workspace';
import { conversationRoutes } from './api/routes/conversations';
import type { AuthenticatedRouteContext } from './api/routes/route-context';

const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
afterEach(async () => { for (const resource of resources.splice(0)) { await resource.repo.close(); await resource.close(); } });
const input: AgentTurnRequest = {
  org_id: TEST_ORGS.alpha, client_turn_id: '70000000-0000-4000-8000-000000000042',
  text: 'Analyze inventory', scope: { project_external_id: 'P-ALPHA', zone_external_id: null }, data_as_of: '2026-09-19',
};
async function fixture() {
  const { repo, pg } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return repo;
}
function context(repo: Repository, path: string[], options: { method?: string; payload?: unknown; headers?: Record<string, string>; org?: string } = {}): AuthenticatedRouteContext {
  const org = options.org ?? TEST_ORGS.alpha;
  const method = options.method ?? 'GET';
  const url = new URL(`http://localhost/api/v1/${path.join('/')}?org_id=${org}`);
  const request = new Request(url, { method, headers: { 'content-type': 'application/json', ...options.headers },
    ...(options.payload ? { body: JSON.stringify(options.payload) } : {}),
  });
  return { request, path, method, url, route: path.join('/'), repo,
    actor: { user_id: TEST_USERS.owner, email: 'owner@example.test' }, orgFromQuery: () => org,
    agentTurnFromBody: async () => input, pageFromQuery: () => ({ limit: 30, cursor: null }),
  };
}

describe('runtime workspace API integration', () => {
  it('exposes definitions without server instructions and roundtrips no-report thread context', async () => {
    const repo = await fixture();
    const definitions = await runtimeWorkspaceRoutes(context(repo, ['agent-definitions']));
    const registry = await definitions!.json();
    expect(registry.agents.map((agent: { id: string }) => agent.id)).toContain('reviewer');
    expect(registry.agents.every((agent: { instructions: string }) => agent.instructions === '')).toBe(true);
    const turn = await repo.startTurn(TEST_USERS.owner, input, 'api-thread-context');
    const id = turn.conversation.conversation_id;
    const saved = await runtimeWorkspaceRoutes(context(repo, ['conversations', id, 'context'], {
      method: 'PUT', payload: ThreadContextSchema.parse({}),
    }));
    expect(await saved!.json()).toEqual(ThreadContextSchema.parse({}));
    const memory = await runtimeWorkspaceRoutes(context(repo, ['conversations', id, 'memory']));
    expect(await memory!.json()).toEqual({ items: [] });
  });

  it('streams persisted run snapshots and terminal state without starting another run', async () => {
    const repo = await fixture();
    const run = await repo.createRun(TEST_USERS.owner, { org_id: input.org_id, scope: input.scope, data_as_of: input.data_as_of,
      question: input.text, conversation_id: null }, 'api-runtime-stream');
    const lease = await repo.claimRun('runtime-api-test', new Date(), 120_000);
    if (!lease) throw new Error('LEASE_REQUIRED');
    await repo.recordRuntimeActivity(lease, { kind: 'invocation', step_key: 'test:main', agent_key: 'coordinator', status: 'running', summary: 'Preparing context' });
    await repo.failRun(lease, 'TEST_FAILURE');
    const response = await runtimeWorkspaceRoutes(context(repo, ['runs', run.run_id, 'events'], {
      headers: { accept: 'text/event-stream', 'last-event-id': '1' },
    }));
    const content = await response!.text();
    expect(content).toContain('event: snapshot');
    expect(content).toContain('event: runtime');
    expect(content).toContain('event: terminal');
    expect(content).not.toMatch(/^id: 1$/m);
    expect((await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha))).toHaveLength(1);
    await expect(runtimeWorkspaceRoutes(context(repo, ['runs', run.run_id, 'runtime'], { org: TEST_ORGS.beta }))).rejects.toThrow();
  });

  it('reconnects to a cancelled job without exposing lease ownership or provider data', async () => {
    const repo = await fixture();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner, input, 'api-job-stream');
    await repo.cancelAgentTurnJob(TEST_USERS.owner, TEST_ORGS.alpha, turn.job.job_id);
    const response = await conversationRoutes(context(repo, ['agent-turn-jobs', turn.job.job_id, 'events'], {
      headers: { accept: 'text/event-stream' },
    }));
    const content = await response!.text();
    expect(content).toContain('event: execution');
    expect(content).toContain('event: terminal');
    expect(content).not.toContain('fencing_token');
    expect(content).not.toContain('worker_id');
  });
});
