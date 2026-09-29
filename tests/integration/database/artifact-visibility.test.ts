import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisRequest } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { SAFE_SUMMARY } from '@vda/domain';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import { executeAgentWorkflow } from '../../../src/backend/agents/analysis/workflow';
import type { NarrativeProvider } from '../../../src/backend/agents/providers/narrative';

const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const resource of resources.splice(0)) {
    await resource.repo.close();
    await resource.close();
  }
});
const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
const provider: NarrativeProvider = {
  narrate: async (claims) => ({
    summary: SAFE_SUMMARY,
    claims,
    provider: 'gemini',
  }),
};

describe('published artifact visibility', () => {
  it('permits the reviewed report but hides draft and review artifacts from public readers', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push({ repo, close: () => pg.close() });
    const run = await repo.createRun(TEST_USERS.owner, request, 'visibility-root');
    const lease = await repo.claimRun('visibility-root-worker');
    if (!lease || lease.run.run_id !== run.run_id) throw new Error('Missing run lease');
    const completed = await executeAgentWorkflow(repo, lease, { narrativeProvider: provider });
    const hidden = new Set([
      completed.report_draft.artifact_id,
      completed.review_result.artifact_id,
    ]);

    for (const user of [TEST_USERS.owner, TEST_USERS.analyst]) {
      const privateBundle = await repo.artifacts(user, run.org_id, run.run_id);
      expect(privateBundle.artifacts).toEqual(
        expect.arrayContaining([completed.report_draft, completed.review_result]),
      );
      await expect(
        repo.artifactByKey(user, run.org_id, run.run_id, 'report_draft:1'),
      ).resolves.toEqual(completed.report_draft);
      await expect(
        repo.artifactByKey(user, run.org_id, run.run_id, 'review_result:1'),
      ).resolves.toEqual(completed.review_result);
    }

    const viewer = await repo.artifacts(TEST_USERS.viewer, run.org_id, run.run_id);
    expect(viewer.artifacts.some((item) => hidden.has(item.artifact_id))).toBe(false);
    expect(viewer.validations.some((item) => hidden.has(item.artifact_id))).toBe(false);
    expect(viewer.artifacts.some((item) => item.kind === 'report')).toBe(true);
    for (const key of ['report_draft:1', 'review_result:1']) {
      await expect(
        repo.artifactByKey(TEST_USERS.viewer, run.org_id, run.run_id, key),
      ).rejects.toThrow('ARTIFACT_NOT_FOUND');
    }
    for (const user of [TEST_USERS.owner, TEST_USERS.viewer]) {
      await expect(
        repo.publicArtifactById(user, run.org_id, run.run_id, completed.report.artifact_id),
      ).resolves.toEqual(completed.report);
      await expect(
        repo.publicArtifactsByIds(user, run.org_id, run.run_id, [
          completed.report.artifact_id,
          ...hidden,
        ]),
      ).resolves.toEqual([completed.report]);
      for (const artifactId of hidden) {
        await expect(
          repo.publicArtifactById(user, run.org_id, run.run_id, artifactId),
        ).rejects.toThrow('ARTIFACT_NOT_FOUND');
      }
    }
  }, 120_000);
});
