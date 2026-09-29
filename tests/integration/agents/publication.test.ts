import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisRequest } from '@vda/contracts';
import type { Lease, Repository } from '@vda/db';
import { SAFE_SUMMARY } from '@vda/domain';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import { executeAgentWorkflow } from '../../../src/backend/agents/analysis/workflow';
import { executeCoordinatorAndData } from '../../../src/backend/agents/analysis/stages/coordinator-data';
import {
  executeAnalystBranch,
  executeChartBranch,
  executeComparisonBranch,
} from '../../../src/backend/agents/analysis/stages/branches';
import {
  executeInsightStage,
  executeReportDraftStage,
} from '../../../src/backend/agents/analysis/stages/insight-report';
import {
  executeReportRevisionStage,
  executeReviewerStage,
} from '../../../src/backend/agents/analysis/stages/reviewer';
import { executePublicationStage } from '../../../src/backend/agents/analysis/stages/publication';
import { getAgentTargetFollowUp } from '../../../src/backend/agents/chat/operations';
import type { NarrativeProvider } from '../../../src/backend/agents/providers/narrative';
import type { ReviewerProvider } from '../../../src/backend/agents/analysis/specialists/reviewer';

const leaseMs = 240_000;
const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of resources.splice(0)) {
    await item.repo.close();
    await item.close();
  }
});
const request: AnalysisRequest = {
  org_id: TEST_ORGS.alpha,
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  question: 'Inventory',
  conversation_id: null,
};
function narrator(): NarrativeProvider {
  return {
    narrate: vi.fn(async (claims) => ({
      summary: SAFE_SUMMARY,
      claims: [...claims].reverse(),
      provider: 'gemini' as const,
    })),
  };
}
async function start(key: string) {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`, new Date(), leaseMs);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('Missing lease');
  const renew = repo.renewLease.bind(repo);
  vi.spyOn(repo, 'renewLease').mockImplementation((candidate, duration) =>
    renew(candidate, duration ?? leaseMs),
  );
  return { repo, run, lease };
}
async function draft(repo: Repository, lease: Lease) {
  const data = await executeCoordinatorAndData(repo, lease);
  await Promise.all([
    executeComparisonBranch(repo, lease, data),
    executeChartBranch(repo, lease, data),
    executeAnalystBranch(repo, lease, data),
  ]);
  await executeInsightStage(repo, lease, narrator());
  return executeReportDraftStage(repo, lease);
}
const taskStatus = (detail: Awaited<ReturnType<Repository['getRun']>>, kind: string) =>
  detail.tasks.find((task) => task.kind === kind)?.status;

describe('reviewed publication gate', () => {
  it(
    'terminalizes asynchronous publication failures before releasing the worker',
    async () => {
      const { repo, run, lease } = await start('publication-root-failure');
      const failure = Object.assign(new Error('private database details'), { code: '23514' });
      vi.spyOn(repo, 'publishReviewedDraft').mockRejectedValueOnce(failure);
      await expect(
        executeAgentWorkflow(repo, lease, { narrativeProvider: narrator() }),
      ).rejects.toBe(failure);
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({
        status: 'failed',
        error_code: 'AGENT_WORKFLOW_FAILED',
        report_artifact_id: null,
      });
      expect(detail.tasks.some((task) => ['running', 'pending'].includes(task.status))).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    leaseMs,
  );

  it(
    'publishes exactly one compatible report after an exact PASS review',
    async () => {
      const { repo, run, lease } = await start('publication-root-pass');
      const provider = narrator();
      const result = await executeAgentWorkflow(repo, lease, { narrativeProvider: provider });
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const reports = await repo.listReports(TEST_USERS.owner, run.org_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(provider.narrate).toHaveBeenCalledOnce();
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        error_code: null,
        report_artifact_id: result.report.artifact_id,
      });
      expect(detail.tasks).toHaveLength(9);
      expect(detail.tasks.every((task) => task.status === 'succeeded')).toBe(true);
      expect(reports).toHaveLength(1);
      expect(
        (await repo.getReport(TEST_USERS.owner, run.org_id, reports[0]!.report_id)).artifact,
      ).toEqual(result.report);
      expect(result.report.payload).toEqual(result.report_draft.payload.report);
      expect(result.review_result.payload).toMatchObject({
        status: 'PASS',
        draft_revision: 1,
        draft_artifact_id: result.report_draft.artifact_id,
        draft_content_hash: result.report_draft.content_hash,
      });
      expect(bundle.artifacts.filter((item) => item.kind === 'report')).toHaveLength(1);
      expect(bundle.validations.every((item) => item.valid)).toBe(true);
      const privateIds = new Set([
        result.report_draft.artifact_id,
        result.review_result.artifact_id,
      ]);
      const messages = await repo.messages(
        TEST_USERS.owner,
        run.org_id,
        run.request.conversation_id!,
      );
      expect(
        messages
          .flatMap((message) => message.parts)
          .some((part) => part.type === 'artifact_ref' && privateIds.has(part.artifact_id)),
      ).toBe(false);
      expect(
        messages
          .filter((message) => message.sender_agent)
          .map((message) => message.sender_agent)
          .sort(),
      ).toEqual([
        'analyst',
        'chart',
        'comparison',
        'coordinator',
        'data',
        'insight',
        'report',
        'reviewer',
      ]);
      const followUp = {
        org_id: run.org_id,
        conversation_id: run.request.conversation_id!,
        user_message_id: run.run_id,
        assistant_message_id: run.run_id,
        client_turn_id: run.run_id,
        user_id: TEST_USERS.owner,
        role: 'owner' as const,
        question: 'Show the analysis findings.',
        scope: run.request.scope,
        data_as_of: run.request.data_as_of,
        use_case: run.request.use_case,
        agent_target: 'analyst' as const,
        idempotency_key: 'follow-up-root',
        allowed_run_ids: [],
        allowed_conversation_run_ids: [run.run_id],
        allowed_signal_refs: [],
        allowed_scopes: [run.request.scope],
      };
      const analyst = await getAgentTargetFollowUp(repo, followUp);
      expect(analyst).toMatchObject({ kind: 'agent_target_follow_up', sender_agent: 'analyst' });
      if (analyst.kind !== 'agent_target_follow_up') throw new Error('Missing analyst follow-up');
      expect(analyst.parts).toContainEqual({
        type: 'artifact_ref',
        run_id: run.run_id,
        artifact_id: bundle.artifacts.find((item) => item.kind === 'analysis_pack')!.artifact_id,
        kind: 'analysis_pack',
      });
      const status = await getAgentTargetFollowUp(repo, {
        ...followUp,
        agent_target: 'report',
        question: 'Show the report review status.',
      });
      expect(status).toMatchObject({
        kind: 'agent_target_follow_up',
        sender_agent: 'report',
        parts: [{ type: 'run_ref', run_id: run.run_id, status: 'succeeded' }],
      });
      expect(
        await getAgentTargetFollowUp(repo, {
          ...followUp,
          user_id: TEST_USERS.viewer,
          role: 'viewer',
          agent_target: 'report',
          question: 'Show the report review status.',
        }),
      ).toEqual({
        kind: 'agent_target_unavailable',
        reason_code: 'NO_AUTHORIZED_RESULT',
      });
      await expect(executePublicationStage(repo, lease)).rejects.toThrow('LEASE_LOST');
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
    },
    leaseMs,
  );

  it(
    'publishes revision two after one bounded evidence correction',
    async () => {
      const { repo, run, lease } = await start('publication-root-revision');
      const reviewer: ReviewerProvider = {
        review: vi.fn(async (input) =>
          input.draft_revision === 1
            ? {
                code: 'REQUIRE_EVIDENCE_BOUND_WORDING' as const,
                claim_id: input.claims[0]!.claim_id,
              }
            : null,
        ),
      };
      const result = await executeAgentWorkflow(repo, lease, {
        narrativeProvider: narrator(),
        reviewerProvider: reviewer,
      });
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      const drafts = bundle.artifacts
        .filter((item) => item.kind === 'report_draft')
        .sort((a, b) => a.payload.revision - b.payload.revision);
      const reviews = bundle.artifacts
        .filter((item) => item.kind === 'review_result')
        .sort((a, b) => a.payload.draft_revision - b.payload.draft_revision);
      expect(reviewer.review).toHaveBeenCalledTimes(2);
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        report_artifact_id: result.report.artifact_id,
      });
      expect(drafts.map((item) => item.payload.revision)).toEqual([1, 2]);
      expect(reviews.map((item) => item.payload.status)).toEqual(['REVISION_REQUIRED', 'PASS']);
      expect(result.review_result.payload).toMatchObject({
        status: 'PASS',
        draft_revision: 2,
        draft_artifact_id: drafts[1]!.artifact_id,
        draft_content_hash: drafts[1]!.content_hash,
      });
      expect(result.report.input_refs).toEqual(
        [
          result.calculation.artifact_id,
          result.comparison.artifact_id,
          result.visual_evidence.artifact_id,
          result.insight.artifact_id,
          result.decision_intelligence_pack.artifact_id,
        ].sort(),
      );
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
    },
    leaseMs,
  );

  it(
    'never treats reviewer failure or a second correction as publication approval',
    async () => {
      const first = await start('publication-root-reviewer-failure');
      const unavailable: ReviewerProvider = {
        review: vi.fn(async () => {
          throw new Error('REVIEWER_PROVIDER_DOWN');
        }),
      };
      await expect(
        executeAgentWorkflow(first.repo, first.lease, {
          narrativeProvider: narrator(),
          reviewerProvider: unavailable,
        }),
      ).rejects.toThrow('REVIEWER_PROVIDER_DOWN');
      const failed = await first.repo.getRun(TEST_USERS.owner, first.run.org_id, first.run.run_id);
      expect(failed.run).toMatchObject({ status: 'failed', error_code: 'REVIEWER_PROVIDER_DOWN' });
      expect(taskStatus(failed, 'reviewer')).toBe('failed');
      expect(await first.repo.listReports(TEST_USERS.owner, first.run.org_id)).toEqual([]);

      const second = await start('publication-root-revision-limit');
      const alwaysCorrect: ReviewerProvider = {
        review: vi.fn(async (input) => ({
          code: 'REQUIRE_EVIDENCE_BOUND_WORDING' as const,
          claim_id: input.claims[0]!.claim_id,
        })),
      };
      await expect(
        executeAgentWorkflow(second.repo, second.lease, {
          narrativeProvider: narrator(),
          reviewerProvider: alwaysCorrect,
        }),
      ).rejects.toThrow('REVIEW_REVISION_LIMIT');
      const limited = await second.repo.getRun(
        TEST_USERS.owner,
        second.run.org_id,
        second.run.run_id,
      );
      const bundle = await second.repo.artifacts(
        TEST_USERS.owner,
        second.run.org_id,
        second.run.run_id,
      );
      expect(alwaysCorrect.review).toHaveBeenCalledTimes(2);
      expect(limited.run).toMatchObject({ status: 'failed', error_code: 'REVIEW_REVISION_LIMIT' });
      expect(taskStatus(limited, 'publication')).toBeUndefined();
      expect(bundle.artifacts.filter((item) => item.kind === 'report_draft')).toHaveLength(2);
      expect(bundle.artifacts.filter((item) => item.kind === 'review_result')).toHaveLength(2);
      expect(bundle.artifacts.some((item) => item.kind === 'report')).toBe(false);
      expect(await second.repo.listReports(TEST_USERS.owner, second.run.org_id)).toEqual([]);
    },
    leaseMs,
  );

  it(
    'resumes a persisted PASS review under a reclaimed lease without rerunning providers',
    async () => {
      const { repo, run, lease } = await start('publication-root-reclaimed');
      const prepared = await draft(repo, lease);
      const review = await executeReviewerStage(repo, lease);
      expect(review.review_result.payload.status).toBe('PASS');
      const replacement = await repo.claimRun(
        'publication-root-replacement',
        new Date(Date.now() + leaseMs + 1_000),
      );
      if (!replacement || replacement.run.run_id !== run.run_id)
        throw new Error('Missing replacement lease');
      const unavailableNarrator: NarrativeProvider = {
        narrate: vi.fn(async () => {
          throw new Error('NARRATIVE_MUST_NOT_RUN_ON_RECOVERY');
        }),
      };
      const unavailableReviewer: ReviewerProvider = {
        review: vi.fn(async () => {
          throw new Error('REVIEWER_MUST_NOT_RUN_ON_RECOVERY');
        }),
      };
      const result = await executeAgentWorkflow(repo, replacement, {
        narrativeProvider: unavailableNarrator,
        reviewerProvider: unavailableReviewer,
      });
      expect(unavailableNarrator.narrate).not.toHaveBeenCalled();
      expect(unavailableReviewer.review).not.toHaveBeenCalled();
      expect(result.report_draft).toEqual(prepared.report_draft);
      expect(result.review_result).toEqual(review.review_result);
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        report_artifact_id: result.report.artifact_id,
      });
      expect(
        detail.tasks.every(
          (task) =>
            task.status === 'succeeded' &&
            task.attempt === replacement.run.attempt &&
            task.error_code === null,
        ),
      ).toBe(true);
      expect(
        (await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id)).artifacts.filter(
          (item) => item.kind === 'report',
        ),
      ).toHaveLength(1);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
    },
    leaseMs,
  );

  it(
    'adopts an earlier PASS review when publication itself starts on a new owner',
    async () => {
      const { repo, run, lease } = await start('publication-root-direct-recovery');
      const prepared = await draft(repo, lease);
      const review = await executeReviewerStage(repo, lease);
      const replacement = await repo.claimRun(
        'publication-root-direct-replacement',
        new Date(Date.now() + leaseMs + 1_000),
      );
      if (!replacement || replacement.run.run_id !== run.run_id)
        throw new Error('Missing replacement lease');
      const published = await executePublicationStage(repo, replacement);
      expect(published.report_draft).toEqual(prepared.report_draft);
      expect(published.review_result).toEqual(review.review_result);
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        report_artifact_id: published.report.artifact_id,
      });
      for (const kind of ['report', 'reviewer', 'publication'])
        expect(detail.tasks.find((task) => task.kind === kind)).toMatchObject({
          status: 'succeeded',
          attempt: replacement.run.attempt,
          error_code: null,
        });
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
    },
    leaseMs,
  );

  it(
    'never publishes a PASS review after cancellation or from a stale fencing owner',
    async () => {
      const cancelled = await start('publication-root-cancelled');
      await draft(cancelled.repo, cancelled.lease);
      expect(
        (await executeReviewerStage(cancelled.repo, cancelled.lease)).review_result.payload.status,
      ).toBe('PASS');
      await cancelled.repo.cancelRun(TEST_USERS.owner, cancelled.run.org_id, cancelled.run.run_id);
      await expect(executePublicationStage(cancelled.repo, cancelled.lease)).rejects.toThrow(
        'LEASE_LOST',
      );
      expect(
        (await cancelled.repo.getRun(TEST_USERS.owner, cancelled.run.org_id, cancelled.run.run_id))
          .run,
      ).toMatchObject({ status: 'cancelled', report_artifact_id: null });
      expect(await cancelled.repo.listReports(TEST_USERS.owner, cancelled.run.org_id)).toEqual([]);

      const stale = await start('publication-root-stale');
      await draft(stale.repo, stale.lease);
      expect(
        (await executeReviewerStage(stale.repo, stale.lease)).review_result.payload.status,
      ).toBe('PASS');
      const replacement = await stale.repo.claimRun(
        'publication-root-stale-replacement',
        new Date(Date.now() + leaseMs + 1_000),
      );
      expect(replacement?.fencing_token).toBeGreaterThan(stale.lease.fencing_token);
      await expect(executePublicationStage(stale.repo, stale.lease)).rejects.toThrow('LEASE_LOST');
      expect(
        (await stale.repo.getRun(TEST_USERS.owner, stale.run.org_id, stale.run.run_id)).run,
      ).toMatchObject({ status: 'running', report_artifact_id: null });
      expect(await stale.repo.listReports(TEST_USERS.owner, stale.run.org_id)).toEqual([]);
    },
    leaseMs,
  );

  it(
    'rejects a revision-required review at the publication gate',
    async () => {
      const { repo, run, lease } = await start('publication-root-review-gate');
      const prepared = await draft(repo, lease);
      const claim = prepared.report_draft.payload.report.claims[0]!;
      expect(
        (
          await executeReviewerStage(repo, lease, {
            correction: {
              code: 'REQUIRE_EVIDENCE_BOUND_WORDING',
              claim_id: claim.claim_id,
            },
          })
        ).review_result.payload.status,
      ).toBe('REVISION_REQUIRED');
      await expect(executePublicationStage(repo, lease)).rejects.toThrow('REVIEW_PASS_REQUIRED');
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({ status: 'running', report_artifact_id: null });
      expect(taskStatus(detail, 'publication')).toBe('failed');
      expect(
        (await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id)).artifacts.some(
          (item) => item.kind === 'report',
        ),
      ).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    leaseMs,
  );

  it(
    'fails closed on replay of a persisted second review that still requires correction',
    async () => {
      const { repo, run, lease } = await start('publication-root-limit-replay');
      const first = await draft(repo, lease);
      const claim = first.report_draft.payload.report.claims[0]!;
      await executeReviewerStage(repo, lease, {
        correction: {
          code: 'REQUIRE_EVIDENCE_BOUND_WORDING',
          claim_id: claim.claim_id,
        },
      });
      const second = await executeReportRevisionStage(repo, lease);
      const secondClaim = second.report_draft.payload.report.claims[0]!;
      await executeReviewerStage(repo, lease, {
        correction: {
          code: 'REQUIRE_EVIDENCE_BOUND_WORDING',
          claim_id: secondClaim.claim_id,
        },
      });
      const unavailable: ReviewerProvider = {
        review: vi.fn(async () => {
          throw new Error('REVIEWER_MUST_NOT_RUN_ON_RECOVERY');
        }),
      };
      await expect(
        executeAgentWorkflow(repo, lease, {
          narrativeProvider: narrator(),
          reviewerProvider: unavailable,
        }),
      ).rejects.toThrow('REVIEW_REVISION_LIMIT');
      expect(unavailable.review).not.toHaveBeenCalled();
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({ status: 'failed', error_code: 'REVIEW_REVISION_LIMIT' });
      expect(taskStatus(detail, 'publication')).toBeUndefined();
      expect(bundle.artifacts.filter((item) => item.kind === 'report_draft')).toHaveLength(2);
      expect(bundle.artifacts.filter((item) => item.kind === 'review_result')).toHaveLength(2);
      expect(bundle.artifacts.some((item) => item.kind === 'report')).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    leaseMs,
  );
});
