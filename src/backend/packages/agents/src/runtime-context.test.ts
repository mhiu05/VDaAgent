import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTurnRequest, AnalysisRequest } from '@vda/contracts';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { executeLease, SAFE_SUMMARY } from './index';
import { executeAgentWorkflow } from './analysis-v1/workflow';
import { type NarrativeProvider } from './legacy-workflow/narrative/provider';
import {
  assertWorkspaceConversationCoherence,
  RuntimeContextBuilder,
} from './runtime/context/builder';

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

function narrator(): NarrativeProvider {
  return {
    narrate: vi.fn(async (claims) => ({
      summary: SAFE_SUMMARY,
      claims,
      provider: 'gemini' as const,
    })),
  };
}

function turn(overrides: Record<string, unknown> = {}) {
  return {
    org_id: TEST_ORGS.alpha,
    client_turn_id: '70000000-0000-4000-8000-000000000101',
    text: 'Explain the active result.',
    scope: request.scope,
    data_as_of: request.data_as_of,
    ...overrides,
  };
}

function workspace(
  conversationId: string,
  overrides: Partial<NonNullable<AgentTurnRequest['workspace_context']>> = {},
): NonNullable<AgentTurnRequest['workspace_context']> {
  return {
    version: 1,
    mode: 'report_dashboard',
    org_id: TEST_ORGS.alpha,
    conversation_id: conversationId,
    scope: request.scope,
    data_as_of: request.data_as_of,
    active_run_ref: null,
    active_report_ref: null,
    active_artifact_ref: null,
    dashboard_selection: null,
    drilldown: null,
    evidence_ref: null,
    ...overrides,
  };
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...objectKeys(child),
  ]);
}

async function completedAgentRun(key: string) {
  const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, key);
  const lease = await repo.claimRun(key + '-worker');
  if (!lease) throw new Error('LEASE_REQUIRED');
  const result = await executeAgentWorkflow(repo, lease, { narrativeProvider: narrator() });
  const reports = await repo.listReports(TEST_USERS.owner, run.org_id);
  const report = reports.find((item) => item.run_id === run.run_id);
  const decision = await repo.decisionIntelligence(TEST_USERS.owner, run.org_id, run.run_id);
  if (!report || decision.status !== 'available') throw new Error('DECISION_REQUIRED');
  return { repo, run, result, report, pack: decision.decision_intelligence };
}

describe('RuntimeContextBuilder', () => {
  it('rejects a conflicting workspace conversation before context resolution', () => {
    const routeConversation = '70000000-0000-4000-8000-000000000111';
    const conflictingSnapshot = workspace('70000000-0000-4000-8000-000000000112');

    expect(() =>
      assertWorkspaceConversationCoherence(
        turn({ workspace_context: conflictingSnapshot }),
        routeConversation,
      ),
    ).toThrow('NO_AUTHORIZED_RESULT');
    expect(() =>
      assertWorkspaceConversationCoherence(
        turn({ workspace_context: workspace(routeConversation) }),
        routeConversation,
      ),
    ).not.toThrow();
  });

  it('rehydrates an authorized report, chart, priority, drilldown, and exact evidence path without provider payloads', async () => {
    const { repo, run, result, report, pack } = await completedAgentRun('runtime-context-active');
    const visual = pack.visual_story.ordered_visuals[0];
    const priority = pack.priority_entities[0];
    const drilldown = pack.drilldowns[0];
    const evidence = pack.evidence_refs[0];
    if (!visual || !priority || !drilldown || !evidence) throw new Error('ACTIVE_CONTEXT_REQUIRED');

    const context = await new RuntimeContextBuilder(repo).build(
      TEST_USERS.owner,
      turn({
        workspace_context: workspace(run.request.conversation_id!, {
          active_run_ref: { run_id: run.run_id },
          active_report_ref: { run_id: run.run_id, report_id: report.report_id },
          active_artifact_ref: { run_id: run.run_id, artifact_id: evidence.artifact_id },
          dashboard_selection: {
            chart_ref: { run_id: run.run_id, chart_id: visual.chart_id },
            priority_entity_ref: {
              run_id: run.run_id,
              priority_entity_id: priority.priority_entity_id,
            },
          },
          drilldown: { run_id: run.run_id, drilldown_id: drilldown.drilldown_id },
          evidence_ref: {
            run_id: run.run_id,
            artifact_id: evidence.artifact_id,
            evidence_path: evidence.path,
          },
        }),
      }),
      run.request.conversation_id!,
    );

    expect(context).toMatchObject({
      mode: 'report_dashboard',
      active_run: { run_id: run.run_id, status: 'succeeded' },
      active_report: { run_id: run.run_id, report_id: report.report_id },
      active_chart: { run_id: run.run_id, chart_id: visual.chart_id },
      active_priority_entity: {
        run_id: run.run_id,
        priority_entity_id: priority.priority_entity_id,
      },
      drilldown: { run_id: run.run_id, drilldown_id: drilldown.drilldown_id },
      evidence: {
        run_id: run.run_id,
        artifact_id: evidence.artifact_id,
        evidence_path: evidence.path,
      },
    });
    expect(context.active_decision?.priorities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority_entity_id: priority.priority_entity_id }),
      ]),
    );
    expect(context.allowed_evidence_refs).toContainEqual({
      run_id: run.run_id,
      artifact_id: evidence.artifact_id,
      evidence_path: evidence.path,
    });
    const providerText = JSON.stringify(context.provider_context);
    expect(providerText).not.toContain(result.report_draft.artifact_id);
    expect(providerText).not.toContain(result.review_result.artifact_id);
    expect(objectKeys(context.provider_context)).not.toEqual(
      expect.arrayContaining(['content_hash', 'payload', 'data', 'rows', 'value']),
    );
  }, 60_000);

  it('marks a valid but out-of-scope active run stale and excludes its facts', async () => {
    const { repo, run, report } = await completedAgentRun('runtime-context-stale');
    const context = await new RuntimeContextBuilder(repo).build(
      TEST_USERS.owner,
      turn({
        data_as_of: '2026-09-18',
        workspace_context: workspace(run.request.conversation_id!, {
          data_as_of: '2026-09-18',
          active_run_ref: { run_id: run.run_id },
          active_report_ref: { run_id: run.run_id, report_id: report.report_id },
        }),
      }),
      run.request.conversation_id!,
    );

    expect(context).toMatchObject({
      active_run: null,
      active_report: null,
      active_decision: null,
      active_chart: null,
      policy: { requires_fresh_analysis: true },
    });
    expect((context.provider_context.active as { run: unknown }).run).toBeNull();
    expect(context.resolution_issues).toContainEqual({
      ref_kind: 'run',
      code: 'STALE_CONTEXT',
      disposition: 'drop',
    });
  }, 60_000);

  it('accepts only exact canonical evidence paths and makes a top-level drilldown reference operational', async () => {
    const { repo, run, pack } = await completedAgentRun('runtime-context-evidence');
    const drilldown = pack.drilldowns[0];
    const evidence = pack.evidence_refs[0];
    if (!drilldown || !evidence) throw new Error('DECISION_CONTEXT_REQUIRED');
    const builder = new RuntimeContextBuilder(repo);
    const drilldownContext = await builder.build(
      TEST_USERS.owner,
      turn({ drilldown_ref: { run_id: run.run_id, drilldown_id: drilldown.drilldown_id } }),
      run.request.conversation_id!,
    );
    expect(drilldownContext).toMatchObject({
      drilldown: { run_id: run.run_id, drilldown_id: drilldown.drilldown_id },
    });

    const staleEvidence = await builder.build(
      TEST_USERS.owner,
      turn({
        workspace_context: workspace(run.request.conversation_id!, {
          active_run_ref: { run_id: run.run_id },
          active_artifact_ref: { run_id: run.run_id, artifact_id: evidence.artifact_id },
          evidence_ref: {
            run_id: run.run_id,
            artifact_id: evidence.artifact_id,
            evidence_path: 'payload.not_an_allowlisted_path',
          },
        }),
      }),
      run.request.conversation_id!,
    );
    expect(staleEvidence).toMatchObject({
      active_run: { run_id: run.run_id },
      evidence: null,
    });
    expect(staleEvidence.active_decision).not.toBeNull();
    expect(staleEvidence.resolution_issues).toContainEqual({
      ref_kind: 'evidence',
      code: 'NO_AUTHORIZED_RESULT',
      disposition: 'drop',
    });
  }, 60_000);

  it('drops a private workspace artifact while preserving an authorized run', async () => {
    const { repo, run, result } = await completedAgentRun('runtime-context-private');
    const context = await new RuntimeContextBuilder(repo).build(
      TEST_USERS.owner,
      turn({
        workspace_context: workspace(run.request.conversation_id!, {
          active_run_ref: { run_id: run.run_id },
          active_artifact_ref: { run_id: run.run_id, artifact_id: result.report_draft.artifact_id },
        }),
      }),
      run.request.conversation_id!,
    );
    expect(context).toMatchObject({
      active_run: { run_id: run.run_id },
      active_artifact: null,
    });
    expect(context.resolution_issues).toContainEqual({
      ref_kind: 'artifact',
      code: 'NO_AUTHORIZED_RESULT',
      disposition: 'drop',
    });
  }, 60_000);

  it('keeps a legacy report context reduced when no decision-intelligence pack exists', async () => {
    const { pg, repo } = await createTestRepository();
    resources.push({ repo, close: () => pg.close() });
    const run = await repo.createRun(TEST_USERS.owner, request, 'runtime-context-legacy');
    const lease = await repo.claimRun('runtime-context-legacy-worker');
    if (!lease) throw new Error('LEASE_REQUIRED');
    await executeLease(repo, lease, narrator());
    const report = (await repo.listReports(TEST_USERS.owner, run.org_id)).find(
      (item) => item.run_id === run.run_id,
    );
    if (!report) throw new Error('LEGACY_REPORT_REQUIRED');
    const context = await new RuntimeContextBuilder(repo).build(
      TEST_USERS.owner,
      turn({
        workspace_context: workspace(run.request.conversation_id!, {
          active_report_ref: { run_id: run.run_id, report_id: report.report_id },
        }),
      }),
      run.request.conversation_id!,
    );
    expect(context).toMatchObject({
      active_report: { run_id: run.run_id, report_id: report.report_id },
      active_decision: null,
    });
    expect(context.allowed_dashboard.chart_ids).toEqual([]);
  }, 60_000);
});
