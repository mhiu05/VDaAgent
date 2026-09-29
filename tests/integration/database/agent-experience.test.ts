import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestRepository, TEST_ORGS, TEST_USERS } from '../../helpers/postgres';

const resources: Array<Awaited<ReturnType<typeof createTestRepository>>> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.repo.close();
    await resource.pg.close();
  }
});
async function setup() {
  const resource = await createTestRepository();
  resources.push(resource);
  return resource;
}
const input = (target: 'data' | 'coordinator' = 'data') => ({
  org_id: TEST_ORGS.alpha,
  client_turn_id: randomUUID(),
  text: 'Why is inventory slow?',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  agent_target: target,
});

describe('authorized agent conversation projection', () => {
  it('keeps an accepted human pair in its addressed view and excludes the private turn envelope', async () => {
    const { repo } = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner, input(), 'agent-feed-pair');
    const id = turn.conversation.conversation_id;
    const data = await repo.listAgentFeed(TEST_USERS.owner, TEST_ORGS.alpha, id, 'data');
    expect(data.items.map((item) => item.kind)).toEqual(['message', 'message']);
    expect(
      data.items.every((item) => item.kind === 'message' && item.placement === 'accepted_request'),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toContain('request_hash');
    expect(JSON.stringify(data)).not.toContain('agent_turn');
    expect(
      (await repo.listAgentFeed(TEST_USERS.owner, TEST_ORGS.alpha, id, 'coordinator')).items,
    ).toHaveLength(0);
    const agents = await repo.getConversationAgents(TEST_USERS.owner, TEST_ORGS.alpha, id);
    expect(agents.agents).toHaveLength(8);
    expect(agents.agents.find((agent) => agent.agent_key === 'data')).toMatchObject({
      state: 'queued',
      active_count: 1,
      queued_count: 1,
    });
    expect(
      (await repo.listAgentWork(TEST_USERS.owner, TEST_ORGS.alpha, id, 'data')).items,
    ).toHaveLength(1);
    await expect(
      repo.listAgentFeed(TEST_USERS.owner, TEST_ORGS.beta, id, 'data'),
    ).rejects.toThrow();
  });

  it('pages tied message timestamps without gaps or duplicate anchors', async () => {
    const { repo, pg } = await setup();
    const first = await repo.enqueueAgentTurn(TEST_USERS.owner, input(), 'agent-feed-tie-a');
    const conversation = first.conversation.conversation_id;
    await repo.enqueueAgentTurn(TEST_USERS.owner, input(), 'agent-feed-tie-b', conversation);
    await pg.query('UPDATE messages SET created_at=$1 WHERE org_id=$2 AND conversation_id=$3', [
      '2026-09-19T00:00:00.123456Z',
      TEST_ORGS.alpha,
      conversation,
    ]);
    const expected = (
      await repo.listAgentFeed(TEST_USERS.owner, TEST_ORGS.alpha, conversation, 'data')
    ).items.map((item) => item.item_id);
    expect(expected).toHaveLength(4);
    const visited: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const result = await repo.listAgentFeed(
        TEST_USERS.owner,
        TEST_ORGS.alpha,
        conversation,
        'data',
        { limit: 1, cursor },
      );
      if (!result.items.length) break;
      visited.unshift(result.items[0]!.item_id);
      cursor = result.older_cursor;
    }
    expect(visited).toEqual(expected);
    expect(new Set(visited).size).toBe(4);
    const focused = await repo.listAgentFeed(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
      'data',
      { limit: 1, focus_item: expected[0] },
    );
    expect(focused.items.map((item) => item.item_id)).toEqual([expected[0]]);
  });
  it('keeps all active turns while bounding previews and paginating work', async () => {
    const { repo } = await setup();
    const first = await repo.enqueueAgentTurn(TEST_USERS.owner, input(), 'agent-work-many-0');
    const conversation = first.conversation.conversation_id;
    for (let index = 1; index < 12; index++)
      await repo.enqueueAgentTurn(
        TEST_USERS.owner,
        input(),
        `agent-work-many-${index}`,
        conversation,
      );
    const agents = await repo.getConversationAgents(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
    );
    const data = agents.agents.find((agent) => agent.agent_key === 'data')!;
    expect(data.active_count).toBe(12);
    expect(data.previews).toHaveLength(10);
    expect(agents.active_job_ids).toHaveLength(12);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const work = await repo.listAgentWork(
        TEST_USERS.owner,
        TEST_ORGS.alpha,
        conversation,
        'data',
        { limit: 5, cursor },
      );
      seen.push(...work.items.map((item) => item.work_id));
      cursor = work.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('places one exact delegation request in both caller and callee views with a correlated return', async () => {
    const { repo } = await setup();
    const turn = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      input('coordinator'),
      'agent-feed-runtime',
    );
    const job = (await repo.claimAgentTurnJob('agent-feed-turn', new Date(), 120_000))!;
    const run = await repo.startAgentAnalysis(job, { planned: true });
    const lease = (await repo.claimRun('agent-feed-run', new Date(), 120_000))!;
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:main',
      agent_key: 'coordinator',
      status: 'running',
      summary: 'Running',
    });
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:insight',
      parent_step_key: 'team:main',
      agent_key: 'insight',
      status: 'running',
      summary: 'Running',
    });
    await repo.recordRuntimeActivity(lease, {
      kind: 'message',
      step_key: 'team:insight:request',
      parent_step_key: 'team:main',
      agent_key: 'coordinator',
      target_agent_key: 'insight',
      message_type: 'task_request',
      correlation_id: 'team:insight',
      summary: 'Interpret',
    });
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:insight:data-detail',
      parent_step_key: 'team:insight',
      agent_key: 'data',
      status: 'completed',
      summary: 'Done',
    });
    const request = await repo.recordRuntimeActivity(lease, {
      kind: 'message',
      step_key: 'team:insight:data-detail:request',
      parent_step_key: 'team:insight',
      agent_key: 'insight',
      target_agent_key: 'data',
      message_type: 'task_request',
      correlation_id: 'team:insight:data-detail',
      summary: 'Check evidence',
    });
    const response = await repo.recordRuntimeActivity(lease, {
      kind: 'message',
      step_key: 'team:insight:data-detail:response',
      parent_step_key: 'team:insight',
      agent_key: 'data',
      target_agent_key: 'insight',
      message_type: 'task_result',
      correlation_id: 'team:insight:data-detail',
      parent_message_id: request.activity_id,
      summary: 'Evidence checked',
    });
    const conversation = turn.conversation.conversation_id;
    const insight = await repo.listAgentFeed(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
      'insight',
    );
    const data = await repo.listAgentFeed(TEST_USERS.owner, TEST_ORGS.alpha, conversation, 'data');
    const outgoing = insight.items.find((item) => item.kind === 'delegation');
    const inbound = data.items.find((item) => item.kind === 'inbound_request');
    expect(outgoing?.item_id).toBe(`activity:${request.activity_id}`);
    expect(inbound?.item_id).toBe(outgoing?.item_id);
    expect(outgoing?.kind === 'delegation' && outgoing.delegation.response_activity_id).toBe(
      response.activity_id,
    );
    expect(inbound?.kind === 'inbound_request' && inbound.delegation.child).toMatchObject({
      source: 'runtime',
      run_id: run.run_id,
    });
    const focused = await repo.listAgentFeed(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
      'data',
      { focus_item: `activity:${request.activity_id}` },
    );
    expect(focused.focus_item).toBe(`activity:${request.activity_id}`);
    const normalized = await repo.listAgentFeed(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
      'insight',
      { focus_item: `activity:${response.activity_id}` },
    );
    expect(normalized.focus_item).toBe(`activity:${request.activity_id}`);
    await expect(
      repo.listAgentFeed(TEST_USERS.owner, TEST_ORGS.alpha, conversation, 'coordinator', {
        focus_item: `activity:${request.activity_id}`,
      }),
    ).rejects.toThrow('AGENT_ITEM_NOT_FOUND');
    const summaries = await repo.getConversationAgents(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
    );
    expect(summaries.agents.find((agent) => agent.agent_key === 'data')?.active_count).toBe(0);
  });

  it('does not present a terminal run partial call as live work', async () => {
    const { repo } = await setup();
    const turn = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      input('coordinator'),
      'agent-partial-terminal',
    );
    const job = (await repo.claimAgentTurnJob('agent-partial-turn', new Date(), 120_000))!;
    const run = await repo.startAgentAnalysis(job, { planned: true });
    const lease = (await repo.claimRun('agent-partial-run', new Date(), 120_000))!;
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:main',
      agent_key: 'coordinator',
      status: 'running',
      summary: 'Running',
    });
    await repo.recordRuntimeActivities(lease, [
      {
        kind: 'invocation',
        step_key: 'team:partial',
        parent_step_key: 'team:main',
        agent_key: 'data',
        status: 'queued',
        summary: 'Partial',
      },
      {
        kind: 'message',
        step_key: 'team:partial:request',
        parent_step_key: 'team:main',
        agent_key: 'coordinator',
        target_agent_key: 'data',
        message_type: 'task_request',
        correlation_id: 'team:partial',
        summary: 'Partial',
      },
    ]);
    await repo.failRun(lease, 'TEST_FAILURE');
    const feed = await repo.listAgentFeed(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
      'data',
    );
    expect(
      feed.items.find(
        (item) => item.kind === 'inbound_request' && item.delegation.run_id === run.run_id,
      ),
    ).toMatchObject({ delegation: { status: 'failed', result_summary: null } });
    const summary = await repo.getConversationAgents(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
    );
    expect(summary.active_run_ids).not.toContain(run.run_id);
    expect(summary.agents.find((agent) => agent.agent_key === 'data')?.recent_error).toBe(true);
  });

  it('labels a historical request without a child invocation as partial', async () => {
    const { repo } = await setup();
    const turn = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      input('coordinator'),
      'agent-partial-history',
    );
    const job = (await repo.claimAgentTurnJob('agent-partial-history-turn', new Date(), 120_000))!;
    await repo.startAgentAnalysis(job, { planned: true });
    const lease = (await repo.claimRun('agent-partial-history-run', new Date(), 120_000))!;
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:main',
      agent_key: 'coordinator',
      status: 'running',
      summary: 'Running',
    });
    const request = await repo.recordRuntimeActivity(lease, {
      kind: 'message',
      step_key: 'team:missing:request',
      parent_step_key: 'team:main',
      agent_key: 'coordinator',
      target_agent_key: 'data',
      message_type: 'task_request',
      correlation_id: 'team:missing',
      summary: 'Historical incomplete call',
    });
    const feed = await repo.listAgentFeed(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
      'data',
    );
    expect(
      feed.items.find((item) => item.item_id === `activity:${request.activity_id}`),
    ).toMatchObject({
      kind: 'inbound_request',
      delegation: {
        request_activity_id: request.activity_id,
        child: null,
        linkage: 'historical_partial',
        status: 'queued',
      },
    });
  });

  it('commits accepted call batches atomically and replays their immutable identities', async () => {
    const { repo } = await setup();
    const turn = await repo.enqueueAgentTurn(TEST_USERS.owner, input('coordinator'), 'agent-batch');
    const job = (await repo.claimAgentTurnJob('agent-batch-turn', new Date(), 120_000))!;
    const run = await repo.startAgentAnalysis(job, { planned: true });
    const lease = (await repo.claimRun('agent-batch-run', new Date(), 120_000))!;
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:main',
      agent_key: 'coordinator',
      status: 'running',
      summary: 'Running',
    });
    const begin = [
      {
        kind: 'invocation' as const,
        step_key: 'team:data',
        parent_step_key: 'team:main',
        agent_key: 'data',
        status: 'queued' as const,
        summary: 'Read inventory',
      },
      {
        kind: 'message' as const,
        step_key: 'team:data:request',
        parent_step_key: 'team:main',
        agent_key: 'coordinator',
        target_agent_key: 'data',
        message_type: 'task_request' as const,
        correlation_id: 'team:data',
        summary: 'Read inventory',
      },
      {
        kind: 'invocation' as const,
        step_key: 'team:main',
        agent_key: 'coordinator',
        status: 'waiting' as const,
        summary: 'Waiting on Data',
      },
    ];
    const accepted = await repo.recordRuntimeActivities(lease, begin);
    const before = (await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id)).events
      .length;
    expect(
      (await repo.recordRuntimeActivities(lease, begin)).map((item) => item.activity_id),
    ).toEqual(accepted.map((item) => item.activity_id));
    expect(
      (await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id)).events,
    ).toHaveLength(before);
    await expect(
      repo.recordRuntimeActivities(lease, [
        {
          kind: 'invocation',
          step_key: 'team:data',
          parent_step_key: 'team:main',
          agent_key: 'data',
          status: 'completed',
          summary: 'Done',
        },
        {
          kind: 'message',
          step_key: 'team:data:response',
          parent_step_key: 'team:main',
          agent_key: 'data',
          target_agent_key: 'coordinator',
          message_type: 'task_result',
          correlation_id: 'wrong-call',
          parent_message_id: accepted[1]!.activity_id,
          summary: 'Done',
        },
      ]),
    ).rejects.toThrow('RUNTIME_MESSAGE_PARENT_MISMATCH');
    expect(
      (await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id)).events,
    ).toHaveLength(before);
    await expect(
      repo.recordRuntimeActivities(lease, [
        {
          kind: 'invocation',
          step_key: 'team:data',
          parent_step_key: 'team:main',
          agent_key: 'data',
          status: 'completed',
          summary: 'Done',
        },
        {
          kind: 'message',
          step_key: 'team:data:response',
          parent_step_key: 'team:main',
          agent_key: 'data',
          target_agent_key: 'coordinator',
          message_type: 'task_result',
          correlation_id: 'team:data',
          parent_message_id: accepted[1]!.activity_id,
          summary: 'Done',
          artifact_refs: [randomUUID()],
        },
      ]),
    ).rejects.toThrow('RUNTIME_ARTIFACT_MISMATCH');
    expect(
      (await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id)).events,
    ).toHaveLength(before);
    const snapshot = await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id);
    expect(snapshot.records.find((record) => record.step_key === 'team:data')?.status).toBe(
      'queued',
    );
    expect(snapshot.snapshot_sequence).toBe(snapshot.last_sequence);
    expect(snapshot.snapshot_sequence).toBe(before);
    const terminal = [
      {
        kind: 'invocation' as const,
        step_key: 'team:data',
        parent_step_key: 'team:main',
        agent_key: 'data',
        status: 'completed' as const,
        summary: 'Done',
        duration_ms: 10,
      },
      {
        kind: 'message' as const,
        step_key: 'team:data:response',
        parent_step_key: 'team:main',
        agent_key: 'data',
        target_agent_key: 'coordinator',
        message_type: 'task_result' as const,
        correlation_id: 'team:data',
        parent_message_id: accepted[1]!.activity_id,
        summary: 'Done',
      },
    ];
    const finished = await repo.recordRuntimeActivities(lease, terminal);
    const after = (await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id))
      .last_sequence;
    const replayed = await repo.recordRuntimeActivities(lease, [
      { ...terminal[0], duration_ms: 999 },
      terminal[1],
    ]);
    expect(replayed.map((item) => item.activity_id)).toEqual(
      finished.map((item) => item.activity_id),
    );
    expect(replayed[0]?.duration_ms).toBe(10);
    expect(
      (await repo.getRunRuntime(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id)).last_sequence,
    ).toBe(after);
    expect(turn.conversation.conversation_id).toBe(run.request.conversation_id);
  });

  it('loads the accepted initiating context after newer turns and changed thread defaults', async () => {
    const { repo } = await setup();
    const turn = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      input('data'),
      'agent-context-anchor',
    );
    const job = (await repo.claimAgentTurnJob('agent-context-turn', new Date(), 120_000))!;
    const run = await repo.startAgentAnalysis(job, { planned: true });
    await repo.updateThreadContext(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
      {
        dataset_ids: [],
        active_artifact_id: null,
        active_report_id: null,
        current_run_id: run.run_id,
        referenced_artifact_ids: [],
      },
    );
    for (let i = 0; i < 14; i++)
      await repo.startTurn(
        TEST_USERS.owner,
        { ...input('coordinator'), text: `Later question ${i}` },
        `agent-later-${i}`,
        turn.conversation.conversation_id,
      );
    const anchor = await repo.getAcceptedRunContext(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      run.run_id,
      'data',
    );
    expect(anchor.message?.message_id).toBe(turn.user_message.message_id);
    expect(anchor.request?.agent_target).toBe('data');
    expect(anchor.thread?.current_run_id).toBeNull();
    expect(
      anchor.recent_messages.every((message) => !message.content.startsWith('Later question')),
    ).toBe(true);
  });
  it('counts concurrent same-target calls separately without counting planned persona slots', async () => {
    const { repo } = await setup();
    const turn = await repo.enqueueAgentTurn(
      TEST_USERS.owner,
      input('coordinator'),
      'agent-overlap',
    );
    const job = (await repo.claimAgentTurnJob('agent-overlap-turn', new Date(), 120_000))!;
    const run = await repo.startAgentAnalysis(job, { planned: true });
    const lease = (await repo.claimRun('agent-overlap-run', new Date(), 120_000))!;
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:main',
      agent_key: 'coordinator',
      status: 'running',
      summary: 'Running',
    });
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:insight',
      parent_step_key: 'team:main',
      agent_key: 'insight',
      status: 'running',
      summary: 'Running',
    });
    await repo.recordRuntimeActivity(lease, {
      kind: 'message',
      step_key: 'team:insight:request',
      parent_step_key: 'team:main',
      agent_key: 'coordinator',
      target_agent_key: 'insight',
      message_type: 'task_request',
      correlation_id: 'team:insight',
      summary: 'Interpret',
    });
    await repo.recordRuntimeActivities(lease, [
      {
        kind: 'invocation',
        step_key: 'team:data-a',
        parent_step_key: 'team:main',
        agent_key: 'data',
        status: 'running',
        summary: 'A',
      },
      {
        kind: 'message',
        step_key: 'team:data-a:request',
        parent_step_key: 'team:main',
        agent_key: 'coordinator',
        target_agent_key: 'data',
        message_type: 'task_request',
        correlation_id: 'team:data-a',
        summary: 'Data A',
      },
    ]);
    await repo.recordRuntimeActivities(lease, [
      {
        kind: 'invocation',
        step_key: 'team:data-b',
        parent_step_key: 'team:insight',
        agent_key: 'data',
        status: 'queued',
        summary: 'B',
      },
      {
        kind: 'message',
        step_key: 'team:data-b:request',
        parent_step_key: 'team:insight',
        agent_key: 'insight',
        target_agent_key: 'data',
        message_type: 'task_request',
        correlation_id: 'team:data-b',
        summary: 'Data B',
      },
      {
        kind: 'invocation',
        step_key: 'team:insight',
        parent_step_key: 'team:main',
        agent_key: 'insight',
        status: 'waiting',
        summary: 'Waiting',
      },
    ]);
    await repo.recordRuntimeActivity(lease, {
      kind: 'invocation',
      step_key: 'team:planned',
      parent_step_key: 'team:insight',
      agent_key: 'data',
      status: 'queued',
      summary: 'Planned only',
    });
    const conversation = turn.conversation.conversation_id;
    const summaries = await repo.getConversationAgents(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
    );
    expect(summaries.agents.find((agent) => agent.agent_key === 'data')).toMatchObject({
      state: 'working',
      active_count: 2,
      queued_count: 1,
      running_count: 1,
    });
    const work = await repo.listAgentWork(TEST_USERS.owner, TEST_ORGS.alpha, conversation, 'data');
    expect(work.items.map((item) => item.caller).sort()).toEqual(['coordinator', 'insight']);
    expect(new Set(work.items.map((item) => item.work_id)).size).toBe(2);
    const insight = await repo.listAgentWork(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      conversation,
      'insight',
    );
    expect(insight.items[0]?.waiting_on).toHaveLength(1);
    expect(insight.items[0]?.waiting_on[0]).toMatchObject({
      source: 'runtime',
      run_id: run.run_id,
    });
  });
});
