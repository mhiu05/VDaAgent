import { describe, expect, it } from 'vitest';
import { createRepository } from '../repository';
import {
  createLegacyTestDatabase,
  pgliteDriver,
  TEST_ORGS,
  TEST_USERS,
  upgradeTestDatabase,
} from '../../../../tests/helpers/postgres.js';

describe('workflow claim boundary', () => {
  it('inventories an unknown historical version without blocking a valid queued run', async () => {
    const pg = await createLegacyTestDatabase();
    try {
      const org = TEST_ORGS.alpha;
      const actor = TEST_USERS.owner;
      await pg.query('INSERT INTO organizations(org_id,name) VALUES($1,$2)', [org, 'Alpha']);
      await pg.query('INSERT INTO organization_members(org_id,user_id,role) VALUES($1,$2,$3)', [
        org,
        actor,
        'owner',
      ]);
      const request = {
        org_id: org,
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
        question: 'Inventory',
        conversation_id: null,
      };
      for (let index = 0; index < 101; index++) {
        const id = `61000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        await pg.query(
          `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,
           status,fencing_token,created_at,payload) VALUES($1,$2,$3,$4,$5,'queued',0,$6,$7)`,
          [
            org,
            id,
            actor,
            id,
            id,
            '2019-01-01T00:00:00Z',
            JSON.stringify({ workflow_version: 'agent-v1' }),
          ],
        );
      }
      await pg.query(
        `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,
         status,fencing_token,created_at,payload) VALUES($1,$2,$3,$4,$5,'queued',0,$6,$7)`,
        [
          org,
          '62000000-0000-4000-8000-000000000001',
          actor,
          'invalid-payload',
          'invalid-payload',
          '2019-01-01T00:00:00Z',
          JSON.stringify('broken'),
        ],
      );
      for (const [id, version, date] of [
        ['60000000-0000-4000-8000-000000000001', 'future-v2', '2020-01-01T00:00:00Z'],
        ['60000000-0000-4000-8000-000000000002', null, '2020-01-02T00:00:00Z'],
        ['60000000-0000-4000-8000-000000000003', 2, '2020-01-03T00:00:00Z'],
        ['60000000-0000-4000-8000-000000000004', 'malformed', '2020-01-04T00:00:00Z'],
        ['60000000-0000-4000-8000-000000000005', 'missing', '2020-01-05T00:00:00Z'],
        ['60000000-0000-4000-8000-000000000006', 'agent-v1', '2020-01-06T00:00:00Z'],
      ]) {
        const run = {
          run_id: id,
          org_id: org,
          created_by: actor,
          request,
          status: 'queued',
          created_at: date,
          updated_at: date,
          idempotency_key: id,
          request_hash: id,
          entrypoint: 'interactive',
          occurrence_id: null,
          attempt: 0,
          fencing_token: 0,
          lease_until: null,
          error_code: null,
          report_artifact_id: null,
          cancel_requested: false,
          ...(version === 'missing'
            ? {}
            : { workflow_version: version === 'malformed' ? 'agent-v1' : version }),
        };
        if (version === 'malformed') delete (run as { request?: unknown }).request;
        await pg.query(
          `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,
          status,fencing_token,created_at,payload) VALUES($1,$2,$3,$4,$5,'queued',0,$6,$7)`,
          [org, id, actor, id, id, date, JSON.stringify(run)],
        );
      }
      await upgradeTestDatabase(pg);
      const repo = await createRepository({ driver: pgliteDriver(pg) });
      try {
        expect(await repo.activeUnknownWorkflowVersions()).toEqual(
          expect.arrayContaining([
            { workflow_version: 'future-v2', count: 1 },
            { workflow_version: '[null-version]', count: 1 },
            { workflow_version: '[invalid-version-type]', count: 1 },
            { workflow_version: '[malformed-run]', count: 102 },
            { workflow_version: '[invalid-payload]', count: 1 },
          ]),
        );
        const lease = await repo.claimRun('worker');
        expect(lease?.run.run_id).toBe('60000000-0000-4000-8000-000000000005');
        expect(lease?.run.workflow_version).toBe('legacy-v1');
        expect((await repo.claimRun('worker-two'))?.run.run_id).toBe(
          '60000000-0000-4000-8000-000000000006',
        );
        expect(
          (
            await pg.query('SELECT status FROM runs WHERE id=$1', [
              '60000000-0000-4000-8000-000000000001',
            ])
          ).rows[0],
        ).toMatchObject({ status: 'queued' });
      } finally {
        await repo.close();
      }
    } finally {
      await pg.close();
    }
  });
});
