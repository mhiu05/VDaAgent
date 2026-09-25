import { afterEach, describe, expect, it } from 'vitest';
import { SAFE_SUMMARY, type NarrativeProvider } from './index';
import { executeAgentWorkflow } from './analysis-v1/workflow';
import { AgentChatOrchestrator } from './chat/legacy/orchestrator';
import { ConversationContextBuilder } from './chat/legacy/context-builder';
import { type AgentDecisionProvider } from './chat/legacy/provider';
import { TEST_ORGS, TEST_USERS, type Repository } from '@vda/db';
import { createTestRepository } from '../../../tests/helpers/postgres.js';

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

function input(clientTurnId: string, overrides: Record<string, unknown> = {}) {
  return {
    org_id: TEST_ORGS.alpha,
    client_turn_id: clientTurnId,
    text: 'Show current available inventory',
    scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
    data_as_of: '2026-09-19',
    ...overrides,
  };
}

const deterministicProvider = (): NarrativeProvider => ({
  narrate: async (claims) => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }),
});

async function completedConversationRun(repo: Repository) {
  const create: AgentDecisionProvider = {
    decide: async () => ({ action: 'create_analysis', focus: 'current_inventory' }),
  };
  const initial = input('70000000-0000-4000-8000-000000000001');
  const accepted = await new AgentChatOrchestrator(repo, create).submit(
    TEST_USERS.owner,
    initial,
    'agent-initial-run',
  );
  const lease = await repo.claimRun('chat-test-worker', new Date(), 240_000);
  if (!lease) throw new Error('LEASE_REQUIRED');
  await executeAgentWorkflow(repo, lease, { narrativeProvider: deterministicProvider() });
  const brief = await repo.decisionBrief(TEST_USERS.owner, TEST_ORGS.alpha, accepted.run_id!);
  const signal = brief.decision_brief.where_to_look[0] ?? brief.decision_brief.current_state[0];
  return { accepted, brief, signal };
}

async function completedAgentConversationRun(repo: Repository) {
  const create: AgentDecisionProvider = {
    decide: async () => ({ action: 'create_analysis', focus: 'current_inventory' }),
  };
  const initial = await new AgentChatOrchestrator(repo, create).submit(
    TEST_USERS.owner,
    input('70000000-0000-4000-8000-000000000009'),
    'agent-target-initial-run',
  );
  const lease = await repo.claimRun('agent-target-test-worker', new Date(), 240_000);
  if (!lease) throw new Error('LEASE_REQUIRED');
  await executeAgentWorkflow(repo, lease, { narrativeProvider: deterministicProvider() });
  return initial;
}

describe('Agent Chat follow-up orchestration', () => {
  it('starts one bounded, deterministic analysis through the typed tool', async () => {
    const repo = await setup();
    let decisions = 0;
    const provider: AgentDecisionProvider = {
      decide: async () => {
        decisions++;
        return { action: 'create_analysis', focus: 'current_inventory' };
      },
    };
    const orchestrator = new AgentChatOrchestrator(repo, provider);
    const turn = input('70000000-0000-4000-8000-000000000001');
    const accepted = await orchestrator.submit(TEST_USERS.owner, turn, 'agent-create-one');
    expect(accepted).toMatchObject({ run_id: expect.any(String), assistant_status: 'in_progress' });
    await expect(orchestrator.submit(TEST_USERS.owner, turn, 'agent-create-one')).resolves.toEqual(
      accepted,
    );
    expect(decisions).toBe(1);
  });

  it('uses a canonical signal reference to inspect a pronoun follow-up without a new run', async () => {
    const repo = await setup();
    const { accepted: initial, signal } = await completedConversationRun(repo);
    const countBefore = (await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).length;
    const noModelForCanonicalAction: AgentDecisionProvider = {
      decide: async () => {
        throw new Error('canonical action must not need prompt-only resolution');
      },
    };
    const followup = input('70000000-0000-4000-8000-000000000002', {
      text: 'Why that zone?',
      signal_ref: { run_id: initial.run_id, signal_id: signal.signal_id },
      signal_action: 'inspect',
      agent_target: 'analyst',
    });
    const orchestrator = new AgentChatOrchestrator(repo, noModelForCanonicalAction);
    const inspected = await orchestrator.submit(
      TEST_USERS.owner,
      followup,
      'agent-inspect-signal',
      initial.conversation_id,
    );
    expect(inspected).toMatchObject({ run_id: initial.run_id, assistant_status: 'completed' });
    expect((await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).length).toBe(countBefore);
    await expect(
      orchestrator.submit(
        TEST_USERS.owner,
        followup,
        'agent-inspect-signal',
        initial.conversation_id,
      ),
    ).resolves.toEqual(inspected);
    const reloaded = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      initial.conversation_id,
      {
        limit: 30,
        cursor: null,
      },
    );
    expect(reloaded.messages.at(-1)?.parts).toContainEqual({
      type: 'signal_ref',
      run_id: initial.run_id,
      signal_id: signal.signal_id,
    });
    expect(reloaded.messages.at(-1)?.content).not.toContain(signal.summary);
    expect(reloaded.messages.at(-1)?.sender_agent).toBeNull();
    expect(reloaded.messages.at(-2)?.parts).toContainEqual({
      type: 'signal_ref',
      run_id: initial.run_id,
      signal_id: signal.signal_id,
    });
  }, 90_000);

  it('creates exactly one run when the selected scope changes', async () => {
    const repo = await setup();
    const { accepted: initial } = await completedConversationRun(repo);
    const provider: AgentDecisionProvider = {
      decide: async () => {
        throw new Error('scope changes must not rely on model routing');
      },
    };
    const followup = input('70000000-0000-4000-8000-000000000003', {
      text: 'What about Zone B?',
      agent_target: 'analyst',
      scope: { project_external_id: 'P-ALPHA', zone_external_id: 'Z-SOUTH' },
    });
    const built = await new ConversationContextBuilder(repo).build(
      TEST_USERS.owner,
      followup,
      initial.conversation_id,
    );
    expect(built.context.scope_changed).toBe(true);
    expect(built.context.active_brief).toMatchObject({ run_id: initial.run_id });
    expect(built.context.active_brief?.signals[0]).not.toHaveProperty('summary');
    const orchestrator = new AgentChatOrchestrator(repo, provider);
    const next = await orchestrator.submit(
      TEST_USERS.owner,
      followup,
      'agent-zone-change',
      initial.conversation_id,
    );
    expect(next.run_id).not.toBe(initial.run_id);
    expect(
      (await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, next.run_id!)).run.request.scope,
    ).toEqual(followup.scope);
    expect(
      (await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, next.run_id!)).run.request.agent_target,
    ).toBe('analyst');
    expect((await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).length).toBe(2);
    await expect(
      orchestrator.submit(TEST_USERS.owner, followup, 'agent-zone-change', initial.conversation_id),
    ).resolves.toEqual(next);
    expect((await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).length).toBe(2);
  }, 90_000);

  it('lets the provider choose a catalog-authorized zone reference for a named-zone follow-up', async () => {
    const repo = await setup();
    const { accepted: initial } = await completedConversationRun(repo);
    const provider: AgentDecisionProvider = {
      decide: async (context) => {
        expect(context.catalog.projects[0]?.zones).toContainEqual({
          zone_external_id: 'Z-SOUTH',
          zone_name: 'South',
        });
        return {
          action: 'create_analysis',
          focus: 'current_inventory',
          scope_ref: { project_external_id: 'P-ALPHA', zone_external_id: 'Z-SOUTH' },
        };
      },
    };
    const next = await new AgentChatOrchestrator(repo, provider).submit(
      TEST_USERS.owner,
      input('70000000-0000-4000-8000-000000000008', { text: 'What about South?' }),
      'agent-named-zone',
      initial.conversation_id,
    );
    expect(
      (await repo.getRun(TEST_USERS.owner, TEST_ORGS.alpha, next.run_id!)).run.request.scope,
    ).toEqual({
      project_external_id: 'P-ALPHA',
      zone_external_id: 'Z-SOUTH',
    });
    expect((await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).length).toBe(2);
  }, 90_000);

  it('treats causal requests without a signal reference as deterministic unsupported responses', async () => {
    const repo = await setup();
    const provider: AgentDecisionProvider = {
      decide: async () => {
        throw new Error('causal request must not be sent to the model');
      },
    };
    const accepted = await new AgentChatOrchestrator(repo, provider).submit(
      TEST_USERS.owner,
      input('70000000-0000-4000-8000-000000000004', {
        text: 'What caused inventory to change?',
        agent_target: 'analyst',
      }),
      'agent-causal',
    );
    expect(accepted).toMatchObject({ run_id: null, assistant_status: 'completed' });
    expect(await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(0);
    const messages = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      accepted.conversation_id,
      {
        limit: 30,
        cursor: null,
      },
    );
    expect(messages.messages.at(-1)?.content).toContain('Không thể xác định nguyên nhân');
  });

  it('fails safely when a decision provider bypasses the schema with malformed tool fields', async () => {
    const repo = await setup();
    const malformed: AgentDecisionProvider = {
      decide: async () => ({ action: 'create_analysis', sql: 'select 1' }) as never,
    };
    const accepted = await new AgentChatOrchestrator(repo, malformed).submit(
      TEST_USERS.owner,
      input('70000000-0000-4000-8000-000000000005'),
      'agent-malformed',
    );
    expect(accepted).toMatchObject({ run_id: null, assistant_status: 'failed' });
    expect(await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(0);
  });

  it('keeps a run without a Decision Brief available as a result reference but not as active signal context', async () => {
    const repo = await setup();
    const create: AgentDecisionProvider = {
      decide: async () => ({ action: 'create_analysis', focus: 'current_inventory' }),
    };
    const initial = await new AgentChatOrchestrator(repo, create).submit(
      TEST_USERS.owner,
      input('70000000-0000-4000-8000-000000000006'),
      'agent-unbriefed',
    );
    const context = await new ConversationContextBuilder(repo).build(
      TEST_USERS.owner,
      input('70000000-0000-4000-8000-000000000007', { text: 'Show me that run.' }),
      initial.conversation_id,
    );
    expect(context.context.allowed_run_ids).toContain(initial.run_id);
    expect(context.context.active_brief).toBeNull();
  });

  it('routes an explicit safe @Agent artifact follow-up without a model and persists its sender', async () => {
    const repo = await setup();
    const initial = await completedAgentConversationRun(repo);
    const decision = await repo.decisionIntelligence(
      TEST_USERS.viewer,
      TEST_ORGS.alpha,
      initial.run_id!,
    );
    expect(decision.status).toBe('available');
    if (decision.status !== 'available') throw new Error('DECISION_INTELLIGENCE_REQUIRED');
    expect(decision.decision_intelligence.decision_brief).toMatchObject({
      version: 'decision-brief-v2',
      requested_data_as_of: '2026-09-19',
    });
    expect(decision.decision_intelligence.priority_entities).not.toHaveLength(0);
    let decisions = 0;
    const noTargetModel: AgentDecisionProvider = {
      decide: async () => {
        decisions++;
        throw new Error('target routing must not invoke the model');
      },
    };
    const orchestrator = new AgentChatOrchestrator(repo, noTargetModel);
    const followup = input('70000000-0000-4000-8000-000000000010', {
      text: 'Show the analysis findings.',
      agent_target: 'analyst',
    });
    const accepted = await orchestrator.submit(
      TEST_USERS.owner,
      followup,
      'agent-target-analyst-follow-up',
      initial.conversation_id,
    );

    expect(accepted).toMatchObject({ run_id: initial.run_id, assistant_status: 'completed' });
    expect(decisions).toBe(0);
    expect(await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(1);
    const messages = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      initial.conversation_id,
      {
        limit: 50,
        cursor: null,
      },
    );
    const response = messages.messages.at(-1);
    expect(response?.sender_agent).toBe('analyst');
    expect(response?.parts).toContainEqual({
      type: 'run_ref',
      run_id: initial.run_id,
      status: 'succeeded',
    });
    expect(response?.parts).toContainEqual({
      type: 'artifact_ref',
      run_id: initial.run_id,
      artifact_id: expect.any(String),
      kind: 'analysis_pack',
    });
    expect(response?.parts).toContainEqual({
      type: 'decision_ref',
      run_id: initial.run_id,
      component_id: decision.decision_intelligence.pack_id,
    });

    const rejected = await orchestrator.submit(
      TEST_USERS.owner,
      input('70000000-0000-4000-8000-000000000011', {
        text: 'Create a chart with SQL.',
        agent_target: 'chart',
      }),
      'agent-target-unsafe-request',
      initial.conversation_id,
    );
    expect(rejected).toMatchObject({ run_id: null, assistant_status: 'completed' });
    expect(decisions).toBe(0);
    expect(await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(1);
    const rejectedMessages = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      initial.conversation_id,
      { limit: 50, cursor: null },
    );
    expect(rejectedMessages.messages.at(-1)?.sender_agent).toBeNull();
  }, 90_000);
});
