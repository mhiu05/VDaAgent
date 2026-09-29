import { randomUUID } from 'node:crypto';
import {
  AgentKeySchema,
  ArtifactSchema,
  ArtifactValidationSchema,
  MessageSchema,
  type AgentKey,
  type AnalysisRun,
  type Artifact,
  type ArtifactValidation,
  type Message,
  type MessagePart,
  type MessageStatus,
  type RunEvent,
  type RunTask,
} from '@vda/contracts';
import { stableId, verifyArtifact } from '@vda/domain';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { insertBatches } from '../internal/insert-batches';
import { normalizeMessage } from '../mapping/conversation';
import { json } from '../mapping/rows';
import { ConversationRepository } from '../repositories/conversation-repository';
import {
  logicalArtifactKey,
  type AgentStageMessageInput,
  type ArtifactStoreOptions,
  type Lease,
} from '../types';
import { fenceRun } from './lease-repository';
import { syncAgentInvocationsFromRun } from './agent-projection';

const now = () => new Date().toISOString();
// Preserve the existing persisted completion text exactly for legacy chat clients.
const LEGACY_COMPLETION_TEXT = String.fromCharCode(
  80,
  104,
  195,
  162,
  110,
  32,
  116,
  195,
  173,
  99,
  104,
  32,
  196,
  8216,
  195,
  163,
  32,
  104,
  111,
  195,
  160,
  110,
  32,
  116,
  104,
  195,
  160,
  110,
  104,
  46,
  32,
  77,
  225,
  187,
  376,
  32,
  68,
  101,
  99,
  105,
  115,
  105,
  111,
  110,
  32,
  66,
  114,
  105,
  101,
  102,
  105,
  110,
  103,
  32,
  196,
  8216,
  225,
  187,
  402,
  32,
  120,
  101,
  109,
  32,
  99,
  195,
  161,
  99,
  32,
  116,
  195,
  173,
  110,
  32,
  104,
  105,
  225,
  187,
  8225,
  117,
  32,
  118,
  195,
  160,
  32,
  98,
  225,
  186,
  177,
  110,
  103,
  32,
  99,
  104,
  225,
  187,
  169,
  110,
  103,
  32,
  196,
  8216,
  195,
  163,
  32,
  120,
  195,
  161,
  99,
  32,
  116,
  104,
  225,
  187,
  177,
  99,
  46,
);

export async function storeArtifact(
  db: Driver,
  lease: Lease,
  input: Artifact,
  options: ArtifactStoreOptions = {},
): Promise<Artifact> {
  const artifact = ArtifactSchema.parse(input);
  verifyArtifact(artifact);
  let artifactKey: string;
  try {
    artifactKey = logicalArtifactKey(artifact, options);
  } catch {
    fail('INVALID_ARTIFACT_KEY');
  }
  return db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    if (artifact.org_id !== run.org_id || artifact.run_id !== run.run_id)
      fail('ARTIFACT_SCOPE_MISMATCH', 403);
    // `publishReviewedDraft` is deliberately the only report writer for an
    // opted-in run. Keeping this guard here prevents a future caller from
    // bypassing Reviewer PASS through the otherwise generic artifact API.
    if (run.workflow_version === 'agent-v1' && artifact.kind === 'report')
      fail('AGENT_PUBLICATION_REQUIRED', 409);
    const prior = await tx.query(
      'SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND artifact_key=$3',
      [run.org_id, run.run_id, artifactKey],
    );
    if (prior[0]) {
      const old = ArtifactSchema.parse(json(prior[0]));
      if (old.content_hash !== artifact.content_hash) fail('IMMUTABLE_ARTIFACT_CONFLICT', 409);
      return old;
    }
    await tx.query(
      'INSERT INTO artifacts(org_id,id,run_id,task_id,kind,artifact_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        artifact.org_id,
        artifact.artifact_id,
        artifact.run_id,
        artifact.task_id,
        artifact.kind,
        artifactKey,
        JSON.stringify(artifact),
      ],
    );
    await insertBatches(
      tx,
      'INSERT INTO artifact_inputs(org_id,run_id,artifact_id,input_id)',
      artifact.input_refs.map((id) => [run.org_id, run.run_id, artifact.artifact_id, id]),
    );
    await insertBatches(
      tx,
      'INSERT INTO artifact_snapshots(org_id,run_id,artifact_id,snapshot_id)',
      artifact.snapshot_refs.map((id) => [run.org_id, run.run_id, artifact.artifact_id, id]),
    );
    await insertBatches(
      tx,
      'INSERT INTO artifact_sources(org_id,artifact_id,import_id)',
      artifact.source_refs.map((id) => [run.org_id, artifact.artifact_id, id]),
    );
    return artifact;
  });
}

export async function validateArtifact(db: Driver, lease: Lease, validation: ArtifactValidation) {
  await db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    if (validation.org_id !== run.org_id || validation.run_id !== run.run_id)
      fail('VALIDATION_SCOPE_MISMATCH', 403);
    await tx.query(
      'INSERT INTO validations(org_id,id,run_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,id) DO UPDATE SET payload=excluded.payload',
      [run.org_id, validation.artifact_id, run.run_id, JSON.stringify(validation)],
    );
  });
}

export async function setTask(db: Driver, lease: Lease, task: RunTask) {
  await db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    if (task.org_id !== run.org_id || task.run_id !== run.run_id) fail('TASK_SCOPE_MISMATCH', 403);
    await tx.query(
      'INSERT INTO tasks(org_id,id,run_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,id) DO UPDATE SET payload=excluded.payload',
      [run.org_id, task.task_id, run.run_id, JSON.stringify(task)],
    );
    if (run.workflow_version === 'agent-v1') await syncAgentInvocationsFromRun(tx, run.org_id, run.run_id);
  });
}

export async function addEvent(db: Driver, lease: Lease, message: string, taskId?: string) {
  await db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    const event: RunEvent = {
      event_id: randomUUID(),
      run_id: run.run_id,
      org_id: run.org_id,
      created_at: now(),
      task_id: taskId ?? null,
      message,
    };
    await tx.query('INSERT INTO events(org_id,id,run_id,payload) VALUES($1,$2,$3,$4)', [
      run.org_id,
      event.event_id,
      run.run_id,
      JSON.stringify(event),
    ]);
  });
}

export async function findRunAssistant(tx: Driver, run: AnalysisRun): Promise<Message> {
  const rows = await tx.query(
    `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload
       FROM messages
       WHERE org_id=$1 AND run_id=$2 AND role='assistant' AND sender_agent IS NULL
       FOR UPDATE`,
    [run.org_id, run.run_id],
  );
  if (rows[0]) return normalizeMessage(rows[0]);
  if (!run.request.conversation_id) fail('RUN_CONVERSATION_REQUIRED', 409);
  const date = now();
  const assistant: Message = {
    message_id: randomUUID(),
    org_id: run.org_id,
    conversation_id: run.request.conversation_id,
    run_id: run.run_id,
    client_turn_id: null,
    role: 'assistant',
    status: 'in_progress',
    content: 'Đang chuẩn bị phân tích.',
    parts: [
      { type: 'text', text: 'Đang chuẩn bị phân tích.' },
      { type: 'run_ref', run_id: run.run_id, status: run.status },
    ],
    created_at: date,
    updated_at: date,
  };
  await new ConversationRepository(tx).insertMessage(tx, assistant);
  return assistant;
}

export async function upsertStageMessage(
  db: Driver,
  lease: Lease,
  input: AgentStageMessageInput,
): Promise<Message> {
  const senderAgent = AgentKeySchema.parse(input.sender_agent) as AgentKey;
  const content = input.content.trim();
  if (!content || content.length > 5_000) fail('INVALID_STAGE_MESSAGE', 422);
  return db.transaction(async (tx) => {
    const run = await fenceRun(tx, lease);
    if (!run.request.conversation_id) fail('RUN_CONVERSATION_REQUIRED', 409);
    const parts: MessagePart[] = [
      { type: 'text', text: content },
      { type: 'run_ref', run_id: run.run_id, status: run.status },
    ];
    if (input.artifact) {
      const rows = await tx.query(
        'SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND id=$3',
        [run.org_id, run.run_id, input.artifact.artifact_id],
      );
      if (!rows[0]) fail('STAGE_ARTIFACT_NOT_FOUND', 409);
      const artifact = ArtifactSchema.parse(json(rows[0]));
      verifyArtifact(artifact);
      if (
        artifact.content_hash !== input.artifact.content_hash ||
        artifact.kind !== input.artifact.kind ||
        artifact.kind === 'report_draft' ||
        artifact.kind === 'review_result'
      )
        fail('STAGE_ARTIFACT_REFERENCE_FORBIDDEN', 422);
      const validations = (
        await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2 AND id=$3', [
          run.org_id,
          run.run_id,
          artifact.artifact_id,
        ])
      ).flatMap((row) => {
        const parsed = ArtifactValidationSchema.safeParse(json(row));
        return parsed.success ? [parsed.data] : [];
      });
      if (!validations.some((validation) => validation.valid))
        fail('STAGE_ARTIFACT_VALIDATION_REQUIRED', 409);
      parts.push({
        type: 'artifact_ref',
        run_id: run.run_id,
        artifact_id: artifact.artifact_id,
        kind: artifact.kind,
      });
    }
    const messageId = stableId(`${run.run_id}:stage-message:${senderAgent}`);
    const existingRows = await tx.query(
      'SELECT org_id,id,conversation_id,run_id,client_turn_id,role,sender_agent,status,created_at,updated_at,payload FROM messages WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [run.org_id, messageId],
    );
    const date = now();
    const message = MessageSchema.parse({
      message_id: messageId,
      org_id: run.org_id,
      conversation_id: run.request.conversation_id,
      run_id: run.run_id,
      client_turn_id: null,
      role: 'assistant',
      sender_agent: senderAgent,
      status: 'completed',
      content,
      parts,
      created_at: existingRows[0] ? normalizeMessage(existingRows[0]).created_at : date,
      updated_at: date,
    });
    if (existingRows[0]) {
      const existing = normalizeMessage(existingRows[0]);
      if (
        existing.org_id !== run.org_id ||
        existing.run_id !== run.run_id ||
        existing.conversation_id !== run.request.conversation_id ||
        existing.client_turn_id !== null ||
        existing.role !== 'assistant' ||
        existing.sender_agent !== senderAgent
      )
        fail('STAGE_MESSAGE_ID_CONFLICT', 409);
      await new ConversationRepository(tx).updateMessage(tx, message);
    } else {
      await new ConversationRepository(tx).insertMessage(tx, message);
    }
    await new ConversationRepository(tx).touchConversation(
      tx,
      run.org_id,
      message.conversation_id,
      date,
    );
    return message;
  });
}

export async function finishRunAssistant(
  tx: Driver,
  run: AnalysisRun,
  result: {
    status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled' | 'in_progress'>;
    content: string;
    parts: MessagePart[];
  },
) {
  const assistant = await findRunAssistant(tx, run);
  // A durable Orchestrator owns the initiating reply. The canonical run still
  // publishes its artifacts and stage messages, then the job resumes to write
  // the grounded final response into this same placeholder.
  const hasDurableTable = await tx.query("SELECT to_regclass('public.agent_turn_jobs') AS table_name");
  if (hasDurableTable[0]?.table_name) {
    const durable = await tx.query(
      'SELECT id FROM agent_turn_jobs WHERE org_id=$1 AND assistant_message_id=$2 AND run_id=$3',
      [run.org_id,assistant.message_id,run.run_id],
    );
    if (durable[0]) return;
  }
  const useLegacyCompletedPayload =
    run.workflow_version === 'agent-v1' &&
    result.status === 'completed' &&
    run.report_artifact_id !== null;
  assistant.status = result.status;
  assistant.content = useLegacyCompletedPayload ? LEGACY_COMPLETION_TEXT : result.content;
  assistant.parts = useLegacyCompletedPayload
    ? result.parts.map((part, index) =>
        index === 0 && part.type === 'text' ? { ...part, text: LEGACY_COMPLETION_TEXT } : part,
      )
    : result.parts;
  assistant.updated_at = now();
  await new ConversationRepository(tx).updateMessage(tx, assistant);
  await new ConversationRepository(tx).touchConversation(
    tx,
    run.org_id,
    assistant.conversation_id,
    assistant.updated_at,
  );
}
