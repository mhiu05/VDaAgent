import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactSchema, type Artifact, type ArtifactOf } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { artifactHash, SAFE_SUMMARY } from '@vda/domain';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import { executeTeamThroughReview } from '../../../src/backend/agents/analysis/team-workflow';
import {
  buildReviewResult,
  validateReviewResult,
  type ReviewerAgentInput,
} from '../../../src/backend/agents/analysis/specialists/reviewer';

const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of resources.splice(0)) {
    await item.repo.close();
    await item.close();
  }
});
const request = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
const narrativeProvider = {
  narrate: vi.fn(async (claims) => ({
    summary: SAFE_SUMMARY,
    claims: [...claims].reverse(),
    provider: 'gemini' as const,
  })),
};

async function reviewFixture(key: string, revise = false) {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`, new Date(), 240_000);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('Missing lease');
  const renew = repo.renewLease.bind(repo);
  vi.spyOn(repo, 'renewLease').mockImplementation((candidate, duration) =>
    renew(candidate, duration ?? 240_000),
  );
  const result = await executeTeamThroughReview(repo, lease, {
    narrativeProvider,
    reviewerProvider: revise
      ? {
          review: async (input) =>
            input.draft_revision === 1
              ? { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: input.claims[0]!.claim_id }
              : null,
        }
      : undefined,
  });
  const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
  const input: ReviewerAgentInput = {
    run: lease.run,
    report_draft: result.report_draft,
    artifacts: bundle.artifacts,
  };
  return { repo, result, input };
}

describe('deterministic reviewer on the current team workflow', () => {
  it('passes the exact revision-one draft and fails closed on altered or cross-tenant evidence', async () => {
    const { input } = await reviewFixture('reviewer-root-pass');
    const passed = buildReviewResult(input);
    expect(passed).toMatchObject({
      status: 'PASS',
      issues: [],
      provider: 'deterministic',
      draft_artifact_id: input.report_draft.artifact_id,
      draft_id: input.report_draft.payload.draft_id,
      draft_revision: 1,
      draft_content_hash: input.report_draft.content_hash,
      input_refs: [input.report_draft.artifact_id],
    });
    expect(() => validateReviewResult(passed, input)).not.toThrow();
    const claim = input.report_draft.payload.report.claims[0]!;
    const correction = {
      code: 'REQUIRE_EVIDENCE_BOUND_WORDING' as const,
      claim_id: claim.claim_id,
    };
    const blocked = buildReviewResult({ ...input, correction });
    expect(blocked).toMatchObject({
      status: 'REVISION_REQUIRED',
      issues: [
        expect.objectContaining({
          severity: 'blocking',
          category: 'overstatement',
          claim_id: claim.claim_id,
          evidence_refs: [
            expect.objectContaining({
              artifact_id: claim.evidence_artifact_id,
              path: claim.evidence_path,
            }),
          ],
        }),
      ],
    });
    expect(() => validateReviewResult(blocked, { ...input, correction })).not.toThrow();

    const { content_hash: _oldHash, ...body } = input.report_draft;
    const changed = {
      ...body,
      payload: {
        ...body.payload,
        report: { ...body.payload.report, title: 'Unreviewed title change' },
      },
    } as Omit<Artifact, 'content_hash'>;
    const changedDraft = ArtifactSchema.parse({
      ...changed,
      content_hash: artifactHash(changed),
    }) as ArtifactOf<'report_draft'>;
    const altered: ReviewerAgentInput = {
      ...input,
      report_draft: changedDraft,
      artifacts: input.artifacts.map((artifact) =>
        artifact.artifact_id === changedDraft.artifact_id ? changedDraft : artifact,
      ),
    };
    expect(buildReviewResult(altered)).toMatchObject({
      status: 'REVISION_REQUIRED',
      issues: [
        expect.objectContaining({
          severity: 'blocking',
          category: 'evidence',
          required_correction: expect.stringContaining('Rebuild this draft'),
        }),
      ],
    });

    const foreign = { ...input.artifacts[0], org_id: TEST_ORGS.beta } as Artifact;
    const { content_hash: _hash, ...foreignBody } = foreign;
    const foreignArtifact = ArtifactSchema.parse({
      ...foreignBody,
      content_hash: artifactHash(foreignBody as Omit<Artifact, 'content_hash'>),
    }) as Artifact;
    expect(() =>
      buildReviewResult({ ...input, artifacts: [foreignArtifact, ...input.artifacts.slice(1)] }),
    ).toThrow('REVIEWER_AGENT_INPUT_INVALID');
  }, 240_000);

  it('records an evidence-bound blocking correction and passes the linked second revision', async () => {
    const { result, input } = await reviewFixture('reviewer-root-revision', true);
    expect(result.report_draft.payload.revision).toBe(2);
    expect(result.review_result.payload.status).toBe('PASS');
    const passed = buildReviewResult(input);
    expect(passed).toMatchObject({
      status: 'PASS',
      draft_revision: 2,
      draft_artifact_id: input.report_draft.artifact_id,
    });
    expect(() => validateReviewResult(passed, input)).not.toThrow();
  }, 240_000);
});
