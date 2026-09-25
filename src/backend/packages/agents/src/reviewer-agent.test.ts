import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactSchema, type Artifact, type ArtifactOf } from '@vda/contracts';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { executeAgentThroughDraft } from './analysis-v1/stages/insight-report';
import { artifactHash, SAFE_SUMMARY } from '@vda/domain';
import { executeReportRevisionStage, executeReviewerStage } from './analysis-v1/stages/reviewer';
import {
  buildReviewResult,
  validateReviewResult,
  type ReviewerAgentInput,
} from './analysis-v1/agents/reviewer-agent';

// PGlite executes SQL on the test process's event loop, so the production
// worker heartbeat cannot advance during a heavy draft/revision fixture.
const PGLITE_LEASE_MS = 240_000;

const resources: { repo: Repository; close: () => Promise<void> }[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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

const provider = {
  narrate: vi.fn(async (claims) => ({
    summary: SAFE_SUMMARY,
    claims: [...claims].reverse(),
    provider: 'gemini' as const,
  })),
};

async function draftInput(key: string): Promise<ReviewerAgentInput> {
  const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`, new Date(), PGLITE_LEASE_MS);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');
  const renewLease = repo.renewLease.bind(repo);
  vi.spyOn(repo, 'renewLease').mockImplementation((candidate, leaseMs) =>
    renewLease(candidate, leaseMs ?? PGLITE_LEASE_MS),
  );
  const result = await executeAgentThroughDraft(repo, lease, provider);
  const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
  return { run: lease.run, report_draft: result.report_draft, artifacts: bundle.artifacts };
}

function withChangedTitle(draft: ArtifactOf<'report_draft'>): ArtifactOf<'report_draft'> {
  const { content_hash: _hash, ...body } = draft;
  const changed = {
    ...body,
    payload: {
      ...draft.payload,
      report: { ...draft.payload.report, title: 'Unreviewed title change' },
    },
  } as Omit<Artifact, 'content_hash'>;
  return ArtifactSchema.parse({
    ...changed,
    content_hash: artifactHash(changed),
  }) as ArtifactOf<'report_draft'>;
}

async function persistedRevisionTwoInput(key: string): Promise<ReviewerAgentInput> {
  const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`, new Date(), PGLITE_LEASE_MS);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');
  const renewLease = repo.renewLease.bind(repo);
  vi.spyOn(repo, 'renewLease').mockImplementation((candidate, leaseMs) =>
    renewLease(candidate, leaseMs ?? PGLITE_LEASE_MS),
  );
  const first = await executeAgentThroughDraft(repo, lease, provider);
  const claim = first.report_draft.payload.report.claims[0];
  if (!claim) throw new Error('MISSING_TEST_CLAIM');
  await executeReviewerStage(repo, lease, {
    correction: { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: claim.claim_id },
  });
  const second = await executeReportRevisionStage(repo, lease);
  const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
  return { run: lease.run, report_draft: second.report_draft, artifacts: bundle.artifacts };
}

describe('Reviewer Agent', () => {
  it(
    'returns a deterministic PASS only for the exact validated revision-one draft',
    async () => {
      const input = await draftInput('reviewer-pass');
      const result = buildReviewResult(input);

      expect(result).toMatchObject({
        status: 'PASS',
        issues: [],
        draft_artifact_id: input.report_draft.artifact_id,
        draft_id: input.report_draft.payload.draft_id,
        draft_revision: 1,
        draft_content_hash: input.report_draft.content_hash,
        provider: 'deterministic',
        input_refs: [input.report_draft.artifact_id],
      });
      expect(() => validateReviewResult(result, input)).not.toThrow();
    },
    PGLITE_LEASE_MS,
  );

  it(
    'returns a structured blocking correction only for a known evidence-bound claim',
    async () => {
      const input = await draftInput('reviewer-correction');
      const claim = input.report_draft.payload.report.claims[0];
      const result = buildReviewResult({
        ...input,
        correction: { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: claim.claim_id },
      });

      expect(result).toMatchObject({
        status: 'REVISION_REQUIRED',
        provider: 'deterministic',
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
      expect(() =>
        validateReviewResult(result, {
          ...input,
          correction: { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: claim.claim_id },
        }),
      ).not.toThrow();
    },
    PGLITE_LEASE_MS,
  );

  it(
    'accepts a bounded revision-two draft only when it names the prior blocking review',
    async () => {
      const revisionTwo = await persistedRevisionTwoInput('reviewer-revision-two');
      const result = buildReviewResult(revisionTwo);

      expect(result).toMatchObject({
        status: 'PASS',
        draft_revision: 2,
        draft_artifact_id: revisionTwo.report_draft.artifact_id,
      });
      expect(() => validateReviewResult(result, revisionTwo)).not.toThrow();
    },
    PGLITE_LEASE_MS,
  );

  it(
    'fails closed on a cross-tenant graph and requires revision for a hash-valid altered draft',
    async () => {
      const input = await draftInput('reviewer-invalid-draft');
      const changedDraft = withChangedTitle(input.report_draft);
      const alteredInput = {
        ...input,
        report_draft: changedDraft,
        artifacts: input.artifacts.map((artifact) =>
          artifact.artifact_id === changedDraft.artifact_id ? changedDraft : artifact,
        ),
      };
      const result = buildReviewResult(alteredInput);

      expect(result).toMatchObject({
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
        buildReviewResult({
          ...input,
          artifacts: [foreignArtifact, ...input.artifacts.slice(1)],
        }),
      ).toThrow('REVIEWER_AGENT_INPUT_INVALID');
    },
    PGLITE_LEASE_MS,
  );
});
