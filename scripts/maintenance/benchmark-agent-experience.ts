/** Isolated projection benchmark. Never connects to a shared database. */
import { randomUUID } from 'node:crypto';
import { AgentExperienceRepository } from '../../src/backend/database/repositories/agent-experience-repository';
import type { Driver } from '../../src/backend/database/driver';
import {
  createTestRepository,
  pgliteDriver,
  TEST_ORGS,
  TEST_USERS,
} from '../../tests/helpers/postgres';

const { pg, repo } = await createTestRepository();
const org = TEST_ORGS.alpha;
const user = TEST_USERS.owner;
const request = (agent_target: 'coordinator' | 'insight') => ({
  org_id: org,
  client_turn_id: randomUUID(),
  text: 'Analyze inventory movement',
  scope: { project_external_id: 'P-ALPHA', zone_external_id: null },
  data_as_of: '2026-09-19',
  agent_target,
});

type Captured = { sql: string; params: unknown[] };
const captured: Captured[] = [];
function trace(base: Driver): Driver {
  return {
    ...base,
    query: async (sql, params = []) => {
      if (sql.includes('message_candidates') || sql.includes('accepted_work'))
        captured.push({ sql, params });
      return base.query(sql, params);
    },
    transaction: (fn) => base.transaction((tx) => fn(trace(tx))),
  };
}

try {
  const first = await repo.enqueueAgentTurn(user, request('coordinator'), 'bench-agent-1');
  const conversation = first.conversation.conversation_id;
  await repo.enqueueAgentTurn(user, request('insight'), 'bench-agent-2', conversation);
  for (const index of [1, 2]) {
    const job = (await repo.claimAgentTurnJob(`bench-agent-${index}`, new Date(), 120_000))!;
    const run = await repo.startAgentAnalysis(job, { planned: true });
    const lease = (await repo.claimRun(`bench-run-${index}`, new Date(), 120_000))!;
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
        step_key: 'team:data',
        parent_step_key: 'team:main',
        agent_key: 'data',
        status: 'queued',
        summary: 'Read inventory',
      },
      {
        kind: 'message',
        step_key: 'team:data:request',
        parent_step_key: 'team:main',
        agent_key: 'coordinator',
        target_agent_key: 'data',
        message_type: 'task_request',
        correlation_id: 'team:data',
        summary: 'Read inventory',
      },
      {
        kind: 'invocation',
        step_key: 'team:main',
        agent_key: 'coordinator',
        status: 'waiting',
        summary: 'Waiting for Data',
      },
    ]);
    if (run.run_id !== lease.run.run_id) throw new Error('Unexpected run claim');
  }
  const base = (
    await pg.query<{ payload: unknown }>('SELECT payload FROM messages WHERE org_id=$1 AND id=$2', [
      org,
      first.user_message.message_id,
    ])
  ).rows[0]!.payload;
  // One thousand mixed-addressed historical items with distinct timestamps.
  await pg.query(
    `INSERT INTO messages(org_id,id,conversation_id,run_id,payload,client_turn_id,role,status,created_at,updated_at,sender_agent)
    SELECT $1,id,$2,NULL,
      jsonb_set(jsonb_set($3::jsonb,'{message_id}',to_jsonb(id)),
        '{agent_turn,request,agent_target}',to_jsonb(CASE WHEN n%4=0 THEN 'data' WHEN n%4=1 THEN 'insight' ELSE 'coordinator' END)),
      NULL,'user','completed',at,at,NULL
    FROM (SELECT n,('90000000-0000-4000-8000-'||lpad(n::text,12,'0')) AS id,
      now()-(1001-n)*interval '1 minute' AS at FROM generate_series(1,1000) AS n) history`,
    [org, conversation, JSON.stringify(base)],
  );

  const projection = new AgentExperienceRepository(trace(pgliteDriver(pg)));
  type PlanNode = {
    'Node Type': string;
    'Relation Name'?: string;
    'Index Name'?: string;
    'Actual Rows': number;
    'Actual Loops': number;
    Plans?: PlanNode[];
  };
  function scans(
    node: PlanNode,
  ): Array<{ node: string; relation?: string; index?: string; rows: number }> {
    const own = node['Node Type'].includes('Scan')
      ? [
          {
            node: node['Node Type'],
            relation: node['Relation Name'],
            index: node['Index Name'],
            rows: node['Actual Rows'] * node['Actual Loops'],
          },
        ]
      : [];
    return [...own, ...(node.Plans ?? []).flatMap(scans)];
  }
  async function measure(label: string, operation: () => Promise<unknown>) {
    captured.length = 0;
    const started = performance.now();
    await operation();
    const elapsed_ms = Math.round((performance.now() - started) * 100) / 100;
    const plans = [];
    for (const query of captured) {
      const rows = (
        await pg.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, query.params)
      ).rows;
      const value = (rows[0] as Record<string, unknown> | undefined)?.['QUERY PLAN'] as Array<{
        Plan: PlanNode;
        'Execution Time': number;
      }>;
      plans.push({
        node: value?.[0]?.Plan?.['Node Type'],
        rows: value?.[0]?.Plan?.['Actual Rows'],
        execution_ms: value?.[0]?.['Execution Time'],
        scans: value?.[0]?.Plan ? scans(value[0].Plan) : [],
      });
    }
    process.stdout.write(`${JSON.stringify({ label, elapsed_ms, plans })}\n`);
  }
  await measure('latest data feed', () => projection.listFeed(user, org, conversation, 'data'));
  await measure('deep focus', () =>
    projection.listFeed(user, org, conversation, 'data', {
      focus_item: 'message:90000000-0000-4000-8000-000000000004',
    }),
  );
  await measure('two active runs summary', () => projection.summaries(user, org, conversation));
  await measure('accepted work', () => projection.listWork(user, org, conversation, 'data'));
} finally {
  await repo.close();
  await pg.close();
}
