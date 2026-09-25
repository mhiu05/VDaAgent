import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AnalysisRequest } from '@vda/contracts';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { executeAgentWorkflow } from './analysis-v1/workflow';
import { executeAgentThroughDraft } from './analysis-v1/stages/insight-report';
import { SAFE_SUMMARY } from '@vda/domain';
import { executePublicationStage } from './analysis-v1/stages/publication';
import { executeReportRevisionStage, executeReviewerStage } from './analysis-v1/stages/reviewer';
import { type NarrativeProvider } from './legacy-workflow/narrative/provider';
import {
  type ReviewerProvider,
  type ReviewerProviderInput,
} from './analysis-v1/agents/reviewer-agent';
import { getAgentTargetFollowUp } from './chat/operations';

// PGlite runs its SQL work on the test process's event loop, so timer-based
// worker heartbeats cannot run while an integration scenario is executing.
// Keep the fixture lease longer than the heaviest deterministic scenario; the
// recovery tests below still explicitly advance past this duration.
const PGLITE_LEASE_MS = 240_000;

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
      // The Insight Agent, not this provider, owns canonical claim ordering.
      claims: [...claims].reverse(),
      provider: 'gemini' as const,
    })),
  };
}

async function start(key: string) {
  const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(`${key}-worker`, new Date(), PGLITE_LEASE_MS);
  if (!lease || lease.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');
  const renewLease = repo.renewLease.bind(repo);
  vi.spyOn(repo, 'renewLease').mockImplementation((candidate, leaseMs) =>
    renewLease(candidate, leaseMs ?? PGLITE_LEASE_MS),
  );
  return { repo, run, lease };
}

function taskStatus(detail: Awaited<ReturnType<Repository['getRun']>>, kind: string) {
  return detail.tasks.find((task) => task.kind === kind)?.status;
}

describe('terminal Agent workflow publication gate', () => {
  it(
    'publishes exactly one legacy-compatible report after an exact PASS review',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-pass');
      const narrator = narrativeProvider();

      const result = await executeAgentWorkflow(repo, lease, { narrativeProvider: narrator });
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const reports = await repo.listReports(TEST_USERS.owner, run.org_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      const persisted = await repo.getReport(TEST_USERS.owner, run.org_id, reports[0]!.report_id);

      expect(narrator.narrate).toHaveBeenCalledTimes(1);
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        report_artifact_id: result.report.artifact_id,
        error_code: null,
      });
      expect(detail.tasks).toHaveLength(9);
      for (const kind of [
        'coordinator',
        'data',
        'comparison',
        'chart',
        'analyst',
        'insight',
        'report',
        'reviewer',
        'publication',
      ])
        expect(taskStatus(detail, kind)).toBe('succeeded');
      expect(reports).toHaveLength(1);
      expect(persisted.artifact).toEqual(result.report);
      expect(result.report.payload).toEqual(result.report_draft.payload.report);
      expect(result.review_result.payload).toMatchObject({
        status: 'PASS',
        draft_artifact_id: result.report_draft.artifact_id,
        draft_content_hash: result.report_draft.content_hash,
        draft_revision: 1,
      });
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'report')).toHaveLength(1);
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'report_draft')).toHaveLength(
        1,
      );
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'review_result')).toHaveLength(
        1,
      );
      expect(bundle.validations.every((validation) => validation.valid)).toBe(true);
      const messages = await repo.messages(
        TEST_USERS.owner,
        run.org_id,
        run.request.conversation_id!,
      );
      const terminalMessage = messages.find(
        (message) =>
          message.run_id === run.run_id &&
          message.role === 'assistant' &&
          message.sender_agent === null,
      );
      const privateArtifactIds = new Set([
        result.report_draft.artifact_id,
        result.review_result.artifact_id,
      ]);
      expect(
        terminalMessage?.parts
          .filter((part) => part.type === 'artifact_ref')
          .some((part) => privateArtifactIds.has(part.artifact_id)),
      ).toBe(false);
      const stageMessages = messages.filter(
        (message) => message.run_id === run.run_id && message.sender_agent,
      );
      expect(stageMessages.map((message) => message.sender_agent).sort()).toEqual([
        'analyst',
        'chart',
        'comparison',
        'coordinator',
        'data',
        'insight',
        'report',
        'reviewer',
      ]);
      expect(
        stageMessages
          .flatMap((message) => message.parts)
          .some((part) => part.type === 'artifact_ref' && privateArtifactIds.has(part.artifact_id)),
      ).toBe(false);
      expect(
        stageMessages
          .filter(
            (message) => message.sender_agent === 'report' || message.sender_agent === 'reviewer',
          )
          .every((message) => message.parts.every((part) => part.type !== 'artifact_ref')),
      ).toBe(true);
      const targetContext = {
        org_id: run.org_id,
        conversation_id: run.request.conversation_id!,
        user_message_id: run.run_id,
        assistant_message_id: run.run_id,
        client_turn_id: run.run_id,
        user_id: TEST_USERS.owner,
        role: 'owner' as const,
        question: run.request.question,
        scope: run.request.scope,
        data_as_of: run.request.data_as_of,
        use_case: run.request.use_case,
        agent_target: 'analyst' as const,
        idempotency_key: 'agent-target-analysis-pack',
        allowed_run_ids: [],
        allowed_conversation_run_ids: [run.run_id],
        allowed_signal_refs: [],
        allowed_scopes: [run.request.scope],
      };
      const analystTarget = await getAgentTargetFollowUp(repo, {
        ...targetContext,
        question: 'Show the analysis findings.',
      });
      expect(analystTarget.kind).toBe('agent_target_follow_up');
      if (analystTarget.kind !== 'agent_target_follow_up')
        throw new Error('ANALYST_TARGET_REQUIRED');
      expect(analystTarget.run.run_id).toBe(run.run_id);
      expect(analystTarget.sender_agent).toBe('analyst');
      expect(analystTarget.parts).toContainEqual({
        type: 'artifact_ref',
        run_id: run.run_id,
        artifact_id: bundle.artifacts.find((artifact) => artifact.kind === 'analysis_pack')!
          .artifact_id,
        kind: 'analysis_pack',
      });
      const reportTarget = await getAgentTargetFollowUp(repo, {
        ...targetContext,
        agent_target: 'report',
        question: 'Show the report review status.',
      });
      expect(reportTarget.kind).toBe('agent_target_follow_up');
      if (reportTarget.kind !== 'agent_target_follow_up') throw new Error('REPORT_TARGET_REQUIRED');
      expect(reportTarget.sender_agent).toBe('report');
      expect(reportTarget.parts).toEqual([
        { type: 'run_ref', run_id: run.run_id, status: 'succeeded' },
      ]);
      const viewerReportTarget = await getAgentTargetFollowUp(repo, {
        ...targetContext,
        user_id: TEST_USERS.viewer,
        role: 'viewer' as const,
        agent_target: 'report',
        question: 'Show the report review status.',
      });
      expect(viewerReportTarget).toEqual({
        kind: 'agent_target_unavailable',
        reason_code: 'NO_AUTHORIZED_RESULT',
      });

      // A terminal/stale lease cannot create a second report on a retry.
      await expect(executePublicationStage(repo, lease)).rejects.toThrow('LEASE_LOST');
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
    },
    PGLITE_LEASE_MS,
  );

  it(
    'allows one evidence-bound revision, then publishes revision two after its PASS',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-revision');
      const reviewer: ReviewerProvider = {
        review: vi.fn(async (input: ReviewerProviderInput) => {
          if (input.draft_revision !== 1) return null;
          const claim = input.claims[0];
          if (!claim) throw new Error('MISSING_TEST_CLAIM');
          return { code: 'REQUIRE_EVIDENCE_BOUND_WORDING' as const, claim_id: claim.claim_id };
        }),
      };

      const result = await executeAgentWorkflow(repo, lease, {
        narrativeProvider: narrativeProvider(),
        reviewerProvider: reviewer,
      });
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      const drafts = bundle.artifacts
        .filter((artifact) => artifact.kind === 'report_draft')
        .sort((left, right) => left.payload.revision - right.payload.revision);
      const reviews = bundle.artifacts
        .filter((artifact) => artifact.kind === 'review_result')
        .sort((left, right) => left.payload.draft_revision - right.payload.draft_revision);

      expect(reviewer.review).toHaveBeenCalledTimes(2);
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        report_artifact_id: result.report.artifact_id,
      });
      expect(taskStatus(detail, 'report')).toBe('succeeded');
      expect(taskStatus(detail, 'reviewer')).toBe('succeeded');
      expect(taskStatus(detail, 'publication')).toBe('succeeded');
      expect(drafts).toHaveLength(2);
      expect(reviews).toHaveLength(2);
      expect(drafts.map((draft) => draft.payload.revision)).toEqual([1, 2]);
      expect(reviews.map((review) => review.payload.status)).toEqual(['REVISION_REQUIRED', 'PASS']);
      expect(result.report_draft.payload.revision).toBe(2);
      expect(result.review_result.payload).toMatchObject({
        status: 'PASS',
        draft_artifact_id: drafts[1]!.artifact_id,
        draft_content_hash: drafts[1]!.content_hash,
        draft_revision: 2,
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
    PGLITE_LEASE_MS,
  );

  it(
    'never turns a reviewer provider failure into PASS or a published report',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-reviewer-failure');
      const failingReviewer: ReviewerProvider = {
        review: vi.fn(async () => {
          throw new Error('REVIEWER_PROVIDER_DOWN');
        }),
      };

      await expect(
        executeAgentWorkflow(repo, lease, {
          narrativeProvider: narrativeProvider(),
          reviewerProvider: failingReviewer,
        }),
      ).rejects.toThrow('REVIEWER_PROVIDER_DOWN');

      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(failingReviewer.review).toHaveBeenCalledTimes(1);
      expect(detail.run).toMatchObject({ status: 'failed', error_code: 'REVIEWER_PROVIDER_DOWN' });
      expect(taskStatus(detail, 'reviewer')).toBe('failed');
      expect(bundle.artifacts.some((artifact) => artifact.kind === 'review_result')).toBe(false);
      expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    PGLITE_LEASE_MS,
  );

  it(
    'stops terminal publication after the second required revision',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-revision-limit');
      const alwaysCorrectingReviewer: ReviewerProvider = {
        review: vi.fn(async (input: ReviewerProviderInput) => {
          const claim = input.claims[0];
          if (!claim) throw new Error('MISSING_TEST_CLAIM');
          return { code: 'REQUIRE_EVIDENCE_BOUND_WORDING' as const, claim_id: claim.claim_id };
        }),
      };

      await expect(
        executeAgentWorkflow(repo, lease, {
          narrativeProvider: narrativeProvider(),
          reviewerProvider: alwaysCorrectingReviewer,
        }),
      ).rejects.toThrow('REVIEW_REVISION_LIMIT');

      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(alwaysCorrectingReviewer.review).toHaveBeenCalledTimes(2);
      expect(detail.run).toMatchObject({ status: 'failed', error_code: 'REVIEW_REVISION_LIMIT' });
      expect(taskStatus(detail, 'reviewer')).toBe('failed');
      expect(taskStatus(detail, 'publication')).toBeUndefined();
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'report_draft')).toHaveLength(
        2,
      );
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'review_result')).toHaveLength(
        2,
      );
      expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    PGLITE_LEASE_MS,
  );

  it(
    'fails closed on retry when persisted revision two still requires revision',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-revision-limit-recovery');
      const firstDraft = await executeAgentThroughDraft(repo, lease, narrativeProvider());
      const firstClaim = firstDraft.report_draft.payload.report.claims[0];
      if (!firstClaim) throw new Error('MISSING_TEST_CLAIM');
      await executeReviewerStage(repo, lease, {
        correction: { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: firstClaim.claim_id },
      });
      const secondDraft = await executeReportRevisionStage(repo, lease);
      const secondClaim = secondDraft.report_draft.payload.report.claims[0];
      if (!secondClaim) throw new Error('MISSING_TEST_CLAIM');
      await executeReviewerStage(repo, lease, {
        correction: { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: secondClaim.claim_id },
      });
      const unavailableReviewer: ReviewerProvider = {
        review: vi.fn(async () => {
          throw new Error('REVIEWER_MUST_NOT_RUN_ON_RECOVERY');
        }),
      };

      await expect(
        executeAgentWorkflow(repo, lease, {
          narrativeProvider: narrativeProvider(),
          reviewerProvider: unavailableReviewer,
        }),
      ).rejects.toThrow('REVIEW_REVISION_LIMIT');

      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(unavailableReviewer.review).not.toHaveBeenCalled();
      expect(detail.run).toMatchObject({ status: 'failed', error_code: 'REVIEW_REVISION_LIMIT' });
      expect(taskStatus(detail, 'reviewer')).toBe('failed');
      expect(taskStatus(detail, 'publication')).toBeUndefined();
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'report_draft')).toHaveLength(
        2,
      );
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'review_result')).toHaveLength(
        2,
      );
      expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    PGLITE_LEASE_MS,
  );

  it(
    'publishes exactly once when a reclaimed lease resumes from a persisted PASS review',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-publication-recovery');
      const draft = await executeAgentThroughDraft(repo, lease, narrativeProvider());
      const review = await executeReviewerStage(repo, lease);
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

      expect(review.review_result.payload.status).toBe('PASS');
      const replacement = await repo.claimRun(
        'agent-workflow-recovery-replacement',
        new Date(Date.now() + PGLITE_LEASE_MS + 1_000),
      );
      if (!replacement || replacement.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');
      const result = await executeAgentWorkflow(repo, replacement, {
        narrativeProvider: unavailableNarrator,
        reviewerProvider: unavailableReviewer,
      });

      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(unavailableNarrator.narrate).not.toHaveBeenCalled();
      expect(unavailableReviewer.review).not.toHaveBeenCalled();
      expect(result.report_draft).toEqual(draft.report_draft);
      expect(result.review_result).toEqual(review.review_result);
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        report_artifact_id: result.report.artifact_id,
      });
      for (const task of detail.tasks)
        expect(task).toMatchObject({
          status: 'succeeded',
          attempt: replacement.run.attempt,
          error_code: null,
        });
      expect(bundle.artifacts.filter((artifact) => artifact.kind === 'report')).toHaveLength(1);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
    },
    PGLITE_LEASE_MS,
  );

  it(
    're-adopts a persisted PASS review when publication starts on a reclaimed lease',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-direct-publication-recovery');
      const draft = await executeAgentThroughDraft(repo, lease, narrativeProvider());
      const review = await executeReviewerStage(repo, lease);
      expect(review.review_result.payload.status).toBe('PASS');

      const replacement = await repo.claimRun(
        'agent-workflow-direct-publication-replacement',
        new Date(Date.now() + PGLITE_LEASE_MS + 1_000),
      );
      if (!replacement || replacement.run.run_id !== run.run_id) throw new Error('LEASE_REQUIRED');
      const result = await executePublicationStage(repo, replacement);
      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);

      expect(result.report_draft).toEqual(draft.report_draft);
      expect(result.review_result).toEqual(review.review_result);
      expect(detail.run).toMatchObject({
        status: 'succeeded',
        report_artifact_id: result.report.artifact_id,
      });
      for (const kind of ['report', 'reviewer', 'publication'])
        expect(detail.tasks.find((task) => task.kind === kind)).toMatchObject({
          status: 'succeeded',
          attempt: replacement.run.attempt,
          error_code: null,
        });
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toHaveLength(1);
    },
    PGLITE_LEASE_MS,
  );

  it(
    'cannot publish a persisted PASS review after cancellation',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-publication-cancelled');
      await executeAgentThroughDraft(repo, lease, narrativeProvider());
      const review = await executeReviewerStage(repo, lease);
      expect(review.review_result.payload.status).toBe('PASS');

      await repo.cancelRun(TEST_USERS.owner, run.org_id, run.run_id);
      await expect(executePublicationStage(repo, lease)).rejects.toThrow('LEASE_LOST');

      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({ status: 'cancelled', report_artifact_id: null });
      expect(taskStatus(detail, 'publication')).toBeUndefined();
      expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    PGLITE_LEASE_MS,
  );

  it(
    'cannot publish a persisted PASS review from a stale fencing owner',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-publication-stale-owner');
      await executeAgentThroughDraft(repo, lease, narrativeProvider());
      const review = await executeReviewerStage(repo, lease);
      expect(review.review_result.payload.status).toBe('PASS');

      const replacement = await repo.claimRun(
        'agent-workflow-replacement',
        new Date(Date.now() + PGLITE_LEASE_MS + 1_000),
      );
      expect(replacement?.run.run_id).toBe(run.run_id);
      expect(replacement?.fencing_token).toBeGreaterThan(lease.fencing_token);
      await expect(executePublicationStage(repo, lease)).rejects.toThrow('LEASE_LOST');

      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({ status: 'running', report_artifact_id: null });
      expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    PGLITE_LEASE_MS,
  );

  it(
    'rejects a revision-required review at the publication gate without writing a report',
    async () => {
      const { repo, run, lease } = await start('agent-workflow-gate-reject');
      const draft = await executeAgentThroughDraft(repo, lease, narrativeProvider());
      const claim = draft.report_draft.payload.report.claims[0];
      if (!claim) throw new Error('MISSING_TEST_CLAIM');
      const review = await executeReviewerStage(repo, lease, {
        correction: { code: 'REQUIRE_EVIDENCE_BOUND_WORDING', claim_id: claim.claim_id },
      });

      expect(review.review_result.payload.status).toBe('REVISION_REQUIRED');
      await expect(executePublicationStage(repo, lease)).rejects.toThrow('REVIEW_PASS_REQUIRED');

      const detail = await repo.getRun(TEST_USERS.owner, run.org_id, run.run_id);
      const bundle = await repo.artifacts(TEST_USERS.owner, run.org_id, run.run_id);
      expect(detail.run).toMatchObject({ status: 'running', report_artifact_id: null });
      expect(taskStatus(detail, 'publication')).toBe('failed');
      expect(bundle.artifacts.some((artifact) => artifact.kind === 'report')).toBe(false);
      expect(await repo.listReports(TEST_USERS.owner, run.org_id)).toEqual([]);
    },
    PGLITE_LEASE_MS,
  );
});
