import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { CoordinatorError, coordinateRun } from './coordinator';

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

const request = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};

describe('deterministic Coordinator adapter', () => {
  it('selects the registered use case without metrics, SQL, or date substitution', async () => {
    const repo = await setup();
    const created = await repo.createRun(TEST_USERS.owner, request, 'coordinator-interactive');
    const { run } = await repo.getRun(TEST_USERS.owner, created.org_id, created.run_id);
    const decision = coordinateRun({ run });
    expect(decision).toMatchObject({
      use_case: 'slow_moving_inventory',
      use_case_version: 'slow-moving-inventory-v1',
      scope: request.scope,
      requested_data_as_of: request.data_as_of,
      effective_data_as_of: request.data_as_of,
      comparison_windows_days: [7, 30, 90],
      entrypoint: 'interactive',
      action: 'new_run',
    });
    expect(coordinateRun({ run })).toEqual(decision);
  });

  it('uses the same registered data decision for scheduled input', async () => {
    const repo = await setup();
    const interactive = await repo.createRun(TEST_USERS.owner, request, 'coordinator-parity');
    const definition = await repo.createDefinition(
      TEST_USERS.owner,
      {
        org_id: request.org_id,
        name: 'Daily',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '09:00',
        data_as_of_policy: 'scheduled_date',
        enabled: true,
      },
      new Date('2026-09-18T00:00:00Z'),
    );
    const occurrence = await repo.triggerDefinition(
      TEST_USERS.owner,
      request.org_id,
      definition.report_definition_id,
      new Date('2026-09-19T02:00:00Z'),
    );
    const [interactiveRun, scheduledRun] = await Promise.all([
      repo.getRun(TEST_USERS.owner, request.org_id, interactive.run_id),
      repo.getRun(TEST_USERS.owner, request.org_id, occurrence.run_id),
    ]);
    const a = coordinateRun({ run: interactiveRun.run });
    const b = coordinateRun({ run: scheduledRun.run });
    expect({
      use_case: b.use_case,
      version: b.use_case_version,
      scope: b.scope,
      date: b.effective_data_as_of,
      windows: b.comparison_windows_days,
    }).toEqual({
      use_case: a.use_case,
      version: a.use_case_version,
      scope: a.scope,
      date: a.effective_data_as_of,
      windows: a.comparison_windows_days,
    });
    expect(b.entrypoint).toBe('scheduled');
  });

  it('fails closed for an unregistered capability or use case', async () => {
    const repo = await setup();
    const created = await repo.createRun(TEST_USERS.owner, request, 'coordinator-rejections');
    const { run } = await repo.getRun(TEST_USERS.owner, created.org_id, created.run_id);
    expect(() => coordinateRun({ run, requested_capability: 'not_registered' as never })).toThrow(
      CoordinatorError,
    );
    expect(() =>
      coordinateRun({
        run: { ...run, request: { ...run.request, use_case: 'not_registered' as never } },
      }),
    ).toThrow('UNKNOWN_USE_CASE');
  });
});
