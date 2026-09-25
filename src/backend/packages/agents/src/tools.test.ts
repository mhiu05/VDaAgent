import { afterEach, describe, expect, it } from 'vitest';
import { executeLease, SAFE_SUMMARY, type NarrativeProvider } from './index';
import {
  createAnalysisTool,
  getAnalysisResultTool,
  inspectSignalTool,
  modelToolNames,
  resolveAgentTargetFollowUpAction,
} from './chat/operations';
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

const baseContext = {
  org_id: TEST_ORGS.alpha,
  conversation_id: '70000000-0000-4000-8000-000000000001',
  user_message_id: '70000000-0000-4000-8000-000000000002',
  assistant_message_id: '70000000-0000-4000-8000-000000000003',
  client_turn_id: '70000000-0000-4000-8000-000000000004',
  user_id: TEST_USERS.owner,
  role: 'owner' as const,
  question: 'Show inventory',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  use_case: 'slow_moving_inventory' as const,
  agent_target: null,
  idempotency_key: 'tool-test',
  allowed_run_ids: [] as string[],
  allowed_conversation_run_ids: [] as string[],
  allowed_signal_refs: [] as { run_id: string; signal_id: string }[],
  allowed_scopes: [{ project_external_id: 'P-ALPHA', zone_external_id: null }],
};

const deterministicProvider = (): NarrativeProvider => ({
  narrate: async (claims) => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }),
});

async function completedBrief(repo: Repository) {
  const run = await repo.createRun(
    TEST_USERS.owner,
    {
      org_id: TEST_ORGS.alpha,
      scope: baseContext.scope,
      data_as_of: baseContext.data_as_of,
      question: baseContext.question,
      conversation_id: null,
    },
    'completed-brief',
  );
  const lease = await repo.claimRun('tool-test-worker');
  if (!lease) throw new Error('LEASE_REQUIRED');
  await executeLease(repo, lease, deterministicProvider());
  const brief = await repo.decisionBrief(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id);
  const signal = brief.decision_brief.where_to_look[0] ?? brief.decision_brief.current_state[0];
  return { run, signal };
}

describe('Agent Chat typed tools', () => {
  it('classifies @Agent text as only bounded artifact/status retrieval', () => {
    expect(resolveAgentTargetFollowUpAction('analyst', 'Show the analysis findings.')).toBe(
      'artifact',
    );
    expect(resolveAgentTargetFollowUpAction('analyst', 'Explain the validated findings.')).toBe(
      'artifact',
    );
    expect(resolveAgentTargetFollowUpAction('comparison', 'Open the comparison pack.')).toBe(
      'artifact',
    );
    expect(resolveAgentTargetFollowUpAction('chart', 'View the charts.')).toBe('artifact');
    expect(resolveAgentTargetFollowUpAction('report', 'Show the report review status.')).toBe(
      'status',
    );
    expect(resolveAgentTargetFollowUpAction('analyst', 'Why is Zone A deteriorating?')).toBeNull();
    expect(
      resolveAgentTargetFollowUpAction('comparison', 'Compare Zone A with Zone B.'),
    ).toBeNull();
    expect(resolveAgentTargetFollowUpAction('chart', 'Create a chart with SQL.')).toBeNull();
    expect(
      resolveAgentTargetFollowUpAction('report', 'Add this comparison to the report.'),
    ).toBeNull();
    expect(resolveAgentTargetFollowUpAction('data', 'Show the data pack.')).toBeNull();
  });

  it('rejects malformed model inputs before repository execution', async () => {
    const repo = await setup();
    await expect(
      createAnalysisTool(repo, baseContext, { action: 'create_analysis', sql: 'select 1' }),
    ).rejects.toThrow();
  });

  it('rejects a run reference that was not in bounded conversation context', async () => {
    const repo = await setup();
    const run = await repo.createRun(
      TEST_USERS.owner,
      {
        org_id: TEST_ORGS.alpha,
        scope: baseContext.scope,
        data_as_of: baseContext.data_as_of,
        question: baseContext.question,
        conversation_id: null,
      },
      'out-of-context',
    );
    await expect(
      getAnalysisResultTool(repo, baseContext, {
        action: 'get_analysis_result',
        run_id: run.run_id,
      }),
    ).rejects.toThrow('RUN_REFERENCE_FORBIDDEN');
  });

  it('rejects a model-selected scope outside the server-built catalog allowlist', async () => {
    const repo = await setup();
    await expect(
      createAnalysisTool(repo, baseContext, {
        action: 'create_analysis',
        focus: 'current_inventory',
        scope_ref: { project_external_id: 'P-ALPHA', zone_external_id: 'Z-UNKNOWN' },
      }),
    ).rejects.toThrow('SCOPE_REFERENCE_FORBIDDEN');
  });

  it('inspects an allowed validated signal without creating another run', async () => {
    const repo = await setup();
    const { run, signal } = await completedBrief(repo);
    const countBefore = (await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).length;
    const result = await inspectSignalTool(
      repo,
      {
        ...baseContext,
        allowed_run_ids: [run.run_id],
        allowed_signal_refs: [{ run_id: run.run_id, signal_id: signal.signal_id }],
      },
      { action: 'inspect_signal', run_id: run.run_id, signal_id: signal.signal_id },
    );
    expect(result.kind).toBe('signal_inspection');
    if (result.kind !== 'signal_inspection') throw new Error('SIGNAL_INSPECTION_REQUIRED');
    expect(result).toMatchObject({ run: { run_id: run.run_id } });
    expect(result.content).toBe(
      'Tín hiệu đã xác thực và bằng chứng liên quan được liên kết bên dưới.',
    );
    expect(result.content).not.toContain(signal.summary);
    expect(result.parts).toContainEqual({
      type: 'signal_ref',
      run_id: run.run_id,
      signal_id: signal.signal_id,
    });
    expect((await repo.listRuns(TEST_USERS.owner, TEST_ORGS.alpha)).length).toBe(countBefore);
  });

  it('rejects an unknown signal before it can be inspected', async () => {
    const repo = await setup();
    const { run, signal } = await completedBrief(repo);
    await expect(
      inspectSignalTool(
        repo,
        {
          ...baseContext,
          allowed_signal_refs: [{ run_id: run.run_id, signal_id: signal.signal_id }],
        },
        { action: 'inspect_signal', run_id: run.run_id, signal_id: 'unknown-signal' },
      ),
    ).rejects.toThrow('SIGNAL_REFERENCE_FORBIDDEN');
  });

  it('re-authorizes signal inspection and denies a foreign tenant actor', async () => {
    const repo = await setup();
    const { run, signal } = await completedBrief(repo);
    await expect(
      inspectSignalTool(
        repo,
        {
          ...baseContext,
          user_id: TEST_USERS.beta,
          role: 'viewer',
          allowed_signal_refs: [{ run_id: run.run_id, signal_id: signal.signal_id }],
        },
        { action: 'inspect_signal', run_id: run.run_id, signal_id: signal.signal_id },
      ),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');
  });

  it('keeps viewers read-only while allowing authorized signal reads', async () => {
    const repo = await setup();
    const { run, signal } = await completedBrief(repo);
    const viewerContext = {
      ...baseContext,
      user_id: TEST_USERS.viewer,
      role: 'viewer' as const,
      allowed_signal_refs: [{ run_id: run.run_id, signal_id: signal.signal_id }],
    };
    await expect(
      createAnalysisTool(repo, viewerContext, {
        action: 'create_analysis',
        focus: 'current_inventory',
      }),
    ).rejects.toThrow('VIEWER_READ_ONLY');
    await expect(
      inspectSignalTool(repo, viewerContext, {
        action: 'inspect_signal',
        run_id: run.run_id,
        signal_id: signal.signal_id,
      }),
    ).resolves.toMatchObject({ kind: 'signal_inspection' });
  });

  it('exposes only the reviewed, one-per-turn selectable operations', () => {
    expect(modelToolNames).toEqual(['create_analysis', 'get_analysis_result', 'inspect_signal']);
  });
});
