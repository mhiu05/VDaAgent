import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AnalysisRequest } from '@vda/contracts';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { executeAgentWorkflow } from './agent-workflow';
import { SAFE_SUMMARY } from './integrity';
import { type NarrativeProvider } from './provider';

const resources: { repo: Repository; close: () => Promise<void> }[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { repo, close } of resources.splice(0)) {
    await repo.close();
    await close();
  }
});

const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};

function narrativeProvider(): NarrativeProvider {
  return {
    narrate: vi.fn(async (claims) => ({
      summary: SAFE_SUMMARY,
      claims,
      provider: 'gemini' as const,
    })),
  };
}

describe('agent workflow artifact visibility', () => {
  it('keeps workflow-private artifacts out of public, validated artifact reads', async () => {
    const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
    resources.push({ repo, close: () => pg.close() });
    const run = await repo.createRun(TEST_USERS.owner, request, 'agent-artifact-visibility');
    const lease = await repo.claimRun('agent-artifact-visibility-worker');
    if (!lease || lease.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');

    const result = await executeAgentWorkflow(repo, lease, {
      narrativeProvider: narrativeProvider(),
    });

    for (const user of [TEST_USERS.owner, TEST_USERS.analyst]) {
      const bundle = await repo.artifacts(user, run.org_id, run.run_id);
      expect(bundle.artifacts).toEqual(
        expect.arrayContaining([result.report_draft, result.review_result]),
      );
      await expect(
        repo.artifactByKey(user, run.org_id, run.run_id, 'report_draft:1'),
      ).resolves.toEqual(result.report_draft);
      await expect(
        repo.artifactByKey(user, run.org_id, run.run_id, 'review_result:1'),
      ).resolves.toEqual(result.review_result);
    }

    const viewerBundle = await repo.artifacts(TEST_USERS.viewer, run.org_id, run.run_id);
    const hiddenIds = new Set([result.report_draft.artifact_id, result.review_result.artifact_id]);
    expect(viewerBundle.artifacts.some((artifact) => hiddenIds.has(artifact.artifact_id))).toBe(
      false,
    );
    expect(
      viewerBundle.validations.some((validation) => hiddenIds.has(validation.artifact_id)),
    ).toBe(false);
    expect(viewerBundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(true);
    await expect(
      repo.artifactByKey(TEST_USERS.viewer, run.org_id, run.run_id, 'report_draft:1'),
    ).rejects.toThrow('ARTIFACT_NOT_FOUND');
    await expect(
      repo.artifactByKey(TEST_USERS.viewer, run.org_id, run.run_id, 'review_result:1'),
    ).rejects.toThrow('ARTIFACT_NOT_FOUND');

    for (const user of [TEST_USERS.owner, TEST_USERS.viewer]) {
      await expect(
        repo.publicArtifactById(user, run.org_id, run.run_id, result.report.artifact_id),
      ).resolves.toEqual(result.report);
      await expect(
        repo.publicArtifactsByIds(user, run.org_id, run.run_id, [
          result.report.artifact_id,
          result.report_draft.artifact_id,
          result.review_result.artifact_id,
        ]),
      ).resolves.toEqual([result.report]);
      await expect(
        repo.publicArtifactById(user, run.org_id, run.run_id, result.report_draft.artifact_id),
      ).rejects.toThrow('ARTIFACT_NOT_FOUND');
      await expect(
        repo.publicArtifactById(user, run.org_id, run.run_id, result.review_result.artifact_id),
      ).rejects.toThrow('ARTIFACT_NOT_FOUND');
    }
  }, 120_000);
});
