import { expect, it } from 'vitest';
import { executeAgentWorkflow, SAFE_SUMMARY, type NarrativeProvider } from '@vda/agents';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../helpers/postgres.js';

const deterministicProvider = (): NarrativeProvider => ({
  narrate: async (claims) => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }),
});

it('executes the production PostgreSQL repository, RLS reads, pipeline and export ledger in embedded Postgres', async () => {
  const { pg, repo, uploads } = await createTestRepository();
  try {
    const run = await repo.createRun(
      TEST_USERS.owner,
      {
        org_id: TEST_ORGS.alpha,
        scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
        data_as_of: '2026-09-19',
        question: 'PG pipeline',
        conversation_id: null,
      },
      'pg-once',
    );
    await executeAgentWorkflow(repo, (await repo.claimRun('pg-worker', new Date(), 240_000))!, {
      narrativeProvider: deterministicProvider(),
    });
    expect((await repo.getRun(TEST_USERS.viewer, TEST_ORGS.alpha, run.run_id)).run.status).toBe(
      'succeeded',
    );
    const reports = await repo.listReports(TEST_USERS.viewer, TEST_ORGS.alpha);
    expect(reports).toHaveLength(1);
    await repo.storeReportExport(
      TEST_USERS.viewer,
      TEST_ORGS.alpha,
      reports[0].report_id,
      'json',
      'testhash',
      '{}',
      'application/json',
    );
    expect((await pg.query('SELECT * FROM report_exports')).rows).toHaveLength(1);
    expect(uploads).toContainEqual(
      expect.objectContaining({ bucket: 'report-exports', contentType: 'application/json' }),
    );
    const publishedHash = (
      await repo.getReport(TEST_USERS.viewer, TEST_ORGS.alpha, reports[0].report_id)
    ).artifact.content_hash;
    // Simulate a pre-upgrade row whose workflow identity was historically absent.
    await pg.exec('ALTER TABLE runs DISABLE TRIGGER runs_guard_workflow_version');
    await pg.query("UPDATE runs SET payload=payload-'workflow_version' WHERE org_id=$1 AND id=$2", [
      TEST_ORGS.alpha,
      run.run_id,
    ]);
    await pg.exec('ALTER TABLE runs ENABLE TRIGGER runs_guard_workflow_version');
    expect(
      (await repo.getRun(TEST_USERS.viewer, TEST_ORGS.alpha, run.run_id)).run.workflow_version,
    ).toBe('legacy-v1');
    expect(
      (await repo.getReport(TEST_USERS.viewer, TEST_ORGS.alpha, reports[0].report_id)).artifact
        .content_hash,
    ).toBe(publishedHash);
    await expect(
      repo.getReport(TEST_USERS.beta, TEST_ORGS.beta, reports[0].report_id),
    ).rejects.toThrow('REPORT_NOT_FOUND');
    await expect(repo.getRun(TEST_USERS.beta, TEST_ORGS.alpha, run.run_id)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
    await pg.exec(
      `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${TEST_USERS.beta}',false);`,
    );
    expect((await pg.query('SELECT * FROM artifacts')).rows).toHaveLength(0);
    expect((await pg.query('SELECT * FROM reports')).rows).toHaveLength(0);
    await expect(pg.exec(`UPDATE runs SET org_id='${TEST_ORGS.beta}'`)).rejects.toThrow(
      'permission denied',
    );
    await pg.exec('RESET ROLE');
    await repo.createRun(
      TEST_USERS.owner,
      { ...run.request, conversation_id: null },
      'revoke-active',
    );
    const revokedLease = (await repo.claimRun('revoked-worker'))!;
    await pg.query('DELETE FROM organization_members WHERE user_id=$1', [TEST_USERS.owner]);
    await expect(repo.readSnapshots(revokedLease)).rejects.toThrow('WORKSPACE_FORBIDDEN');
    await expect(repo.addEvent(revokedLease, 'revoked')).rejects.toThrow('WORKSPACE_FORBIDDEN');
    await expect(repo.completeRun(revokedLease, reports[0].artifact_id)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
    await expect(repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
  } finally {
    await repo.close();
    await pg.close();
  }
}, 120000);
