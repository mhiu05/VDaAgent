import { afterEach, describe, expect, it } from 'vitest';
import type { AnalysisRequest } from '@vda/contracts';
import { createRepository } from '../../../src/backend/database/repository';
import {
  createLegacyTestDatabase,
  createTestRepository,
  pgliteDriver,
  TEST_ORGS,
  TEST_USERS,
} from '../../helpers/postgres';

const resources: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of resources.splice(0)) await close();
});

const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};

describe('tenant repository boundaries', () => {
  it('refuses startup when durable agent schema is absent', async () => {
    const pg = await createLegacyTestDatabase();
    resources.push(() => pg.close());
    await expect(createRepository({ driver: pgliteDriver(pg) })).rejects.toThrow(
      'AGENT_EXECUTION_SCHEMA_REQUIRED',
    );
  });

  it('pins agent-v1, deduplicates the same request and rejects changed identity', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push(async () => {
      await repo.close();
      await pg.close();
    });
    const first = await repo.createRun(TEST_USERS.owner, request, 'same-key');
    const replay = await repo.createRun(TEST_USERS.owner, request, 'same-key');
    expect(first.workflow_version).toBe('agent-v1');
    expect(replay.run_id).toBe(first.run_id);
    await expect(
      repo.createRun(TEST_USERS.owner, { ...request, question: 'Different' }, 'same-key'),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('denies viewer mutations and foreign tenant reads', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push(async () => {
      await repo.close();
      await pg.close();
    });
    await expect(repo.createRun(TEST_USERS.viewer, request, 'viewer-key')).rejects.toThrow(
      'VIEWER_READ_ONLY',
    );
    await expect(repo.catalog(TEST_USERS.owner, TEST_ORGS.beta)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
  });
});
