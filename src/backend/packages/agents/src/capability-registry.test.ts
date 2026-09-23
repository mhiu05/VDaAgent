import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTurnRequest, AnalysisRequest } from '@vda/contracts';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
import { executeAgentWorkflow } from './agent-workflow';
import { CapabilityRegistry, createCapabilityExecutionBudget } from './capability-registry';
import { deterministicGroundedAnswer } from './answer-composer';
import { SAFE_SUMMARY } from './integrity';
import { type NarrativeProvider } from './provider';
import { RuntimeContextBuilder } from './runtime-context';

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

function turn(workspaceContext: NonNullable<AgentTurnRequest['workspace_context']>) {
  return {
    org_id: TEST_ORGS.alpha,
    client_turn_id: '70000000-0000-4000-8000-000000000121',
    text: 'Inspect the selected result.',
    scope: request.scope,
    data_as_of: request.data_as_of,
    workspace_context: workspaceContext,
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

async function setup() {
  const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
  resources.push({ repo, close: () => pg.close() });
  const run = await repo.createRun(TEST_USERS.owner, request, 'capability-registry');
  const lease = await repo.claimRun('capability-registry-worker');
  if (!lease) throw new Error('LEASE_REQUIRED');
  await executeAgentWorkflow(repo, lease, { narrativeProvider: narrator() });
  const report = (await repo.listReports(TEST_USERS.owner, run.org_id)).find(
    (item) => item.run_id === run.run_id,
  );
  const decision = await repo.decisionIntelligence(TEST_USERS.owner, run.org_id, run.run_id);
  if (!report || decision.status !== 'available') throw new Error('DECISION_REQUIRED');
  const visual = decision.decision_intelligence.visual_story.ordered_visuals[0];
  const priority = decision.decision_intelligence.priority_entities[0];
  const evidence = decision.decision_intelligence.evidence_refs[0];
  if (!visual || !priority || !evidence) throw new Error('DECISION_COMPONENT_REQUIRED');
  const workspace: NonNullable<AgentTurnRequest['workspace_context']> = {
    version: 1,
    mode: 'report_dashboard',
    org_id: run.org_id,
    conversation_id: run.request.conversation_id,
    scope: run.request.scope,
    data_as_of: run.request.data_as_of,
    active_run_ref: { run_id: run.run_id },
    active_report_ref: { run_id: run.run_id, report_id: report.report_id },
    active_artifact_ref: { run_id: run.run_id, artifact_id: evidence.artifact_id },
    dashboard_selection: {
      chart_ref: { run_id: run.run_id, chart_id: visual.chart_id },
      priority_entity_ref: { run_id: run.run_id, priority_entity_id: priority.priority_entity_id },
    },
    drilldown: null,
    evidence_ref: {
      run_id: run.run_id,
      artifact_id: evidence.artifact_id,
      evidence_path: evidence.path,
    },
  };
  const context = await new RuntimeContextBuilder(repo).build(
    TEST_USERS.owner,
    turn(workspace),
    run.request.conversation_id!,
  );
  return {
    repo,
    run,
    report,
    decision: decision.decision_intelligence,
    visual,
    priority,
    evidence,
    context,
  };
}

describe('CapabilityRegistry', () => {
  it('dispatches only declared, server-authorized reads and projects canonical references', async () => {
    const { repo, run, report, visual, priority, evidence, context } = await setup();
    const registry = new CapabilityRegistry(repo);
    const execution = {
      authorized_context: context,
      turn_context: {
        org_id: run.org_id,
        conversation_id: run.request.conversation_id!,
        user_message_id: '70000000-0000-4000-8000-000000000122',
        assistant_message_id: '70000000-0000-4000-8000-000000000123',
        client_turn_id: '70000000-0000-4000-8000-000000000121',
      },
      idempotency_key: 'capability-registry-read',
    };

    // The registry is deliberately closed: planning cannot discover a hidden
    // tenth capability or lose explicit-agent parity through an accidental
    // registration omission.
    expect(registry.available(context)).toEqual([
      'create_analysis',
      'get_analysis_result',
      'inspect_signal',
      'inspect_decision_intelligence',
      'inspect_visual',
      'inspect_priority_entity',
      'inspect_evidence',
      'get_report_context',
      'inspect_agent_checkpoint',
    ]);
    expect(registry.descriptor('inspect_visual')).toMatchObject({
      kind: 'read',
      max_calls_per_turn: 1,
      creates_run: false,
    });

    const decision = await registry.execute(
      execution,
      {
        step_id: 'decision',
        capability_id: 'inspect_decision_intelligence',
        input: { run_id: run.run_id },
      },
      createCapabilityExecutionBudget(),
    );
    expect(decision.capability_id).toBe('inspect_decision_intelligence');
    expect(decision.status).toBe('available');
    expect(decision.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'decision',
          availability: 'available',
          grounding_refs: expect.arrayContaining([
            expect.objectContaining({ type: 'run', ref: { run_id: run.run_id, status: 'succeeded' } }),
          ]),
        }),
      ]),
    );
    expect(decision.available_workspace_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: { type: 'open_dashboard', run_id: run.run_id, report_id: report.report_id },
        }),
      ]),
    );

    const visualResult = await registry.execute(
      execution,
      {
        step_id: 'visual',
        capability_id: 'inspect_visual',
        input: { run_id: run.run_id, chart_id: visual.chart_id },
      },
      createCapabilityExecutionBudget(),
    );
    expect(visualResult).toMatchObject({
      capability_id: 'inspect_visual',
      status: 'available',
    });
    expect(visualResult.observations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'metric', availability: 'available' })]),
    );
    expect(objectKeys(visualResult)).not.toEqual(
      expect.arrayContaining(['data', 'value', 'rows', 'payload']),
    );
    const renderedVisual = await deterministicGroundedAnswer({
      observations: visualResult.observations,
      available_workspace_actions: visualResult.available_workspace_actions,
      context,
      repository: repo,
    });
    expect(renderedVisual.content).toContain('Analysis answer');
    expect(renderedVisual.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'metric_ref' })]),
    );

    const priorityResult = await registry.execute(
      execution,
      {
        step_id: 'priority',
        capability_id: 'inspect_priority_entity',
        input: { run_id: run.run_id, priority_entity_id: priority.priority_entity_id },
      },
      createCapabilityExecutionBudget(),
    );
    expect(priorityResult.status).toBe('available');
    expect(priorityResult.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'decision',
          canonical_text: priority.entity.label,
        }),
      ]),
    );

    const evidenceResult = await registry.execute(
      execution,
      {
        step_id: 'evidence',
        capability_id: 'inspect_evidence',
        input: {
          run_id: run.run_id,
          artifact_id: evidence.artifact_id,
          evidence_path: evidence.path,
        },
      },
      createCapabilityExecutionBudget(),
    );
    expect(evidenceResult).toMatchObject({
      status: 'available',
      observations: [
        expect.objectContaining({
          grounding_refs: expect.arrayContaining([
            expect.objectContaining({
              type: 'evidence',
              ref: {
                run_id: run.run_id,
                artifact_id: evidence.artifact_id,
                evidence_path: evidence.path,
              },
            }),
          ]),
        }),
      ],
    });

    const reportResult = await registry.execute(
      execution,
      {
        step_id: 'report',
        capability_id: 'get_report_context',
        input: { run_id: run.run_id, report_id: report.report_id },
      },
      createCapabilityExecutionBudget(),
    );
    expect(reportResult).toMatchObject({
      status: 'available',
      available_workspace_actions: [
        expect.objectContaining({
          action: { type: 'open_dashboard', run_id: run.run_id, report_id: report.report_id },
        }),
      ],
    });

    // Even a descriptor implementation supplied during application startup
    // cannot bypass the common capability-result parser.
    const capabilityIds = [
      'create_analysis',
      'get_analysis_result',
      'inspect_signal',
      'inspect_decision_intelligence',
      'inspect_visual',
      'inspect_priority_entity',
      'inspect_evidence',
      'get_report_context',
      'inspect_agent_checkpoint',
    ] as const;
    const descriptors = capabilityIds.map((id) => {
      const descriptor = registry.descriptor(id);
      if (!descriptor) throw new Error('CAPABILITY_DESCRIPTOR_REQUIRED');
      return descriptor;
    });
    const outputRejected = new CapabilityRegistry(
      repo,
      descriptors.map((descriptor) =>
        descriptor.id === 'get_analysis_result'
          ? {
              ...descriptor,
              execute: async () => ({ version: 'not-a-capability-result' } as never),
            }
          : descriptor,
      ),
    );
    await expect(
      outputRejected.execute(
        execution,
        {
          step_id: 'invalid-output',
          capability_id: 'get_analysis_result',
          input: { run_id: run.run_id },
        },
        createCapabilityExecutionBudget(),
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_OUTPUT_INVALID' });
  }, 120_000);

  it('fails process initialization on duplicate or incomplete registrations', () => {
    const defaults = new CapabilityRegistry({} as Repository);
    const read = defaults.descriptor('get_analysis_result');
    if (!read) throw new Error('READ_DESCRIPTOR_REQUIRED');

    expect(() => new CapabilityRegistry({} as Repository, [read, read])).toThrow(
      'DUPLICATE_CAPABILITY_ID:get_analysis_result',
    );
    expect(() => new CapabilityRegistry({} as Repository, [read])).toThrow(
      'CAPABILITY_REGISTRY_INVENTORY_INVALID',
    );
  });

  it('queues one analysis from the server-authorized scope and date', async () => {
    const { pg, repo } = await createTestRepository({ workflowVersion: 'agent-v1' });
    resources.push({ repo, close: () => pg.close() });
    const initialInput = turn({
      version: 1,
      mode: 'agent_chat',
      org_id: TEST_ORGS.alpha,
      conversation_id: null,
      scope: request.scope,
      data_as_of: request.data_as_of,
      active_run_ref: null,
      active_report_ref: null,
      active_artifact_ref: null,
      dashboard_selection: null,
      drilldown: null,
      evidence_ref: null,
    });
    const started = await repo.startTurn(
      TEST_USERS.owner,
      initialInput,
      'capability-registry-create-turn',
    );
    const authorizedInput = turn({
      ...initialInput.workspace_context!,
      conversation_id: started.conversation.conversation_id,
    });
    const context = await new RuntimeContextBuilder(repo).build(
      TEST_USERS.owner,
      authorizedInput,
      started.conversation.conversation_id,
    );
    const result = await new CapabilityRegistry(repo).execute(
      {
        authorized_context: context,
        turn_context: {
          org_id: started.conversation.org_id,
          conversation_id: started.conversation.conversation_id,
          user_message_id: started.user_message.message_id,
          assistant_message_id: started.assistant_message.message_id,
          client_turn_id: initialInput.client_turn_id,
        },
        idempotency_key: 'capability-registry-create-run',
      },
      {
        step_id: 'queue-analysis',
        capability_id: 'create_analysis',
        input: { focus: 'current_inventory' },
      },
      createCapabilityExecutionBudget(),
    );
    expect(result).toMatchObject({
      status: 'pending',
      queued_run_ref: { status: 'queued' },
    });
    if (!result.queued_run_ref) throw new Error('QUEUED_RUN_REQUIRED');
    expect(
      (await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, result.queued_run_ref.run_id)).run
        .request,
    ).toMatchObject({ scope: request.scope, data_as_of: request.data_as_of });
    expect(await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(1);
  });

  it('rejects invented evidence/report references, non-mode capabilities, and duplicate calls', async () => {
    const { repo, run, report, evidence, context } = await setup();
    const registry = new CapabilityRegistry(repo);
    const execution = {
      authorized_context: context,
      turn_context: {
        org_id: run.org_id,
        conversation_id: run.request.conversation_id!,
        user_message_id: '70000000-0000-4000-8000-000000000124',
        assistant_message_id: '70000000-0000-4000-8000-000000000125',
        client_turn_id: '70000000-0000-4000-8000-000000000121',
      },
      idempotency_key: 'capability-registry-denied',
    };
    await expect(
      registry.execute(
        execution,
        {
          step_id: 'bad-evidence',
          capability_id: 'inspect_evidence',
          input: {
            run_id: run.run_id,
            artifact_id: evidence.artifact_id,
            evidence_path: 'payload.invented_path',
          },
        },
        createCapabilityExecutionBudget(),
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(
      registry.execute(
        execution,
        {
          step_id: 'bad-report',
          capability_id: 'get_report_context',
          input: {
            run_id: run.run_id,
            report_id: '70000000-0000-4000-8000-000000000126',
          },
        },
        createCapabilityExecutionBudget(),
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });

    const duplicateBudget = createCapabilityExecutionBudget();
    await registry.execute(
      execution,
      {
        step_id: 'decision-one',
        capability_id: 'inspect_decision_intelligence',
        input: { run_id: run.run_id },
      },
      duplicateBudget,
    );
    await expect(
      registry.execute(
        execution,
        {
          step_id: 'decision-two',
          capability_id: 'inspect_decision_intelligence',
          input: { run_id: run.run_id },
        },
        duplicateBudget,
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME_LIMIT_EXCEEDED' });

    const exhaustedTurn = createCapabilityExecutionBudget();
    exhaustedTurn.total_calls = 3;
    await expect(
      registry.execute(
        execution,
        {
          step_id: 'fourth-call',
          capability_id: 'inspect_visual',
          input: { run_id: run.run_id, chart_id: context.allowed_dashboard.chart_ids[0]! },
        },
        exhaustedTurn,
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME_LIMIT_EXCEEDED' });
    const exhaustedMutation = createCapabilityExecutionBudget();
    exhaustedMutation.mutation_calls = 1;
    await expect(
      registry.execute(
        execution,
        {
          step_id: 'blocked-create',
          capability_id: 'create_analysis',
          input: { focus: 'current_inventory' },
        },
        exhaustedMutation,
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME_LIMIT_EXCEEDED' });

    const viewerContext = await new RuntimeContextBuilder(repo).build(
      TEST_USERS.viewer,
      turn({
        version: 1,
        mode: 'agent_chat',
        org_id: run.org_id,
        conversation_id: run.request.conversation_id,
        scope: run.request.scope,
        data_as_of: run.request.data_as_of,
        active_run_ref: { run_id: run.run_id },
        active_report_ref: { run_id: run.run_id, report_id: report.report_id },
        active_artifact_ref: null,
        dashboard_selection: null,
        drilldown: null,
        evidence_ref: null,
      }),
      run.request.conversation_id!,
    );
    expect(registry.available(viewerContext)).not.toContain('create_analysis');
    expect(registry.available(viewerContext)).not.toContain('inspect_priority_entity');
  }, 120_000);
});
