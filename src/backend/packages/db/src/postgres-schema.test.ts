import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { createLegacyTestDatabase } from '../../../tests/helpers/postgres.js';
describe('PostgreSQL schema and RLS (PGlite, without Supabase services)', () => {
  it('guards new run versions while preserving historical lifecycle updates', async () => {
    const db = await createLegacyTestDatabase();
    const org = '10000000-0000-4000-8000-000000000001';
    const actor = '20000000-0000-4000-8000-000000000001';
    const insert = (id: string, payload: Record<string, unknown>) =>
      db.query(
        `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,created_at,payload)
       VALUES($1,$2,$3,$4,'hash','queued',now(),$5)`,
        [org, id, actor, id, JSON.stringify(payload)],
      );
    try {
      await db.query('INSERT INTO organizations(org_id,name) VALUES($1,$2)', [org, 'Alpha']);
      const historicalId = '60000000-0000-4000-8000-000000000001';
      await insert(historicalId, { run_id: historicalId, status: 'queued' });
      await db.exec(
        await readFile(
          'src/backend/supabase/migrations/20260925082316_guard_run_workflow_version.sql',
          'utf8',
        ),
      );
      await db.query("UPDATE runs SET status='failed',payload=$1 WHERE id=$2", [
        JSON.stringify({ run_id: historicalId, status: 'failed' }),
        historicalId,
      ]);
      const old = (await db.query('SELECT payload FROM runs WHERE id=$1', [historicalId]))
        .rows[0] as { payload: Record<string, unknown> };
      expect(old.payload).toMatchObject({ run_id: historicalId, status: 'failed' });
      expect(old.payload).not.toHaveProperty('workflow_version');
      const versions = [undefined, null, 'legacy-v1', 'unknown-v1'];
      for (const [index, version] of versions.entries()) {
        const id = `60000000-0000-4000-8000-00000000000${index + 2}`;
        await expect(
          insert(id, {
            run_id: id,
            ...(version === undefined ? {} : { workflow_version: version }),
          }),
        ).rejects.toThrow('NEW_RUN_REQUIRES_AGENT_V1');
      }
      const agentId = '60000000-0000-4000-8000-000000000006';
      await insert(agentId, { run_id: agentId, workflow_version: 'agent-v1' });
      await expect(
        db.query('UPDATE runs SET payload=$1 WHERE id=$2', [
          JSON.stringify({ run_id: agentId, workflow_version: 'legacy-v1' }),
          agentId,
        ]),
      ).rejects.toThrow('RUN_WORKFLOW_VERSION_IMMUTABLE');
      await expect(
        db.query('UPDATE runs SET payload=$1 WHERE id=$2', [
          JSON.stringify({ run_id: historicalId, workflow_version: 'agent-v1' }),
          historicalId,
        ]),
      ).rejects.toThrow('RUN_WORKFLOW_VERSION_IMMUTABLE');
    } finally {
      await db.close();
    }
  });

  it('applies canonical DDL and enforces real Postgres tenant reads and least privilege', async () => {
    const db = new PGlite();
    try {
      await db.exec(
        `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY,name text,bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated; CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;`,
      );
      await db.exec(await readFile('src/backend/supabase/schemas/001_inventory.sql', 'utf8'));
      await db.exec(await readFile('src/backend/supabase/schemas/005_agent_chat.sql', 'utf8'));
      await db.exec(
        await readFile('src/backend/supabase/schemas/006_agent_workflow_persistence.sql', 'utf8'),
      );
      await db.exec(
        await readFile('src/backend/supabase/schemas/007_agent_stage_messages.sql', 'utf8'),
      );
      await db.exec(
        `INSERT INTO organizations(org_id,name) VALUES('10000000-0000-4000-8000-000000000001','Alpha'),('10000000-0000-4000-8000-000000000002','Beta'); INSERT INTO organization_members(org_id,user_id,role) VALUES('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','viewer'); INSERT INTO imports(org_id,id,file_hash,payload) VALUES('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','alpha','{"storage_path":"10000000-0000-4000-8000-000000000001/file.csv"}'),('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','beta','{"storage_path":"10000000-0000-4000-8000-000000000002/file.csv"}'); INSERT INTO storage.objects(id,name,bucket_id) VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001/file.csv','source-imports'),('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002/file.csv','source-imports');`,
      );
      await db.exec(
        `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);`,
      );
      expect((await db.query('SELECT * FROM organizations')).rows).toHaveLength(1);
      expect((await db.query('SELECT * FROM imports')).rows).toHaveLength(1);
      expect((await db.query('SELECT * FROM conversations')).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM storage.objects')).rows).toHaveLength(1);
      await expect(db.exec("UPDATE organization_members SET role='owner'")).rejects.toThrow(
        'permission denied',
      );
      await expect(
        db.exec(
          "INSERT INTO imports(org_id,id,file_hash,payload) VALUES('10000000-0000-4000-8000-000000000002','forged','forged','{}')",
        ),
      ).rejects.toThrow('permission denied');
      await expect(
        db.exec(
          "INSERT INTO conversations(org_id,id,created_by,kind,title) VALUES('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','interactive','forged')",
        ),
      ).rejects.toThrow('permission denied');
      await expect(
        db.exec(
          "INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload,artifact_key) VALUES('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004','calculation','{}','calculation')",
        ),
      ).rejects.toThrow('permission denied');
      await expect(
        db.exec(
          "INSERT INTO messages(org_id,id,conversation_id,run_id,payload,role,status,sender_agent) VALUES('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000003','{}','assistant','completed','data')",
        ),
      ).rejects.toThrow('permission denied');
      await db.exec(`RESET ROLE; DELETE FROM organization_members; SET ROLE authenticated;`);
      expect((await db.query('SELECT * FROM imports')).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM storage.objects')).rows).toHaveLength(0);
      await db.exec('RESET ROLE');
      await expect(db.exec("UPDATE imports SET file_hash='changed'")).rejects.toThrow(
        'immutable lineage record',
      );
      await db.exec(
        `INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,created_at,payload) VALUES('10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fresh-artifact-key','fresh-artifact-key','queued',now(),'{"org_id":"10000000-0000-4000-8000-000000000001","run_id":"60000000-0000-4000-8000-000000000001","created_by":"20000000-0000-4000-8000-000000000001"}'); INSERT INTO tasks(org_id,id,run_id,payload) VALUES('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','{}'); INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload) VALUES('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','calculation','{"org_id":"10000000-0000-4000-8000-000000000001","artifact_id":"80000000-0000-4000-8000-000000000001","run_id":"60000000-0000-4000-8000-000000000001","task_id":"70000000-0000-4000-8000-000000000001","content_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');`,
      );
      await db.exec(
        `INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload,artifact_key) VALUES('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','calculation','{"org_id":"10000000-0000-4000-8000-000000000001","artifact_id":"80000000-0000-4000-8000-000000000002","run_id":"60000000-0000-4000-8000-000000000001","task_id":"70000000-0000-4000-8000-000000000001","content_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}','calculation:2');`,
      );
      const freshArtifactRows = (
        await db.query(
          "SELECT artifact_key FROM artifacts WHERE run_id='60000000-0000-4000-8000-000000000001' ORDER BY artifact_key",
        )
      ).rows as Array<{ artifact_key: string }>;
      expect(freshArtifactRows.map((row) => row.artifact_key)).toEqual([
        'calculation',
        'calculation:2',
      ]);
      await expect(
        db.exec(
          "UPDATE artifacts SET artifact_key='calculation:changed' WHERE id='80000000-0000-4000-8000-000000000001'",
        ),
      ).rejects.toThrow('immutable lineage record');
      await db.exec(
        "INSERT INTO conversations(org_id,id,created_by,kind,title) VALUES('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','interactive','Fresh keys')",
      );
      await expect(
        db.exec(
          "INSERT INTO messages(org_id,id,conversation_id,run_id,payload,role,status,sender_agent) VALUES('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','{}','user','completed','data')",
        ),
      ).rejects.toThrow();
      await db.exec(
        "INSERT INTO messages(org_id,id,conversation_id,run_id,payload,role,status,sender_agent) VALUES('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','{}','assistant','completed','data')",
      );
      const freshMessage = (
        await db.query(
          "SELECT sender_agent FROM messages WHERE id='90000000-0000-4000-8000-000000000003'",
        )
      ).rows[0] as { sender_agent?: string } | undefined;
      expect(freshMessage?.sender_agent).toBe('data');
      // A distinct specialized checkpoint is permitted for the same run.
      const insertStageMessage = (id: string, senderAgent: string | null) =>
        db.query(
          `INSERT INTO messages(
             org_id,id,conversation_id,run_id,payload,role,status,sender_agent
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            '10000000-0000-4000-8000-000000000001',
            id,
            '90000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '{}',
            'assistant',
            'completed',
            senderAgent,
          ],
        );
      await insertStageMessage('90000000-0000-4000-8000-000000000004', 'comparison');
      await insertStageMessage('90000000-0000-4000-8000-000000000005', null);
      await expect(
        insertStageMessage('90000000-0000-4000-8000-000000000006', 'data'),
      ).rejects.toThrow();
      await expect(
        insertStageMessage('90000000-0000-4000-8000-000000000007', null),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 30000);

  it('hides private workflow lineage relations from viewers while owners and analysts retain access', async () => {
    const db = new PGlite();
    const orgId = '10000000-0000-4000-8000-000000000101';
    const viewerId = '20000000-0000-4000-8000-000000000101';
    const ownerId = '20000000-0000-4000-8000-000000000102';
    const analystId = '20000000-0000-4000-8000-000000000103';
    const importId = '30000000-0000-4000-8000-000000000101';
    const snapshotId = '40000000-0000-4000-8000-000000000101';
    const runId = '50000000-0000-4000-8000-000000000101';
    const taskId = '60000000-0000-4000-8000-000000000101';
    const calculationId = '70000000-0000-4000-8000-000000000101';
    const packId = '70000000-0000-4000-8000-000000000102';
    const draftId = '70000000-0000-4000-8000-000000000103';
    const reviewId = '70000000-0000-4000-8000-000000000104';
    const artifactPayload = (artifactId: string) =>
      JSON.stringify({
        org_id: orgId,
        artifact_id: artifactId,
        run_id: runId,
        task_id: taskId,
        content_hash: 'a'.repeat(64),
      });
    const privateInputs = `SELECT * FROM artifact_inputs WHERE artifact_id='${draftId}' OR input_id='${reviewId}'`;
    const privateSnapshots = `SELECT * FROM artifact_snapshots WHERE artifact_id='${draftId}'`;
    const privateSources = `SELECT * FROM artifact_sources WHERE artifact_id='${draftId}'`;
    const privateValidations = `SELECT * FROM validations WHERE id IN ('${draftId}','${reviewId}')`;

    const asUser = async (userId: string) => {
      await db.exec(
        `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${userId}',false);`,
      );
    };

    try {
      await db.exec(
        `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY,name text,bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated; CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;`,
      );
      await db.exec(await readFile('src/backend/supabase/schemas/001_inventory.sql', 'utf8'));
      await db.exec(await readFile('src/backend/supabase/schemas/005_agent_chat.sql', 'utf8'));
      await db.exec(
        await readFile('src/backend/supabase/schemas/006_agent_workflow_persistence.sql', 'utf8'),
      );
      await db.exec(
        await readFile('src/backend/supabase/schemas/007_agent_stage_messages.sql', 'utf8'),
      );
      await db.exec(
        `INSERT INTO organizations(org_id,name) VALUES('${orgId}','Lineage'); INSERT INTO organization_members(org_id,user_id,role) VALUES('${orgId}','${viewerId}','viewer'),('${orgId}','${ownerId}','owner'),('${orgId}','${analystId}','analyst'); INSERT INTO imports(org_id,id,file_hash,payload) VALUES('${orgId}','${importId}','lineage-fixture','{}'); INSERT INTO snapshots(org_id,id,import_id,unit_external_id,snapshot_date,project_external_id,zone_external_id,payload) VALUES('${orgId}','${snapshotId}','${importId}','unit-lineage','2026-09-19','project-lineage','zone-lineage','${JSON.stringify({ org_id: orgId, snapshot_id: snapshotId, import_id: importId, list_price: '1', area_sqm: '1' })}'); INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,created_at,payload) VALUES('${orgId}','${runId}','${ownerId}','lineage-fixture','lineage-fixture','running',now(),'${JSON.stringify({ org_id: orgId, run_id: runId, created_by: ownerId })}'); INSERT INTO run_snapshots(org_id,run_id,snapshot_id) VALUES('${orgId}','${runId}','${snapshotId}'); INSERT INTO tasks(org_id,id,run_id,payload) VALUES('${orgId}','${taskId}','${runId}','{}'); INSERT INTO artifacts(org_id,id,run_id,task_id,kind,artifact_key,payload) VALUES('${orgId}','${calculationId}','${runId}','${taskId}','calculation','calculation','${artifactPayload(calculationId)}'),('${orgId}','${packId}','${runId}','${taskId}','data_analysis_pack','data_analysis_pack','${artifactPayload(packId)}'),('${orgId}','${draftId}','${runId}','${taskId}','report_draft','report_draft:1','${artifactPayload(draftId)}'),('${orgId}','${reviewId}','${runId}','${taskId}','review_result','review_result:1','${artifactPayload(reviewId)}'); INSERT INTO artifact_inputs(org_id,run_id,artifact_id,input_id) VALUES('${orgId}','${runId}','${calculationId}','${packId}'),('${orgId}','${runId}','${draftId}','${calculationId}'),('${orgId}','${runId}','${calculationId}','${reviewId}'); INSERT INTO artifact_snapshots(org_id,run_id,artifact_id,snapshot_id) VALUES('${orgId}','${runId}','${calculationId}','${snapshotId}'),('${orgId}','${runId}','${draftId}','${snapshotId}'); INSERT INTO artifact_sources(org_id,artifact_id,import_id) VALUES('${orgId}','${calculationId}','${importId}'),('${orgId}','${draftId}','${importId}'); INSERT INTO validations(org_id,id,run_id,payload) VALUES('${orgId}','${calculationId}','${runId}','{}'),('${orgId}','${draftId}','${runId}','{}'),('${orgId}','${reviewId}','${runId}','{}');`,
      );

      await asUser(viewerId);
      expect((await db.query(privateInputs)).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM artifact_inputs')).rows).toHaveLength(1);
      expect((await db.query(privateSnapshots)).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM artifact_snapshots')).rows).toHaveLength(1);
      expect((await db.query(privateSources)).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM artifact_sources')).rows).toHaveLength(1);
      expect((await db.query(privateValidations)).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM validations')).rows).toHaveLength(1);

      for (const userId of [ownerId, analystId]) {
        await asUser(userId);
        expect((await db.query(privateInputs)).rows).toHaveLength(2);
        expect((await db.query(privateSnapshots)).rows).toHaveLength(1);
        expect((await db.query(privateSources)).rows).toHaveLength(1);
        expect((await db.query(privateValidations)).rows).toHaveLength(2);
      }
    } finally {
      await db.close();
    }
  }, 30_000);

  it('upgrades legacy artifacts without rewriting hashes and restores immutability', async () => {
    const db = await createLegacyTestDatabase();
    const orgId = '10000000-0000-4000-8000-000000000010';
    const userId = '20000000-0000-4000-8000-000000000010';
    const conversationId = '30000000-0000-4000-8000-000000000010';
    const runId = '40000000-0000-4000-8000-000000000010';
    const taskId = '50000000-0000-4000-8000-000000000010';
    const artifactId = '60000000-0000-4000-8000-000000000010';
    const messageId = '70000000-0000-4000-8000-000000000010';
    const payload = JSON.stringify({
      org_id: orgId,
      artifact_id: artifactId,
      run_id: runId,
      task_id: taskId,
      content_hash: 'c'.repeat(64),
    });
    try {
      await db.exec(
        `INSERT INTO organizations(org_id,name) VALUES('${orgId}','Upgrade'); INSERT INTO conversations(org_id,id,created_by,kind,title) VALUES('${orgId}','${conversationId}','${userId}','interactive','Upgrade'); INSERT INTO runs(org_id,id,created_by,idempotency_key,request_hash,status,created_at,payload) VALUES('${orgId}','${runId}','${userId}','upgrade-key','upgrade-hash','queued',now(),'${JSON.stringify({ org_id: orgId, run_id: runId, created_by: userId })}'); INSERT INTO tasks(org_id,id,run_id,payload) VALUES('${orgId}','${taskId}','${runId}','{}'); INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload) VALUES('${orgId}','${artifactId}','${runId}','${taskId}','calculation','${payload}'); INSERT INTO messages(org_id,id,conversation_id,run_id,payload,role,status) VALUES('${orgId}','${messageId}','${conversationId}','${runId}','{}','assistant','completed');`,
      );
      const before = (
        await db.query(
          `SELECT payload::text AS payload, payload->>'content_hash' AS content_hash FROM artifacts WHERE org_id='${orgId}' AND id='${artifactId}'`,
        )
      ).rows[0] as { payload: string; content_hash: string } | undefined;
      expect(before).toBeDefined();

      const migration = await readFile(
        'src/backend/supabase/migrations/20260921101524_agent_workflow_persistence.sql',
        'utf8',
      );
      await db.exec(migration);
      await db.exec(migration);
      const stageMessageMigration = await readFile(
        'src/backend/supabase/migrations/20260922130000_agent_stage_messages.sql',
        'utf8',
      );
      await db.exec(stageMessageMigration);
      await db.exec(stageMessageMigration);

      const upgraded = (
        await db.query(
          `SELECT artifact_key, payload::text AS payload, payload->>'content_hash' AS content_hash FROM artifacts WHERE org_id='${orgId}' AND id='${artifactId}'`,
        )
      ).rows[0] as { artifact_key: string; payload: string; content_hash: string } | undefined;
      expect(upgraded).toMatchObject({
        artifact_key: 'calculation',
        payload: before?.payload,
        content_hash: before?.content_hash,
      });
      const legacyMessage = (
        await db.query(
          `SELECT sender_agent FROM messages WHERE org_id='${orgId}' AND id='${messageId}'`,
        )
      ).rows[0] as { sender_agent?: string | null } | undefined;
      expect(legacyMessage?.sender_agent).toBeNull();

      const revisionId = '60000000-0000-4000-8000-000000000011';
      const revisionPayload = JSON.stringify({
        org_id: orgId,
        artifact_id: revisionId,
        run_id: runId,
        task_id: taskId,
        content_hash: 'd'.repeat(64),
      });
      await db.exec(
        `INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload,artifact_key) VALUES('${orgId}','${revisionId}','${runId}','${taskId}','calculation','${revisionPayload}','calculation:2');`,
      );
      const legacyWriterId = '60000000-0000-4000-8000-000000000012';
      const legacyWriterPayload = JSON.stringify({
        org_id: orgId,
        artifact_id: legacyWriterId,
        run_id: runId,
        task_id: taskId,
        content_hash: 'e'.repeat(64),
      });
      await db.exec(
        `INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload) VALUES('${orgId}','${legacyWriterId}','${runId}','${taskId}','query','${legacyWriterPayload}');`,
      );
      const upgradedArtifactRows = (
        await db.query(
          `SELECT artifact_key FROM artifacts WHERE org_id='${orgId}' AND run_id='${runId}' ORDER BY artifact_key`,
        )
      ).rows as Array<{ artifact_key: string }>;
      expect(upgradedArtifactRows.map((row) => row.artifact_key)).toEqual([
        'calculation',
        'calculation:2',
        'query',
      ]);
      await expect(
        db.exec(
          `UPDATE artifacts SET artifact_key='calculation:changed' WHERE org_id='${orgId}' AND id='${artifactId}'`,
        ),
      ).rejects.toThrow('immutable lineage record');
      await db.exec(
        `UPDATE messages SET sender_agent='coordinator' WHERE org_id='${orgId}' AND id='${messageId}'`,
      );
      await expect(
        db.exec(
          `UPDATE messages SET sender_agent='not-an-agent' WHERE org_id='${orgId}' AND id='${messageId}'`,
        ),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 30000);
});
