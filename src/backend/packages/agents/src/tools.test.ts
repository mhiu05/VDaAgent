import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { createAnalysisTool, getAnalysisResultTool, modelToolNames } from './tools';

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

const baseContext = {
  org_id: TEST_ORGS.alpha,
  conversation_id: '70000000-0000-4000-8000-000000000001',
  user_message_id: '70000000-0000-4000-8000-000000000002',
  assistant_message_id: '70000000-0000-4000-8000-000000000003',
  client_turn_id: '70000000-0000-4000-8000-000000000004',
  user_id: TEST_USERS.owner,
  role: 'owner' as const,
  question: 'Show inventory',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  idempotency_key: 'tool-test',
  allowed_run_ids: [],
};

describe('Agent Chat typed tools', () => {
  it('rejects malformed model inputs before repository execution', async () => {
    const repo = await setup();
    await expect(
      createAnalysisTool(repo, baseContext, { action: 'create_analysis', sql: 'select 1' }),
    ).rejects.toThrow();
  });

  it('rejects a run reference that was not in bounded conversation context', async () => {
    const repo = await setup();
    const run = await repo.createRun(
      TEST_USERS.owner,
      {
        org_id: TEST_ORGS.alpha,
        scope: baseContext.scope,
        data_as_of: baseContext.data_as_of,
        question: baseContext.question,
        conversation_id: null,
      },
      'out-of-context',
    );
    await expect(
      getAnalysisResultTool(repo, baseContext, {
        action: 'get_analysis_result',
        run_id: run.run_id,
      }),
    ).rejects.toThrow('RUN_REFERENCE_FORBIDDEN');
  });

  it('has only the two reviewed model-selectable capabilities', () => {
    expect(modelToolNames).toEqual(['create_analysis', 'get_analysis_result']);
  });
});
