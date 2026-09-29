import { createHash } from 'node:crypto';
import {
  AgentKeySchema,
  RuntimeActivityRecordSchema,
  type AcceptedWork,
  type AgentWorkPage,
  type ConversationAgents,
  type AgentFeedItem,
  type AgentFeedPage,
  type AgentKey,
  type DelegationView,
  type ExecutionRef,
  type RuntimeActivityRecord,
} from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver, Row } from '../driver';
import { fail } from '../errors';
import {
  acceptedRecipient,
  agentItemId,
  canonicalStoredAgent,
  decodeScopedAgentCursor,
  encodeAgentCursor,
  parseAgentItemId,
  type AgentCursorScope,
  type AgentCursorTuple,
} from '../mapping/agent-experience';
import { normalizeMessage } from '../mapping/conversation';
import { json } from '../mapping/rows';

type Anchor = {
  source: 'message' | 'activity';
  id: string;
  run_id: string | null;
  timestamp: string;
  rank: 0 | 1;
};
type Scope = AgentCursorScope;
const stamp = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const storedAgentSql = (field: string) => `CASE ${field} WHEN 'orchestrator' THEN 'coordinator'
  WHEN 'main' THEN 'coordinator' WHEN 'compare' THEN 'comparison' ELSE ${field} END`;

// Each source contributes one anchor. Result messages only anchor the callee view;
// caller cards get their response through the same-run correlation companion.
const messageCandidates = `SELECT 'message'::text AS source,m.id,m.run_id,m.created_at AS sort_at,
    ${stamp.replace('created_at', 'm.created_at')} AS timestamp,0 AS rank
  FROM messages m
  LEFT JOIN LATERAL (
    SELECT p.sender_agent FROM messages p
    WHERE m.role='user' AND m.client_turn_id IS NOT NULL AND p.org_id=m.org_id
      AND p.conversation_id=m.conversation_id AND p.client_turn_id=m.client_turn_id AND p.role='assistant'
    LIMIT 1
  ) paired ON true
  WHERE m.org_id=$1 AND m.conversation_id=$2
    AND (CASE
      WHEN m.payload #> '{agent_turn,request}' IS NOT NULL THEN
        CASE COALESCE(m.payload #>> '{agent_turn,request,agent_target}','coordinator')
          WHEN 'orchestrator' THEN 'coordinator' WHEN 'main' THEN 'coordinator'
          WHEN 'compare' THEN 'comparison'
          ELSE COALESCE(m.payload #>> '{agent_turn,request,agent_target}','coordinator') END
      WHEN m.role='assistant' THEN
        CASE m.sender_agent WHEN 'orchestrator' THEN 'coordinator' WHEN 'compare' THEN 'comparison'
          ELSE COALESCE(m.sender_agent,'coordinator') END
      ELSE COALESCE(paired.sender_agent,'coordinator') END)=$3`;
const activityCandidates = `SELECT 'activity'::text AS source,a.id,a.run_id,a.created_at AS sort_at,
    ${stamp.replace('created_at', 'a.created_at')} AS timestamp,1 AS rank
  FROM runtime_activities a
  WHERE a.org_id=$1 AND a.conversation_id=$2 AND a.kind='message'
    AND (CASE
      WHEN a.payload->>'message_type' IN ('task_request','data_request','analysis_request','review_request','clarification_request','request')
        THEN $3 IN (${storedAgentSql("a.payload->>'agent_key'")},${storedAgentSql("a.payload->>'target_agent_key'")})
      WHEN a.payload->>'message_type' IN ('task_result','response')
        THEN ${storedAgentSql("a.payload->>'agent_key'")}=$3
      ELSE false END)`;
const candidates = `WITH message_candidates AS (${messageCandidates}), activity_candidates AS (${activityCandidates}), candidates AS (
  SELECT * FROM message_candidates UNION ALL SELECT * FROM activity_candidates
)`;

const acceptedWork = `WITH accepted_work AS (
  SELECT 'turn'::text AS kind,j.id AS work_id,j.created_at AS accepted_at,j.updated_at,
    j.status AS state,j.run_id,j.user_message_id AS item_source_id,
    CASE COALESCE(m.payload #>> '{agent_turn,request,agent_target}','coordinator')
      WHEN 'orchestrator' THEN 'coordinator' WHEN 'main' THEN 'coordinator'
      WHEN 'compare' THEN 'comparison'
      ELSE COALESCE(m.payload #>> '{agent_turn,request,agent_target}','coordinator') END AS agent_key,
    'human'::text AS caller,LEFT(m.payload->>'content',2000) AS summary,
    root.id AS invocation_id,NULL::text AS step_key,NULL::text AS parent_step_key
  FROM agent_turn_jobs j JOIN messages m ON m.org_id=j.org_id AND m.id=j.user_message_id
  LEFT JOIN agent_invocations root ON root.org_id=j.org_id AND root.job_id=j.id AND root.parent_id IS NULL
  WHERE j.org_id=$1 AND j.conversation_id=$2 AND j.status IN ('queued','running','waiting')
  UNION ALL
  SELECT 'runtime_child',a.id,req.created_at,a.updated_at,a.status,a.run_id,req.id,
    ${storedAgentSql("a.payload->>'agent_key'")},${storedAgentSql("req.payload->>'agent_key'")},LEFT(req.payload->>'summary',2000),
    a.id,a.step_key,a.payload->>'parent_step_key'
  FROM runtime_activities a
  JOIN runtime_activities req ON req.org_id=a.org_id AND req.run_id=a.run_id
    AND req.kind='message' AND req.step_key=a.step_key||':request'
    AND req.payload->>'message_type' IN ('task_request','data_request','analysis_request','review_request','clarification_request','request')
  JOIN runs r ON r.org_id=a.org_id AND r.id=a.run_id AND r.status IN ('queued','running')
  WHERE a.org_id=$1 AND a.conversation_id=$2 AND a.kind='invocation'
    AND a.status IN ('queued','running','waiting')
)`;

function tuple(anchor: Anchor): AgentCursorTuple {
  return { timestamp: anchor.timestamp, rank: anchor.rank, id: anchor.id };
}
function ref(record: RuntimeActivityRecord | null): ExecutionRef | null {
  return record?.kind === 'invocation'
    ? { source: 'runtime', run_id: record.run_id, activity_id: record.activity_id }
    : null;
}
function key(record: RuntimeActivityRecord) {
  return `${record.run_id}:${record.step_key}`;
}
function digest(items: readonly { id: string; timestamp: string }[]): string {
  return createHash('sha256')
    .update(items.map((item) => `${item.timestamp}:${item.id}`).join('|'))
    .digest('hex')
    .slice(0, 32);
}

export class AgentExperienceRepository {
  constructor(private readonly db: Driver) {}

  async listWork(
    user: string,
    org: string,
    conversation: string,
    rawAgent: string,
    options: { limit?: number; cursor?: string | null } = {},
  ): Promise<AgentWorkPage> {
    const agent = AgentKeySchema.parse(rawAgent);
    const limit = options.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_AGENT_PAGE', 422);
    const scope: Scope = { org, conversation, agent };
    const cursor = options.cursor ? decodeScopedAgentCursor(options.cursor, scope) : null;
    if (cursor && cursor.direction !== 'newer') fail('INVALID_CURSOR', 422);
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await authorizeInTransaction(tx, user, org);
      if (
        !(
          await tx.query('SELECT id FROM conversations WHERE org_id=$1 AND id=$2', [
            org,
            conversation,
          ])
        )[0]
      )
        fail('CONVERSATION_NOT_FOUND', 404);
      const rows = await tx.query(
        `${acceptedWork} SELECT *,${stamp.replace('created_at', 'accepted_at')} AS precise_at
        FROM accepted_work WHERE agent_key=$3
          AND ($4::timestamptz IS NULL OR (accepted_at,work_id)>($4::timestamptz,$5::text))
        ORDER BY accepted_at,work_id LIMIT $6`,
        [org, conversation, agent, cursor?.timestamp ?? null, cursor?.id ?? '', limit + 1],
      );
      const pageRows = rows.slice(0, limit);
      const items = await this.mapWork(tx, org, agent, pageRows);
      const last = pageRows.at(-1);
      return {
        conversation_id: conversation,
        agent_key: agent,
        items,
        next_cursor:
          rows.length > limit && last
            ? encodeAgentCursor(scope, 'newer', {
                timestamp: String(last.precise_at),
                rank: last.kind === 'turn' ? 0 : 1,
                id: String(last.work_id),
              })
            : null,
        revision: digest(
          pageRows.map((row) => ({ id: String(row.work_id), timestamp: String(row.updated_at) })),
        ),
      };
    });
  }

  async summaries(user: string, org: string, conversation: string): Promise<ConversationAgents> {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await authorizeInTransaction(tx, user, org);
      if (
        !(
          await tx.query('SELECT id FROM conversations WHERE org_id=$1 AND id=$2', [
            org,
            conversation,
          ])
        )[0]
      )
        fail('CONVERSATION_NOT_FOUND', 404);
      const rows = await tx.query(
        `${acceptedWork}, ranked AS (
        SELECT *,row_number() OVER (PARTITION BY agent_key ORDER BY accepted_at DESC,work_id DESC) AS preview_rank
        FROM accepted_work
      ) SELECT *,${stamp.replace('created_at', 'accepted_at')} AS precise_at FROM ranked
        WHERE preview_rank<=10 ORDER BY agent_key,accepted_at DESC,work_id DESC`,
        [org, conversation],
      );
      const totals = await tx.query(
        `${acceptedWork} SELECT agent_key,state,count(*)::int AS total,
        array_agg(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL) AS run_ids
        FROM accepted_work GROUP BY agent_key,state`,
        [org, conversation],
      );
      const failed = await tx.query(
        `SELECT DISTINCT ${storedAgentSql("a.payload->>'agent_key'")} AS agent_key
         FROM runtime_activities a
         WHERE a.org_id=$1 AND a.conversation_id=$2 AND a.kind='invocation'
           AND a.status='failed' AND a.updated_at>=now()-interval '24 hours'
         UNION
         SELECT DISTINCT CASE COALESCE(m.payload #>> '{agent_turn,request,agent_target}','coordinator')
           WHEN 'orchestrator' THEN 'coordinator' WHEN 'main' THEN 'coordinator'
           WHEN 'compare' THEN 'comparison'
           ELSE COALESCE(m.payload #>> '{agent_turn,request,agent_target}','coordinator') END
         FROM agent_turn_jobs j JOIN messages m ON m.org_id=j.org_id AND m.id=j.user_message_id
         WHERE j.org_id=$1 AND j.conversation_id=$2 AND j.status='failed'
           AND j.updated_at>=now()-interval '24 hours'`,
        [org, conversation],
      );
      const failedAgents = new Set(failed.map((row) => String(row.agent_key)));
      const agents: ConversationAgents['agents'] = [];
      for (const agent of AgentKeySchema.options) {
        const selected = rows.filter((row) => row.agent_key === agent);
        const counts = { queued: 0, running: 0, waiting: 0 };
        for (const row of totals.filter((row) => row.agent_key === agent))
          counts[row.state as keyof typeof counts] = Number(row.total);
        const previews = await this.mapWork(tx, org, agent, selected);
        const state = counts.running
          ? 'working'
          : counts.waiting
            ? 'waiting'
            : counts.queued
              ? 'queued'
              : 'idle';
        agents.push({
          agent_key: agent,
          state,
          active_count: counts.queued + counts.running + counts.waiting,
          queued_count: counts.queued,
          running_count: counts.running,
          waiting_count: counts.waiting,
          recent_error: failedAgents.has(agent),
          latest_activity_at: (selected[0]?.precise_at as string) ?? null,
          previews,
        });
      }
      const latest = await tx.query(
        `SELECT
        (SELECT max(updated_at) FROM messages WHERE org_id=$1 AND conversation_id=$2) AS message_at,
        (SELECT max(updated_at) FROM runtime_activities WHERE org_id=$1 AND conversation_id=$2) AS activity_at`,
        [org, conversation],
      );
      const revision = digest([
        {
          id: conversation,
          timestamp: JSON.stringify({
            messages: latest[0]?.message_at,
            runtime: latest[0]?.activity_at,
            totals: totals.map((row) => [row.agent_key, row.state, row.total]),
          }),
        },
      ]);
      const jobs = await tx.query(
        `SELECT j.id,CASE WHEN r.status IN ('queued','running') THEN j.run_id ELSE NULL END AS run_id
        FROM agent_turn_jobs j LEFT JOIN runs r ON r.org_id=j.org_id AND r.id=j.run_id
        WHERE j.org_id=$1 AND j.conversation_id=$2 AND j.status IN ('queued','running','waiting')`,
        [org, conversation],
      );
      const activeRunIds = [
        ...new Set([
          ...jobs
            .map((row) => row.run_id)
            .filter(Boolean)
            .map(String),
          ...totals.flatMap((row) => (Array.isArray(row.run_ids) ? row.run_ids.map(String) : [])),
        ]),
      ];
      return {
        conversation_id: conversation,
        agents,
        revision,
        active_job_ids: jobs.map((row) => String(row.id)),
        active_run_ids: activeRunIds,
      };
    });
  }

  private async mapWork(
    tx: Driver,
    org: string,
    agent: AgentKey,
    rows: Row[],
  ): Promise<AcceptedWork[]> {
    const waiting = rows.filter((row) => row.kind === 'runtime_child' && row.state === 'waiting');
    const children = waiting.length
      ? await tx.query(
          `SELECT child.payload FROM runtime_activities child
      JOIN runtime_activities req ON req.org_id=child.org_id AND req.run_id=child.run_id
        AND req.kind='message' AND req.step_key=child.step_key||':request'
        AND req.payload->>'message_type' IN ('task_request','data_request','analysis_request','review_request','clarification_request','request')
      WHERE child.org_id=$1 AND child.run_id=ANY($2::text[]) AND child.kind='invocation'
        AND child.status IN ('queued','running','waiting')`,
          [org, [...new Set(waiting.map((row) => String(row.run_id)))]],
        )
      : [];
    const childRecords = children.map((row) => RuntimeActivityRecordSchema.parse(json(row)));
    return rows.map((row) => {
      const runtime = row.kind === 'runtime_child';
      const runId = row.run_id ? String(row.run_id) : null;
      const execution: ExecutionRef | null =
        runtime && runId
          ? { source: 'runtime', run_id: runId, activity_id: String(row.invocation_id) }
          : row.invocation_id
            ? {
                source: 'job',
                job_id: String(row.work_id),
                invocation_id: String(row.invocation_id),
              }
            : null;
      return {
        work_id: `${runtime ? 'activity' : 'job'}:${row.work_id}`,
        kind: runtime ? 'runtime_child' : 'turn',
        agent_key: agent,
        caller: runtime ? (canonicalStoredAgent(row.caller) ?? 'human') : 'human',
        state: row.state as AcceptedWork['state'],
        summary: String(row.summary ?? '').slice(0, 2000),
        accepted_at: String(row.precise_at),
        started_at: null,
        execution,
        item_id: agentItemId(runtime ? 'activity' : 'message', String(row.item_source_id)),
        waiting_on:
          runtime && runId && row.state === 'waiting'
            ? childRecords
                .filter((child) => child.run_id === runId && child.parent_step_key === row.step_key)
                .map((child) => ({
                  source: 'runtime' as const,
                  run_id: runId,
                  activity_id: child.activity_id,
                }))
            : [],
        run_id: runId,
      };
    });
  }

  async listFeed(
    user: string,
    org: string,
    conversation: string,
    rawAgent: string,
    options: {
      limit?: number;
      cursor?: string | null;
      focus_item?: string | null;
    } = {},
  ): Promise<AgentFeedPage> {
    const agent = AgentKeySchema.parse(rawAgent);
    const limit = options.limit ?? 30;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (options.cursor && options.focus_item)
    )
      fail('INVALID_AGENT_PAGE', 422);
    const scope: Scope = { org, conversation, agent };
    const cursor = options.cursor ? decodeScopedAgentCursor(options.cursor, scope) : null;
    const focus = options.focus_item ? parseAgentItemId(options.focus_item) : null;
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await authorizeInTransaction(tx, user, org);
      if (
        !(
          await tx.query('SELECT id FROM conversations WHERE org_id=$1 AND id=$2', [
            org,
            conversation,
          ])
        )[0]
      )
        fail('CONVERSATION_NOT_FOUND', 404);
      let anchors: Anchor[];
      let focusAnchor: Anchor | null = null;
      if (focus) {
        let found = await tx.query(
          `${candidates} SELECT * FROM candidates WHERE source=$4 AND id=$5 LIMIT 1`,
          [org, conversation, agent, focus.source, focus.id],
        );
        if (!found[0] && focus.source === 'activity') {
          // A caller-side result lives inside its request card, not as another
          // chronological anchor. Normalize only after checking both records in scope.
          const response = await tx.query(
            `SELECT run_id,payload FROM runtime_activities WHERE org_id=$1
            AND conversation_id=$2 AND id=$3 AND kind='message'`,
            [org, conversation, focus.id],
          );
          const result = response[0] ? RuntimeActivityRecordSchema.parse(json(response[0])) : null;
          if (
            result &&
            (result.message_type === 'task_result' || result.message_type === 'response') &&
            canonicalStoredAgent(result.target_agent_key) === agent &&
            result.correlation_id
          ) {
            const requests = await tx.query(
              `SELECT id,payload FROM runtime_activities WHERE org_id=$1
              AND conversation_id=$2 AND run_id=$3 AND kind='message' AND step_key=$4`,
              [org, conversation, result.run_id, `${result.correlation_id}:request`],
            );
            const request = requests[0]
              ? RuntimeActivityRecordSchema.parse(json(requests[0]))
              : null;
            if (
              request &&
              canonicalStoredAgent(request.agent_key) === agent &&
              canonicalStoredAgent(request.target_agent_key) ===
                canonicalStoredAgent(result.agent_key)
            )
              found = await tx.query(
                `${candidates} SELECT * FROM candidates WHERE source='activity' AND id=$4 LIMIT 1`,
                [org, conversation, agent, request.activity_id],
              );
          }
        }
        if (!found[0]) fail('AGENT_ITEM_NOT_FOUND', 404);
        focusAnchor = found[0] as Anchor;
        const half = Math.floor((limit - 1) / 2);
        const before = await this.queryAnchors(tx, scope, tuple(focusAnchor), 'older', half);
        const after = await this.queryAnchors(
          tx,
          scope,
          tuple(focusAnchor),
          'newer',
          limit - half - 1,
        );
        anchors = [...before.reverse(), focusAnchor, ...after];
      } else {
        const direction = cursor?.direction ?? 'older';
        const page = await this.queryAnchors(tx, scope, cursor, direction, limit);
        anchors = direction === 'older' ? page.reverse() : page;
      }
      const items = await this.hydrate(tx, scope, anchors);
      return {
        conversation_id: conversation,
        agent_key: agent,
        items,
        older_cursor: anchors[0] ? encodeAgentCursor(scope, 'older', tuple(anchors[0])) : null,
        newer_cursor: anchors.at(-1)
          ? encodeAgentCursor(scope, 'newer', tuple(anchors.at(-1)!))
          : null,
        focus_item: focusAnchor ? agentItemId(focusAnchor.source, focusAnchor.id) : null,
        revision: digest(anchors),
      };
    });
  }

  private async queryAnchors(
    tx: Driver,
    scope: Scope,
    cursor: AgentCursorTuple | null,
    direction: 'older' | 'newer',
    limit: number,
  ): Promise<Anchor[]> {
    if (limit === 0) return [];
    const operator = direction === 'older' ? '<' : '>';
    const order = direction === 'older' ? 'DESC' : 'ASC';
    const rows = await tx.query(
      `WITH message_candidates AS (
        ${messageCandidates}
        AND ($4::timestamptz IS NULL OR (m.created_at,0,m.id) ${operator} ($4::timestamptz,$5::int,$6::text))
        ORDER BY m.created_at ${order},m.id ${order} LIMIT $7
      ), activity_candidates AS (
        ${activityCandidates}
        AND ($4::timestamptz IS NULL OR (a.created_at,1,a.id) ${operator} ($4::timestamptz,$5::int,$6::text))
        ORDER BY a.created_at ${order},a.id ${order} LIMIT $7
      )
      SELECT * FROM (SELECT * FROM message_candidates UNION ALL SELECT * FROM activity_candidates) candidates
      ORDER BY sort_at ${order},rank ${order},id ${order} LIMIT $7`,
      [
        scope.org,
        scope.conversation,
        scope.agent,
        cursor?.timestamp ?? null,
        cursor?.rank ?? 0,
        cursor?.id ?? '',
        limit,
      ],
    );
    return rows as Anchor[];
  }

  private async hydrate(tx: Driver, scope: Scope, anchors: Anchor[]): Promise<AgentFeedItem[]> {
    const messageIds = anchors.filter((a) => a.source === 'message').map((a) => a.id);
    const activityIds = anchors.filter((a) => a.source === 'activity').map((a) => a.id);
    const messages = messageIds.length
      ? await tx.query(
          `SELECT m.*,j.id AS job_id,root.id AS root_id,paired.sender_agent AS paired_sender
      FROM messages m LEFT JOIN agent_turn_jobs j ON j.org_id=m.org_id AND j.conversation_id=m.conversation_id
        AND (j.user_message_id=m.id OR j.assistant_message_id=m.id)
      LEFT JOIN agent_invocations root ON root.org_id=j.org_id AND root.job_id=j.id AND root.parent_id IS NULL
      LEFT JOIN messages paired ON m.role='user' AND m.client_turn_id IS NOT NULL
        AND paired.org_id=m.org_id AND paired.conversation_id=m.conversation_id
        AND paired.client_turn_id=m.client_turn_id AND paired.role='assistant'
      WHERE m.org_id=$1 AND m.conversation_id=$2 AND m.id=ANY($3::text[])`,
          [scope.org, scope.conversation, messageIds],
        )
      : [];
    const byMessage = new Map(messages.map((row) => [String(row.id), row]));
    const activityRows = activityIds.length
      ? await tx.query(
          `SELECT payload FROM runtime_activities
      WHERE org_id=$1 AND conversation_id=$2 AND id=ANY($3::text[])`,
          [scope.org, scope.conversation, activityIds],
        )
      : [];
    const direct = activityRows.map((row) => RuntimeActivityRecordSchema.parse(json(row)));
    const correlations = [
      ...new Set(
        direct.map((record) => record.correlation_id).filter((v): v is string => Boolean(v)),
      ),
    ];
    const runIds = [...new Set(direct.map((record) => record.run_id))];
    const companions = correlations.length
      ? (
          await tx.query(
            `WITH RECURSIVE ancestors AS (
        SELECT a.* FROM runtime_activities a
        WHERE a.org_id=$1 AND a.run_id=ANY($2::text[]) AND a.kind='invocation' AND a.step_key=ANY($3::text[])
        UNION ALL
        SELECT p.* FROM runtime_activities p JOIN ancestors child
          ON p.org_id=child.org_id AND p.run_id=child.run_id AND p.kind='invocation'
          AND p.step_key=child.payload->>'parent_step_key'
      )
      SELECT payload FROM runtime_activities WHERE org_id=$1 AND run_id=ANY($2::text[])
        AND (payload->>'correlation_id'=ANY($3::text[]) OR step_key=ANY($4::text[]))
      UNION SELECT payload FROM ancestors`,
            [scope.org, runIds, correlations, correlations.map((c) => `${c}:delegate`)],
          )
        ).map((row) => RuntimeActivityRecordSchema.parse(json(row)))
      : [];
    const all = new Map([...direct, ...companions].map((record) => [record.activity_id, record]));
    const byCorrelation = new Map<string, RuntimeActivityRecord[]>();
    const invocationByStep = new Map<string, RuntimeActivityRecord>();
    for (const record of all.values()) {
      if (record.kind === 'invocation') invocationByStep.set(key(record), record);
      if (record.correlation_id) {
        const id = `${record.run_id}:${record.correlation_id}`;
        byCorrelation.set(id, [...(byCorrelation.get(id) ?? []), record]);
      }
    }
    const runStates = runIds.length
      ? await tx.query('SELECT id,status FROM runs WHERE org_id=$1 AND id=ANY($2::text[])', [
          scope.org,
          runIds,
        ])
      : [];
    const runStatus = new Map(runStates.map((row) => [String(row.id), String(row.status)]));
    return anchors.flatMap((anchor): AgentFeedItem[] => {
      if (anchor.source === 'message') {
        const row = byMessage.get(anchor.id);
        if (!row) return [];
        const message = normalizeMessage(row);
        const placement = acceptedRecipient(json(row), message.sender_agent ?? row.paired_sender);
        const execution: ExecutionRef | null =
          row.job_id && row.root_id
            ? { source: 'job', job_id: String(row.job_id), invocation_id: String(row.root_id) }
            : null;
        return [
          {
            kind: 'message',
            item_id: agentItemId('message', anchor.id),
            created_at: message.created_at,
            run_id: message.run_id,
            message,
            recipient_agent: scope.agent,
            placement: placement.placement,
            execution,
          },
        ];
      }
      const activity = all.get(anchor.id);
      if (!activity) return [];
      const pair = activity.correlation_id
        ? (byCorrelation.get(`${activity.run_id}:${activity.correlation_id}`) ?? [])
        : [];
      const request =
        pair.find(
          (r) =>
            r.kind === 'message' &&
            r.message_type !== 'task_result' &&
            r.message_type !== 'response',
        ) ??
        (activity.message_type !== 'task_result' && activity.message_type !== 'response'
          ? activity
          : null);
      if (!request) return [];
      const response =
        pair.find(
          (r) =>
            r.kind === 'message' &&
            (r.message_type === 'task_result' || r.message_type === 'response'),
        ) ?? null;
      const child = activity.correlation_id
        ? (invocationByStep.get(`${activity.run_id}:${activity.correlation_id}`) ?? null)
        : null;
      const parent = child?.parent_step_key
        ? (invocationByStep.get(`${activity.run_id}:${child.parent_step_key}`) ?? null)
        : null;
      let root = child;
      for (let depth = 0; root?.parent_step_key && depth < 16; depth++)
        root = invocationByStep.get(`${activity.run_id}:${root.parent_step_key}`) ?? null;
      const caller = canonicalStoredAgent(request.agent_key);
      const callee = canonicalStoredAgent(request.target_agent_key);
      if (!caller || !callee) return [];
      const linkage =
        child &&
        child.parent_step_key === request.parent_step_key &&
        canonicalStoredAgent(child.agent_key) === callee &&
        canonicalStoredAgent(parent?.agent_key) === caller
          ? 'exact'
          : 'historical_partial';
      const runState = runStatus.get(activity.run_id);
      const terminal = ['succeeded', 'failed', 'cancelled'].includes(runState ?? '');
      const unfinished = !child || ['queued', 'running', 'waiting'].includes(child.status);
      const status =
        terminal && unfinished
          ? runState === 'cancelled'
            ? 'cancelled'
            : 'unknown'
          : (child?.status ?? 'queued');
      const delegation: DelegationView = {
        request_activity_id: request.activity_id,
        response_activity_id: response?.activity_id ?? null,
        run_id: activity.run_id,
        child: ref(child),
        parent: ref(parent),
        root: ref(root),
        caller_agent: caller,
        callee_agent: callee,
        request_summary: request.summary,
        result_summary: response?.summary ?? null,
        status,
        error_code: child?.error_code ?? null,
        duration_ms: child?.duration_ms ?? null,
        artifact_refs: response?.artifact_refs ?? [],
        evidence_refs: response?.evidence_refs ?? [],
        delegate_tool_activity_id: activity.correlation_id
          ? ([...all.values()].find(
              (r) =>
                r.run_id === activity.run_id &&
                r.kind === 'tool' &&
                r.step_key === `${activity.correlation_id}:delegate`,
            )?.activity_id ?? null)
          : null,
        initiating_message_id: null,
        linkage,
      };
      const kind =
        activity.activity_id === request.activity_id
          ? scope.agent === caller
            ? 'delegation'
            : 'inbound_request'
          : 'delegated_result';
      return [
        {
          kind,
          item_id: agentItemId('activity', anchor.id),
          created_at: anchor.timestamp,
          run_id: activity.run_id,
          delegation,
        },
      ];
    });
  }
}
