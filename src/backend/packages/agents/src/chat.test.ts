import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDecisionProvider } from './provider';
import { AgentChatOrchestrator } from './chat';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';

const resources: { repo: Repository; close: () => Promise<void> }[] = [];
async function setup() {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return repo;
}
afterEach(async () => {
  for (const { repo, close } of resources.splice(0)) {
    await repo.close();
    await close();
  }
});

const input = {
  org_id: TEST_ORGS.alpha,
  client_turn_id: '70000000-0000-4000-8000-000000000001',
  text: 'Show current available inventory',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
};

describe('Agent Chat orchestrator', () => {
  it('starts one bounded, deterministic analysis through the typed tool', async () => {
    const repo = await setup();
    let decisions = 0;
    const provider: AgentDecisionProvider = {
      decide: async () => {
        decisions++;
        return { action: 'create_analysis', focus: 'current_inventory' };
      },
    };
    const orchestrator = new AgentChatOrchestrator(repo, provider);
    const accepted = await orchestrator.submit(TEST_USERS.owner, input, 'agent-create-one');
    expect(accepted).toMatchObject({ run_id: expect.any(String), assistant_status: 'in_progress' });
    await expect(orchestrator.submit(TEST_USERS.owner, input, 'agent-create-one')).resolves.toEqual(
      accepted,
    );
    expect(decisions).toBe(1);
    const page = await repo.listMessages(TEST_USERS.owner, input.org_id, accepted.conversation_id, {
      limit: 30,
      cursor: null,
    });
    expect(page.messages).toHaveLength(2);
    expect(page.messages.at(-1)).toMatchObject({
      role: 'assistant',
      run_id: accepted.run_id,
      parts: expect.arrayContaining([
        expect.objectContaining({ type: 'run_ref', status: 'queued' }),
      ]),
    });
  });

  it('persists an honest unsupported response without creating a run', async () => {
    const repo = await setup();
    const provider: AgentDecisionProvider = {
      decide: async () => ({ action: 'unsupported', reason_code: 'UNSUPPORTED_REQUEST' }),
    };
    const accepted = await new AgentChatOrchestrator(repo, provider).submit(
      TEST_USERS.owner,
      input,
      'agent-unsupported-one',
    );
    expect(accepted).toMatchObject({ run_id: null, assistant_status: 'completed' });
    expect(await repo.listRuns(TEST_USERS.owner, input.org_id)).toHaveLength(0);
  });

  it('persists a provider outage as a safe terminal message', async () => {
    const repo = await setup();
    const provider: AgentDecisionProvider = {
      decide: async () => {
        throw new Error('network unavailable');
      },
    };
    const accepted = await new AgentChatOrchestrator(repo, provider).submit(
      TEST_USERS.owner,
      input,
      'agent-provider-one',
    );
    expect(accepted).toMatchObject({ run_id: null, assistant_status: 'failed' });
    const page = await repo.listMessages(TEST_USERS.owner, input.org_id, accepted.conversation_id, {
      limit: 30,
      cursor: null,
    });
    expect(page.messages.at(-1)?.parts).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'ALL_AGENT_PROVIDERS_FAILED' }),
    );
  });
});
