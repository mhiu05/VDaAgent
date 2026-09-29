import { describe, expect, it } from 'vitest';
import { createRepository } from '../../src/backend/database/repository';
import {
  createLegacyTestDatabase,
  pgliteDriver,
  TEST_ORGS,
  TEST_USERS,
  upgradeTestDatabase,
} from '../helpers/postgres';

const orgId = TEST_ORGS.alpha;
const actor = TEST_USERS.owner;
const request = {
  org_id: orgId,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
const id = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('workflow claiming across historical data', () => {
  it('reports unsupported historical versions and claims only canonical work past invalid rows', async () => {
    const pg = await createLegacyTestDatabase();
    try {
      await pg.query('INSERT INTO organizations(org_id,name) VALUES($1,$2)', [orgId, 'Alpha']);
      await pg.query('INSERT INTO organization_members(org_id,user_id,role) VALUES($1,$2,$3)', [
        orgId,
        actor,
        'owner',
      ]);
      async function insert(runId: string, date: string, payload: unknown) {
        await pg.query(
          `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,
          status,fencing_token,created_at,payload) VALUES($1,$2,$3,$4,$5,'queued',0,$6,$7)`,
          [orgId, runId, actor, runId, runId, date, JSON.stringify(payload)],
        );
      }
      for (let index = 0; index < 101; index++)
        await insert(id('61000000', index), '2019-01-01T00:00:00Z', {
          workflow_version: 'agent-v1',
        });
      await insert(id('62000000', 1), '2019-01-01T00:00:00Z', 'broken');
      const versions: Array<[string, unknown, string]> = [
        ['future-v2', 'future-v2', '2020-01-01T00:00:00Z'],
        ['null', null, '2020-01-02T00:00:00Z'],
        ['numeric', 2, '2020-01-03T00:00:00Z'],
        ['malformed', 'agent-v1', '2020-01-04T00:00:00Z'],
        ['missing', undefined, '2020-01-05T00:00:00Z'],
        ['legacy', 'legacy-v1', '2020-01-06T00:00:00Z'],
        ['agent', 'agent-v1', '2020-01-07T00:00:00Z'],
      ];
      for (const [name, version, date] of versions) {
        const runId = id('60000000', versions.findIndex((item) => item[0] === name) + 1);
        const payload: Record<string, unknown> = {
          run_id: runId,
          org_id: orgId,
          created_by: actor,
          request,
          status: 'queued',
          created_at: date,
          updated_at: date,
          idempotency_key: runId,
          request_hash: runId,
          entrypoint: 'interactive',
          occurrence_id: null,
          attempt: 0,
          fencing_token: 0,
          lease_until: null,
          error_code: null,
          report_artifact_id: null,
          cancel_requested: false,
        };
        if (version !== undefined) payload.workflow_version = version;
        if (name === 'malformed') delete payload.request;
        await insert(runId, date, payload);
      }
      await upgradeTestDatabase(pg);
      const repo = await createRepository({ driver: pgliteDriver(pg) });
      try {
        expect(await repo.activeUnsupportedWorkflowVersions()).toEqual(
          expect.arrayContaining([
            { workflow_version: 'future-v2', count: 1 },
            { workflow_version: 'legacy-v1', count: 2 },
            { workflow_version: '[null-version]', count: 1 },
            { workflow_version: '[invalid-version-type]', count: 1 },
            { workflow_version: '[malformed-run]', count: 102 },
            { workflow_version: '[invalid-payload]', count: 1 },
          ]),
        );
        expect((await repo.getRun(actor, orgId, id('60000000', 5))).run.workflow_version).toBe(
          'legacy-v1',
        );
        expect((await repo.getRun(actor, orgId, id('60000000', 6))).run.workflow_version).toBe(
          'legacy-v1',
        );
        expect((await repo.claimRun('worker-agent'))?.run.run_id).toBe(id('60000000', 7));
        expect(await repo.claimRun('worker-historical')).toBeNull();
        expect(
          (
            await pg.query('SELECT status FROM runs WHERE id IN ($1,$2) ORDER BY id', [
              id('60000000', 5),
              id('60000000', 6),
            ])
          ).rows,
        ).toEqual([{ status: 'queued' }, { status: 'queued' }]);
        expect(
          (await pg.query('SELECT status FROM runs WHERE id=$1', [id('60000000', 1)])).rows[0],
        ).toMatchObject({ status: 'queued' });
      } finally {
        await repo.close();
      }
    } finally {
      await pg.close();
    }
  }, 60_000);
});
