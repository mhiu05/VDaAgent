import { createHash, randomUUID } from 'node:crypto';
import {
  AnalysisRequestSchema,
  type AnalysisRequest,
  type AnalysisRun,
  type Conversation,
  type WorkflowVersion,
} from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { insertBatches } from '../internal/insert-batches';
import { LEGACY_WORKFLOW_VERSION, normalizeRun } from '../mapping/run';
import type { QueryResult, TurnContext } from '../types';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const titleFrom = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 80) || 'New analysis';

export interface BuildRunDependencies {
  workflowVersion: WorkflowVersion;
  createConversation: (
    tx: Driver,
    user: string,
    org: string,
    kind: Conversation['kind'],
    title: string,
  ) => Promise<Conversation>;
  selectLatest: (tx: Driver, request: AnalysisRequest) => Promise<QueryResult>;
  attachRunMessages: (tx: Driver, run: AnalysisRun, context: TurnContext) => Promise<void>;
  createRunMessages: (tx: Driver, run: AnalysisRun) => Promise<void>;
}

export async function buildRun(
  tx: Driver,
  user: string,
  input: AnalysisRequest,
  key: string,
  helpers: BuildRunDependencies,
  options: {
    entrypoint?: 'interactive' | 'scheduled';
    occurrence_id?: string;
    turn?: TurnContext;
  } = {},
): Promise<AnalysisRun> {
  const request = AnalysisRequestSchema.parse(input);
  await authorizeInTransaction(tx, user, request.org_id, true);
  await tx.query('SELECT org_id FROM organizations WHERE org_id=$1 FOR UPDATE', [request.org_id]);
  if (!key || key.length > 200) fail('INVALID_IDEMPOTENCY_KEY');
  const requestHash = hash(JSON.stringify(request));
  const prior = await tx.query(
    'SELECT payload FROM runs WHERE org_id=$1 AND created_by=$2 AND idempotency_key=$3',
    [request.org_id, user, key],
  );
  if (prior[0]) {
    const run = normalizeRun(prior[0]);
    if (run.request_hash !== requestHash) fail('IDEMPOTENCY_CONFLICT', 409);
    return run;
  }
  const scopeRows = await tx.query(
    'SELECT id FROM snapshots WHERE org_id=$1 AND project_external_id=$2 AND (CAST($3 AS text) IS NULL OR zone_external_id=$4) LIMIT 1',
    [
      request.org_id,
      request.scope.project_external_id,
      request.scope.zone_external_id,
      request.scope.zone_external_id,
    ],
  );
  if (!scopeRows.length) fail('SCOPE_NOT_FOUND', 404);
  if (request.conversation_id) {
    if (
      !(
        await tx.query('SELECT id FROM conversations WHERE org_id=$1 AND id=$2', [
          request.org_id,
          request.conversation_id,
        ])
      ).length
    )
      fail('CONVERSATION_NOT_FOUND', 404);
  } else {
    const conversation = await helpers.createConversation(
      tx,
      user,
      request.org_id,
      options.entrypoint === 'scheduled' ? 'scheduled' : 'interactive',
      titleFrom(request.question),
    );
    request.conversation_id = conversation.conversation_id;
  }
  const metricConfig = await tx.query(
    'SELECT slow_moving_threshold_days FROM organizations WHERE org_id=$1',
    [request.org_id],
  );
  const date = now();
  const run: AnalysisRun = {
    run_id: randomUUID(),
    org_id: request.org_id,
    created_by: user,
    request,
    status: 'queued',
    created_at: date,
    updated_at: date,
    idempotency_key: key,
    request_hash: requestHash,
    entrypoint: options.entrypoint ?? 'interactive',
    occurrence_id: options.occurrence_id ?? null,
    attempt: 0,
    fencing_token: 0,
    lease_until: null,
    error_code: null,
    report_artifact_id: null,
    cancel_requested: false,
    workflow_version: helpers.workflowVersion ?? LEGACY_WORKFLOW_VERSION,
  };
  await tx.query(
    'INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,fencing_token,created_at,payload,slow_moving_threshold_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      run.org_id,
      run.run_id,
      user,
      key,
      requestHash,
      run.status,
      0,
      date,
      JSON.stringify(run),
      metricConfig[0].slow_moving_threshold_days,
    ],
  );
  // Snapshot membership is frozen at enqueue so retries cannot observe later imports.
  const selected = await helpers.selectLatest(tx, request);
  await insertBatches(
    tx,
    'INSERT INTO run_snapshots(org_id,run_id,snapshot_id)',
    selected.rows.map((row) => [run.org_id, run.run_id, row.snapshot_id]),
  );
  if (options.turn) await helpers.attachRunMessages(tx, run, options.turn);
  else await helpers.createRunMessages(tx, run);
  return run;
}
