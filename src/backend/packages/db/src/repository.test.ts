import { afterEach, describe, expect, it } from 'vitest';
import { TEST_ORGS, TEST_USERS, type Lease, type Repository } from './index.js';
import { artifactHash, parseInventoryCsv } from '@vda/domain';
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactSchema,
  CSV_COLUMNS,
  SEMANTIC_VERSION,
  type AnalysisRequest,
  type AnalysisRun,
  type Artifact,
  type ArtifactValidation,
} from '@vda/contracts';
import { createTestRepository } from '../../../tests/helpers/postgres.js';
const resources: { repo: Repository; close: () => Promise<void> }[] = [];
async function setup(options: { workflowVersion?: 'legacy-v1' | 'agent-v1' } = {}) {
  const { pg, repo, uploads } = await createTestRepository(options);
  resources.push({ repo, close: () => pg.close() });
  return { pg, repo, uploads };
}
afterEach(async () => {
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

function analysisRequestArtifact(run: AnalysisRun, artifactId: string, taskId: string): Artifact {
  const body = {
    artifact_id: artifactId,
    org_id: run.org_id,
    run_id: run.run_id,
    task_id: taskId,
    kind: 'analysis_request' as const,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    created_at: run.created_at,
    semantic_version: SEMANTIC_VERSION,
    provisional: true as const,
    data_as_of: run.request.data_as_of,
    input_refs: [],
    snapshot_refs: [],
    source_refs: [],
    limitations: [],
    payload: run.request,
  };
  return ArtifactSchema.parse({
    ...body,
    content_hash: artifactHash(body as Omit<Artifact, 'content_hash'>),
  });
}

function artifactValidation(artifact: Artifact, valid: boolean): ArtifactValidation {
  return {
    artifact_id: artifact.artifact_id,
    org_id: artifact.org_id,
    run_id: artifact.run_id,
    validated_at: artifact.created_at,
    validator_version: 'mvp-validator-v1',
    valid,
    checks: ['test'],
  };
}

async function prepareArtifactTask(repo: Repository, lease: Lease) {
  const taskId = '60000000-0000-4000-8000-000000000010';
  await repo.setTask(lease, {
    task_id: taskId,
    run_id: lease.run.run_id,
    org_id: lease.run.org_id,
    kind: 'orchestrator',
    dependencies: [],
    status: 'succeeded',
    attempt: lease.run.attempt,
    error_code: null,
  });
  return taskId;
}

function payloadOf(value: unknown) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
describe('durable tenant repository', () => {
  it('denies viewer writes and foreign tenant reads', async () => {
    const { repo } = await setup();
    await expect(repo.createRun(TEST_USERS.viewer, request, 'one')).rejects.toThrow(
      'VIEWER_READ_ONLY',
    );
    await expect(repo.catalog(TEST_USERS.owner, TEST_ORGS.beta)).rejects.toThrow(
      'WORKSPACE_FORBIDDEN',
    );
  });
  it('deduplicates actor keys but rejects changed request', async () => {
    const { repo } = await setup();
    const a = await repo.createRun(TEST_USERS.owner, request, 'one');
    const b = await repo.createRun(TEST_USERS.owner, request, 'one');
    expect(a.run_id).toBe(b.run_id);
    await expect(
      repo.createRun(TEST_USERS.owner, { ...request, question: 'other' }, 'one'),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('pins the server-selected workflow version for interactive and scheduled runs', async () => {
    const { pg, repo } = await setup({ workflowVersion: 'agent-v1' });
    const interactive = await repo.createRun(TEST_USERS.owner, request, 'agent-workflow-version');
    expect(interactive.workflow_version).toBe('agent-v1');
    expect(
      (await repo.getRun(TEST_USERS.owner, interactive.org_id, interactive.run_id)).run,
    ).toMatchObject({
      workflow_version: 'agent-v1',
    });
    expect(await repo.createRun(TEST_USERS.owner, request, 'agent-workflow-version')).toMatchObject(
      {
        run_id: interactive.run_id,
        workflow_version: 'agent-v1',
      },
    );

    const definition = await repo.createDefinition(
      TEST_USERS.owner,
      {
        org_id: request.org_id,
        name: 'Agent daily',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '09:00',
        data_as_of_policy: 'scheduled_date',
        enabled: true,
      },
      new Date('2026-09-18T00:00:00Z'),
    );
    const occurrence = await repo.triggerDefinition(
      TEST_USERS.owner,
      request.org_id,
      definition.report_definition_id,
      new Date('2026-09-19T02:00:00Z'),
    );
    expect(
      (await repo.getRun(TEST_USERS.owner, request.org_id, occurrence.run_id)).run,
    ).toMatchObject({
      entrypoint: 'scheduled',
      workflow_version: 'agent-v1',
    });

    const stored = await pg.query('SELECT payload FROM runs WHERE org_id=$1 AND id=$2', [
      interactive.org_id,
      interactive.run_id,
    ]);
    const storedRows = stored.rows as Array<{ payload: unknown }>;
    const historical = payloadOf(storedRows[0]?.payload) as Record<string, unknown>;
    delete historical.workflow_version;
    await pg.query('UPDATE runs SET payload=$1 WHERE org_id=$2 AND id=$3', [
      JSON.stringify(historical),
      interactive.org_id,
      interactive.run_id,
    ]);
    expect(
      (await repo.getRun(TEST_USERS.owner, interactive.org_id, interactive.run_id)).run,
    ).toMatchObject({
      workflow_version: 'legacy-v1',
    });
  });
  it('persists, pages, attaches and terminally finalizes an interactive turn', async () => {
    const { pg, repo } = await setup();
    const turnInput = {
      org_id: TEST_ORGS.alpha,
      client_turn_id: '60000000-0000-4000-8000-000000000001',
      text: 'Show current available inventory',
      scope: request.scope,
      data_as_of: request.data_as_of,
    };
    const turn = await repo.startTurn(TEST_USERS.owner, turnInput, 'turn-one');
    expect(turn.conversation).toMatchObject({ kind: 'interactive', title: turnInput.text });
    expect(turn.user_message).toMatchObject({ status: 'submitted', run_id: null });
    expect(turn.assistant_message).toMatchObject({ status: 'in_progress', run_id: null });
    const inserted = await pg.query(
      'SELECT id,sender_agent,payload FROM messages WHERE org_id=$1 AND conversation_id=$2 ORDER BY created_at,id',
      [TEST_ORGS.alpha, turn.conversation.conversation_id],
    );
    const insertedRows = inserted.rows as { sender_agent: unknown; payload: unknown }[];
    expect(insertedRows).toHaveLength(2);
    for (const message of insertedRows) {
      expect(message.sender_agent).toBeNull();
      expect(payloadOf(message.payload)).not.toHaveProperty('sender_agent');
    }
    await pg.query('UPDATE messages SET sender_agent=$1 WHERE org_id=$2 AND id=$3', [
      'coordinator',
      TEST_ORGS.alpha,
      turn.assistant_message.message_id,
    ]);
    expect(
      (
        await repo.listMessages(
          TEST_USERS.owner,
          TEST_ORGS.alpha,
          turn.conversation.conversation_id,
          {
            limit: 30,
            cursor: null,
          },
        )
      ).messages.find((message) => message.message_id === turn.assistant_message.message_id),
    ).toMatchObject({ sender_agent: 'coordinator' });
    await expect(
      repo.startTurn(TEST_USERS.owner, { ...turnInput, text: 'Changed request' }, 'turn-one'),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const repeated = await repo.startTurn(TEST_USERS.owner, turnInput, 'turn-one');
    expect(repeated.assistant_message.message_id).toBe(turn.assistant_message.message_id);
    const run = await repo.attachRunToTurn(
      TEST_USERS.owner,
      {
        org_id: turnInput.org_id,
        conversation_id: turn.conversation.conversation_id,
        user_message_id: turn.user_message.message_id,
        assistant_message_id: turn.assistant_message.message_id,
        client_turn_id: turnInput.client_turn_id,
      },
      { ...request, conversation_id: turn.conversation.conversation_id },
      'run-for-turn',
    );
    const attachedReplay = await repo.startTurn(TEST_USERS.owner, turnInput, 'turn-one');
    expect(attachedReplay).toMatchObject({
      idempotent_replay: true,
      assistant_message: { run_id: run.run_id, status: 'in_progress' },
    });
    const page = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
      {
        limit: 30,
        cursor: null,
      },
    );
    expect(page.messages).toHaveLength(2);
    expect(page.messages.map((message) => message.run_id)).toEqual([run.run_id, run.run_id]);
    expect(page.messages.at(-1)).toMatchObject({ sender_agent: 'coordinator' });
    const updated = await pg.query(
      'SELECT sender_agent,payload FROM messages WHERE org_id=$1 AND id=$2',
      [TEST_ORGS.alpha, turn.assistant_message.message_id],
    );
    const updatedRow = updated.rows[0] as { sender_agent: unknown; payload: unknown } | undefined;
    expect(updatedRow?.sender_agent).toBe('coordinator');
    expect(payloadOf(updatedRow?.payload)).not.toHaveProperty('sender_agent');
    await repo.cancelRun(TEST_USERS.owner, TEST_ORGS.alpha, run.run_id);
    const terminal = await repo.listMessages(
      TEST_USERS.owner,
      TEST_ORGS.alpha,
      turn.conversation.conversation_id,
      { limit: 30, cursor: null },
    );
    expect(terminal.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'cancelled',
      parts: expect.arrayContaining([
        expect.objectContaining({ type: 'run_ref', status: 'cancelled' }),
      ]),
    });
    expect(
      (await repo.listConversations(TEST_USERS.owner, TEST_ORGS.alpha, { limit: 30, cursor: null }))
        .conversations,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversation_id: turn.conversation.conversation_id }),
      ]),
    );
    await expect(
      repo.getConversation(TEST_USERS.beta, TEST_ORGS.alpha, turn.conversation.conversation_id),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');
    await expect(repo.startTurn(TEST_USERS.viewer, turnInput, 'viewer-turn')).rejects.toThrow(
      'VIEWER_READ_ONLY',
    );
  });
  it('keys artifact revisions in relational storage without changing immutable payloads', async () => {
    const { pg, repo } = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'artifact-keys');
    const lease = await repo.claimRun('artifact-key-worker');
    expect(lease?.run.run_id).toBe(run.run_id);
    const taskId = await prepareArtifactTask(repo, lease!);
    const legacy = analysisRequestArtifact(run, '60000000-0000-4000-8000-000000000011', taskId);
    const revision = analysisRequestArtifact(run, '60000000-0000-4000-8000-000000000012', taskId);
    await expect(repo.storeArtifact(lease!, legacy)).resolves.toEqual(legacy);
    await expect(repo.storeArtifact(lease!, legacy)).resolves.toEqual(legacy);
    await expect(
      repo.storeArtifact(lease!, revision, { artifact_key: 'analysis_request:2' }),
    ).resolves.toEqual(revision);
    const rows = await pg.query(
      'SELECT artifact_key,payload FROM artifacts WHERE org_id=$1 AND run_id=$2 ORDER BY artifact_key',
      [run.org_id, run.run_id],
    );
    const artifactRows = rows.rows as { artifact_key: unknown; payload: unknown }[];
    expect(artifactRows.map((row) => row.artifact_key)).toEqual([
      'analysis_request',
      'analysis_request:2',
    ]);
    expect(payloadOf(artifactRows[0]?.payload)).not.toHaveProperty('artifact_key');
    await expect(
      repo.artifactByKey(TEST_USERS.owner, run.org_id, run.run_id, 'analysis_request'),
    ).resolves.toEqual(legacy);
    await expect(
      repo.artifactByKey(TEST_USERS.owner, run.org_id, run.run_id, 'analysis_request:2'),
    ).resolves.toEqual(revision);
    await expect(
      repo.artifactByKey(TEST_USERS.beta, run.org_id, run.run_id, 'analysis_request'),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');
    const conflicting = analysisRequestArtifact(
      run,
      '60000000-0000-4000-8000-000000000013',
      taskId,
    );
    await expect(
      repo.storeArtifact(lease!, conflicting, { artifact_key: 'analysis_request:2' }),
    ).rejects.toThrow('IMMUTABLE_ARTIFACT_CONFLICT');
  });
  it('reads only a valid, public artifact from its authorized run', async () => {
    const { repo } = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'public-artifact');
    const lease = await repo.claimRun('public-artifact-worker');
    expect(lease?.run.run_id).toBe(run.run_id);
    const taskId = await prepareArtifactTask(repo, lease!);
    const artifact = analysisRequestArtifact(
      run,
      '60000000-0000-4000-8000-000000000014',
      taskId,
    );
    await repo.storeArtifact(lease!, artifact);

    await expect(
      repo.publicArtifactById(TEST_USERS.owner, run.org_id, run.run_id, artifact.artifact_id),
    ).rejects.toThrow('PUBLIC_ARTIFACT_VALIDATION_REQUIRED');
    await expect(
      repo.publicArtifactsByIds(TEST_USERS.owner, run.org_id, run.run_id, [artifact.artifact_id]),
    ).resolves.toEqual([]);
    await repo.validateArtifact(lease!, artifactValidation(artifact, false));
    await expect(
      repo.publicArtifactById(TEST_USERS.owner, run.org_id, run.run_id, artifact.artifact_id),
    ).rejects.toThrow('PUBLIC_ARTIFACT_VALIDATION_REQUIRED');
    await repo.validateArtifact(lease!, artifactValidation(artifact, true));
    await expect(
      repo.publicArtifactById(TEST_USERS.owner, run.org_id, run.run_id, artifact.artifact_id),
    ).resolves.toEqual(artifact);
    await expect(
      repo.publicArtifactsByIds(TEST_USERS.owner, run.org_id, run.run_id, [
        artifact.artifact_id,
        artifact.artifact_id,
        '60000000-0000-4000-8000-000000000099',
      ]),
    ).resolves.toEqual([artifact]);
    await expect(
      repo.publicArtifactById(TEST_USERS.beta, run.org_id, run.run_id, artifact.artifact_id),
    ).rejects.toThrow('WORKSPACE_FORBIDDEN');

    const otherRun = await repo.createRun(TEST_USERS.owner, request, 'other-public-artifact-run');
    await expect(
      repo.publicArtifactById(
        TEST_USERS.owner,
        otherRun.org_id,
        otherRun.run_id,
        artifact.artifact_id,
      ),
    ).rejects.toThrow('ARTIFACT_NOT_FOUND');
    await expect(
      repo.publicArtifactsByIds(TEST_USERS.owner, otherRun.org_id, otherRun.run_id, [
        artifact.artifact_id,
      ]),
    ).resolves.toEqual([]);
  });
  it('claims exclusively across connections, rejects stale and cancelled leases', async () => {
    const { repo } = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'one');
    const first = await repo.claimRun('first', new Date(Date.now() - 60000), 1000);
    expect(first).not.toBeNull();
    const second = await repo.claimRun('second');
    expect(second?.run.run_id).toBe(run.run_id);
    await expect(repo.assertLease(first!)).rejects.toThrow('LEASE_LOST');
    await expect(repo.readSnapshots(first!)).rejects.toThrow('LEASE_LOST');
    await expect(repo.addEvent(first!, 'stale')).rejects.toThrow('LEASE_LOST');
    await expect(repo.completeRun(first!, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      'LEASE_LOST',
    );
    expect(await repo.claimRun('third')).toBeNull();
    await repo.cancelRun(TEST_USERS.owner, run.org_id, run.run_id);
    await expect(repo.assertLease(second!)).rejects.toThrow('LEASE_LOST');
  });
  it('pins rows and metric settings across retry and import', async () => {
    const { repo } = await setup();
    const run = await repo.createRun(TEST_USERS.owner, request, 'one');
    const first = await repo.claimRun('first');
    const initial = await repo.readSnapshots(first!);
    expect(initial.rows).toHaveLength(12);
    await repo.failRun(first!, 'TEST');
    await repo.retryRun(TEST_USERS.owner, run.org_id, run.run_id);
    const second = await repo.claimRun('second');
    expect((await repo.readSnapshots(second!)).rows).toEqual(initial.rows);
    expect(await repo.getMetricConfig(second!)).toEqual({ slow_moving_threshold_days: 90 });
    expect(second?.fencing_token).toBeGreaterThan(first!.fencing_token);
  });
  it('validates whole CSV and never commits a partial batch', async () => {
    const { repo, uploads } = await setup();
    const header = CSV_COLUMNS.join(',');
    const valid =
      '2026-09-20,VN,Việt Nam (synthetic),P-ALPHA,Riverside (synthetic),Z-NORTH,North,U-13,RS-013,apartment,80,100,VND,available,2026-09-01,';
    const bad = valid.replace('U-13', 'U-14').replace(',100,VND', ',-10,VND');
    await expect(
      repo.importCsv(TEST_USERS.owner, {
        org_id: TEST_ORGS.alpha,
        source_name: 'test',
        csv: `${header}\n${valid}\n${bad}`,
      }),
    ).rejects.toThrow('CSV_ROW_3');
    expect(await repo.listImports(TEST_USERS.owner, TEST_ORGS.alpha)).toHaveLength(1);
    const csv = `${header}\n${valid}`;
    const a = await repo.importCsv(TEST_USERS.owner, {
      org_id: TEST_ORGS.alpha,
      source_name: 'test',
      csv,
    });
    expect(uploads).toContainEqual(
      expect.objectContaining({
        bucket: 'source-imports',
        path: expect.stringContaining('/source.csv'),
      }),
    );
    expect(
      (
        await repo.importCsv(TEST_USERS.owner, {
          org_id: TEST_ORGS.alpha,
          source_name: 'test',
          csv,
        })
      ).import_id,
    ).toBe(a.import_id);
    expect(() => parseInventoryCsv(`${csv}\n${valid}`)).toThrow('DUPLICATE_SNAPSHOT');
  });
  it('pins definition versions and deduplicates simultaneous ticks', async () => {
    const { repo } = await setup();
    const def = await repo.createDefinition(
      TEST_USERS.owner,
      {
        org_id: TEST_ORGS.alpha,
        name: 'Daily',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '09:00',
        data_as_of_policy: 'scheduled_date',
        enabled: true,
      },
      new Date('2026-09-18T00:00:00Z'),
    );
    const due = new Date('2026-09-18T03:00:00Z');
    const a = await repo.tick(due);
    expect(a).toHaveLength(1);
    expect(a[0].definition_version).toBe(1);
    expect(await repo.tick(due)).toHaveLength(0);
    const edited = await repo.updateDefinition(
      TEST_USERS.owner,
      def.org_id,
      def.report_definition_id,
      {
        org_id: def.org_id,
        name: 'Changed',
        scope: request.scope,
        timezone: 'Asia/Bangkok',
        local_time: '10:00',
        data_as_of_policy: 'previous_day',
        enabled: true,
      },
      due,
    );
    expect(edited.definition_version).toBe(2);
    expect(a[0].definition_snapshot.name).toBe('Daily');
  });
});
