import { afterEach, describe, expect, it } from 'vitest';
import type { Repository } from '@vda/db';
import { SAFE_SUMMARY } from '@vda/domain';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';
import { executeAgentWorkflow } from '../../../src/backend/agents/analysis/workflow';
import {
  createAnalysisTool,
  getAnalysisResultTool,
  inspectSignalTool,
  resolveAgentTargetFollowUpAction,
} from '../../../src/backend/agents/chat/operations';

const resources: Array<{ repo: Repository; close: () => Promise<void> }> = [];
async function repository() {
  const { pg, repo } = await createTestRepository();
  resources.push({ repo, close: () => pg.close() });
  return repo;
}
afterEach(async () => {
  for (const item of resources.splice(0)) {
    await item.repo.close();
    await item.close();
  }
});

const context = {
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
  idempotency_key: 'operations-root',
  allowed_run_ids: [] as string[],
  allowed_conversation_run_ids: [] as string[],
  allowed_signal_refs: [] as Array<{ run_id: string; signal_id: string }>,
  allowed_scopes: [{ project_external_id: 'P-ALPHA', zone_external_id: null }],
};

describe('typed Agent Chat operations', () => {
  it('limits @Agent follow-ups to bounded artifacts and statuses', () => {
    const examples: Array<[string, string, 'artifact' | 'status' | null]> = [
      ['analyst', 'Show the analysis findings.', 'artifact'],
      ['analyst', 'Explain the validated findings.', 'artifact'],
      ['comparison', 'Open the comparison pack.', 'artifact'],
      ['chart', 'View the charts.', 'artifact'],
      ['report', 'Show the report review status.', 'status'],
      ['data', 'Show the data pack.', 'artifact'],
      ['insight', 'Show the validated findings.', 'artifact'],
      ['reviewer', 'Show the review status.', 'status'],
      ['analyst', 'Why is Zone A deteriorating?', null],
      ['comparison', 'Compare Zone A with Zone B.', null],
      ['chart', 'Create a chart with SQL.', null],
      ['report', 'Add this comparison to the report.', null],
    ];
    for (const [agent, text, expected] of examples)
      expect(resolveAgentTargetFollowUpAction(agent as never, text)).toBe(expected);
  });

  it('rejects malformed input, unselected runs, and an out-of-catalog scope', async () => {
    const repo = await repository();
    await expect(
      createAnalysisTool(repo, context, {
        action: 'create_analysis',
        sql: 'select 1',
      }),
    ).rejects.toThrow();
    const run = await repo.createRun(
      TEST_USERS.owner,
      {
        org_id: context.org_id,
        scope: context.scope,
        data_as_of: context.data_as_of,
        question: context.question,
        conversation_id: null,
      },
      'out-of-context-root',
    );
    await expect(
      getAnalysisResultTool(repo, context, {
        action: 'get_analysis_result',
        run_id: run.run_id,
      }),
    ).rejects.toThrow('RUN_REFERENCE_FORBIDDEN');
    await expect(
      createAnalysisTool(repo, context, {
        action: 'create_analysis',
        focus: 'current_inventory',
        scope_ref: { project_external_id: 'P-ALPHA', zone_external_id: 'Z-UNKNOWN' },
      }),
    ).rejects.toThrow('SCOPE_REFERENCE_FORBIDDEN');
  });

  it('inspects only a selected validated signal without another run and reauthorizes each reader', async () => {
    const repo = await repository();
    const run = await repo.createRun(
      TEST_USERS.owner,
      {
        org_id: context.org_id,
        scope: context.scope,
        data_as_of: context.data_as_of,
        question: context.question,
        conversation_id: null,
      },
      'completed-brief-root',
    );
    const lease = await repo.claimRun('operations-root-worker', new Date(), 240_000);
    if (!lease) throw new Error('Missing lease');
    await executeAgentWorkflow(repo, lease, {
      narrativeProvider: {
        narrate: async (claims) => ({ summary: SAFE_SUMMARY, claims, provider: 'gemini' }),
      },
    });
    const brief = await repo.decisionBrief(TEST_USERS.owner, context.org_id, run.run_id);
    const signal = brief.decision_brief.where_to_look[0] ?? brief.decision_brief.current_state[0];
    const selected = { run_id: run.run_id, signal_id: signal.signal_id };
    const allowed = { ...context, allowed_run_ids: [run.run_id], allowed_signal_refs: [selected] };
    const count = (await repo.listRuns(TEST_USERS.owner, context.org_id)).length;
    const inspected = await inspectSignalTool(repo, allowed, {
      action: 'inspect_signal',
      ...selected,
    });
    expect(inspected).toMatchObject({ kind: 'signal_inspection', run: { run_id: run.run_id } });
    if (inspected.kind !== 'signal_inspection') throw new Error('Missing signal inspection');
    expect(inspected.content).not.toContain(signal.summary);
    expect(inspected.parts).toContainEqual({ type: 'signal_ref', ...selected });
    expect((await repo.listRuns(TEST_USERS.owner, context.org_id)).length).toBe(count);

    await expect(
      inspectSignalTool(repo, allowed, {
        action: 'inspect_signal',
        run_id: run.run_id,
        signal_id: 'invented-signal',
      }),
    ).rejects.toThrow('SIGNAL_REFERENCE_FORBIDDEN');
    await expect(
      inspectSignalTool(
        repo,
        { ...allowed, user_id: TEST_USERS.beta, role: 'viewer' },
        { action: 'inspect_signal', ...selected },
      ),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');
    const viewer = { ...allowed, user_id: TEST_USERS.viewer, role: 'viewer' as const };
    await expect(
      createAnalysisTool(repo, viewer, {
        action: 'create_analysis',
        focus: 'current_inventory',
      }),
    ).rejects.toThrow('VIEWER_READ_ONLY');
    await expect(
      inspectSignalTool(repo, viewer, { action: 'inspect_signal', ...selected }),
    ).resolves.toMatchObject({ kind: 'signal_inspection' });
  }, 90_000);
});
