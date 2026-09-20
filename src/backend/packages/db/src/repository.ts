import { createHash, randomUUID } from 'node:crypto';
import {
  AnalysisRequestSchema,
  AgentTurnRequestSchema,
  ArtifactSchema,
  ConversationSchema,
  MessagePartSchema,
  MessageSchema,
  PageRequestSchema,
  ReportDefinitionInputSchema,
  type AnalysisRequest,
  type AnalysisRun,
  type AgentTurnRequest,
  type Artifact,
  type ArtifactValidation,
  type Catalog,
  type Conversation,
  type ConversationPage,
  type ImportManifest,
  type Message,
  type MessagePage,
  type MessagePart,
  type MessageStatus,
  type PageRequest,
  type ReportDefinition,
  type ReportDefinitionInput,
  type ReportOccurrence,
  type ReportRecord,
  type Role,
  type RunEvent,
  type RunTask,
  type Session,
  type UnitSnapshot,
} from '@vda/contracts';
import {
  localDate,
  nextScheduledAt,
  scheduledOnDate,
  parseInventoryCsv,
  validateHierarchy,
  verifyArtifact,
  validateReport,
} from '@vda/domain';
import { postgresDriver, type Driver, type Row } from './driver';
import { TEST_ORGS, TEST_USERS, syntheticRows } from './seed';
import { StorageError, supabaseStorage, type StorageUploader } from './storage';
import type { AgentTurn, Lease, Repository, QueryResult, TurnContext } from './types';

export class RepositoryError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
function fail(code: string, status = 400): never {
  throw new RepositoryError(code, status);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (row: Row) => {
  if (typeof row.payload === 'string') return JSON.parse(row.payload);
  if (Array.isArray(row.payload))
    return row.payload.reduce<Record<string, unknown>>(
      (value, item) => ({ ...value, ...(typeof item === 'string' ? JSON.parse(item) : item) }),
      {},
    );
  return row.payload;
};
const now = () => new Date().toISOString();
const asTimestamp = (value: unknown, fallback = now()): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
};
const textPart = (content: string): MessagePart[] =>
  content.trim().length ? [{ type: 'text', text: content.trim() }] : [];
function normalizeMessage(row: Row): Message {
  const payload = json(row) as Record<string, unknown>;
  const content = typeof payload.content === 'string' ? payload.content : '';
  const parts = Array.isArray(payload.parts)
    ? payload.parts.flatMap((part) => {
        const parsed = MessagePartSchema.safeParse(part);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  return MessageSchema.parse({
    message_id: row.id ?? payload.message_id,
    org_id: row.org_id ?? payload.org_id,
    conversation_id: row.conversation_id ?? payload.conversation_id,
    run_id: row.run_id ?? payload.run_id ?? null,
    client_turn_id: row.client_turn_id ?? payload.client_turn_id ?? null,
    role: row.role ?? payload.role ?? 'user',
    status: row.status ?? payload.status ?? 'completed',
    content,
    parts: parts.length ? parts : textPart(content),
    created_at: asTimestamp(row.created_at ?? payload.created_at),
    updated_at: asTimestamp(
      row.updated_at ?? payload.updated_at ?? row.created_at ?? payload.created_at,
    ),
  });
}
function conversationFromRow(row: Row): Conversation {
  return ConversationSchema.parse({
    conversation_id: row.id,
    org_id: row.org_id,
    created_by: row.created_by,
    kind: row.kind,
    title: row.title,
    created_at: asTimestamp(row.created_at),
    updated_at: asTimestamp(row.updated_at),
  });
}
type Cursor = { timestamp: string; id: string };
function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
function decodeCursor(value: string | null): Cursor | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Cursor).timestamp !== 'string' ||
      typeof (parsed as Cursor).id !== 'string' ||
      !(parsed as Cursor).id ||
      Number.isNaN(Date.parse((parsed as Cursor).timestamp))
    )
      fail('INVALID_CURSOR');
    return {
      timestamp: new Date((parsed as Cursor).timestamp).toISOString(),
      id: (parsed as Cursor).id,
    };
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    fail('INVALID_CURSOR');
  }
}
const titleFrom = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 80) || 'New analysis';
async function insertBatches(
  tx: Driver,
  prefix: string,
  rows: unknown[][],
  batchSize = 500,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const width = batch[0]?.length ?? 0;
    const values = batch
      .map(
        (_, rowIndex) =>
          `(${Array.from(
            { length: width },
            (_unused, columnIndex) => `$${rowIndex * width + columnIndex + 1}`,
          ).join(',')})`,
      )
      .join(',');
    await tx.query(`${prefix} VALUES ${values}`, batch.flat());
  }
}
export interface RepositoryOptions {
  databaseUrl?: string;
  storageUrl?: string;
  storageKey?: string;
  storage?: StorageUploader;
  /** Test-only fixture seeding. Production startup never calls this. */
  seedTestData?: boolean;
  driver?: Driver;
}
export async function createRepository(options: RepositoryOptions = {}): Promise<Repository> {
  const url = options.databaseUrl ?? process.env.SUPABASE_DB_URL;
  if (!url && !options.driver) fail('SUPABASE_DB_URL_REQUIRED', 503);
  const db = options.driver ?? postgresDriver(url!);
  const repo = new SqlRepository(db, options);
  if (options.seedTestData) await repo.seedTestData();
  return repo;
}
class SqlRepository implements Repository {
  constructor(
    private db: Driver,
    private options: RepositoryOptions,
  ) {}
  close() {
    return this.db.close();
  }
  async auth(tx: Driver, user: string, org: string, write = false): Promise<Role> {
    const rows = await tx.query(
      'SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2 FOR SHARE',
      [org, user],
    );
    const role = rows[0]?.role as Role | undefined;
    if (!role) fail('WORKSPACE_FORBIDDEN', 403);
    if (write && role === 'viewer') fail('VIEWER_READ_ONLY', 403);
    if (!write) {
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
      await tx.query('SET LOCAL ROLE authenticated');
    }
    return role;
  }
  authorize(user: string, org: string, write = false) {
    return this.db.transaction((tx) => this.auth(tx, user, org, write));
  }
  async seedTestData() {
    await this.db.transaction(async (tx) => {
      if ((await tx.query('SELECT org_id FROM organizations LIMIT 1')).length) return;
      for (const [key, id] of Object.entries(TEST_ORGS))
        await tx.query('INSERT INTO organizations(org_id,name) VALUES($1,$2)', [
          id,
          `Workspace ${key}`,
        ]);
      for (const role of ['owner', 'analyst', 'viewer'] as const)
        await tx.query('INSERT INTO organization_members(org_id,user_id,role) VALUES($1,$2,$3)', [
          TEST_ORGS.alpha,
          TEST_USERS[role],
          role,
        ]);
      await tx.query('INSERT INTO organization_members(org_id,user_id,role) VALUES($1,$2,$3)', [
        TEST_ORGS.beta,
        TEST_USERS.beta,
        'owner',
      ]);
      for (const org of Object.values(TEST_ORGS)) {
        const id = randomUUID();
        const rows = syntheticRows();
        const manifest: ImportManifest = {
          import_id: id,
          org_id: org,
          created_by: org === TEST_ORGS.alpha ? TEST_USERS.owner : TEST_USERS.beta,
          created_at: now(),
          source_name: 'synthetic-seed.csv',
          file_hash: hash(JSON.stringify(rows)),
          row_count: rows.length,
          storage_path: null,
          schema_version: 'csv-v1',
          provisional: true,
        };
        await tx.query('INSERT INTO imports(org_id,id,file_hash,payload) VALUES($1,$2,$3,$4)', [
          org,
          id,
          manifest.file_hash,
          JSON.stringify(manifest),
        ]);
        for (const row of rows)
          await this.insertSnapshot(tx, {
            ...row,
            snapshot_id: randomUUID(),
            org_id: org,
            import_id: id,
          });
      }
    });
  }
  async session(user: string, email: string): Promise<Session> {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
      await tx.query('SET LOCAL ROLE authenticated');
      const rows = await tx.query(
        'SELECT m.org_id,m.role,o.name FROM organization_members m JOIN organizations o ON o.org_id=m.org_id WHERE m.user_id=$1',
        [user],
      );
      if (!rows.length) fail('NO_WORKSPACE', 403);
      return {
        user_id: user,
        email,
        mode: 'supabase',
        organizations: rows as Session['organizations'],
      };
    });
  }
  async catalog(user: string, org: string): Promise<Catalog> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = (await tx.query('SELECT payload FROM snapshots WHERE org_id=$1', [org])).map(
        json,
      ) as UnitSnapshot[];
      const projects = new Map<string, Catalog['projects'][number]>();
      for (const row of rows) {
        let p = projects.get(row.project_external_id);
        if (!p) {
          p = {
            project_external_id: row.project_external_id,
            project_name: row.project_name,
            zones: [],
          };
          projects.set(p.project_external_id, p);
        }
        if (!p.zones.some((z) => z.zone_external_id === row.zone_external_id))
          p.zones.push({ zone_external_id: row.zone_external_id, zone_name: row.zone_name });
      }
      return {
        projects: [...projects.values()],
        latest_snapshot_date:
          rows
            .map((r) => r.snapshot_date)
            .sort()
            .at(-1) ?? null,
      };
    });
  }
  async insertSnapshot(tx: Driver, row: UnitSnapshot) {
    await tx.query(
      'INSERT INTO snapshots(org_id,id,import_id,unit_external_id,snapshot_date,project_external_id,zone_external_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        row.org_id,
        row.snapshot_id,
        row.import_id,
        row.unit_external_id,
        row.snapshot_date,
        row.project_external_id,
        row.zone_external_id,
        JSON.stringify(row),
      ],
    );
  }
  private storage(): StorageUploader {
    if (this.options.storage) return this.options.storage;
    const url = this.options.storageUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = this.options.storageKey ?? process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) fail('STORAGE_CONFIG_REQUIRED', 503);
    return supabaseStorage(url, key);
  }
  async importCsv(
    user: string,
    input: { org_id: string; source_name: string; csv: string },
  ): Promise<ImportManifest> {
    const rows = parseInventoryCsv(input.csv);
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, input.org_id, true);
      await tx.query('SELECT org_id FROM organizations WHERE org_id=$1 FOR UPDATE', [input.org_id]);
      const fileHash = hash(input.csv);
      const prior = await tx.query('SELECT payload FROM imports WHERE org_id=$1 AND file_hash=$2', [
        input.org_id,
        fileHash,
      ]);
      if (prior[0]) return json(prior[0]) as ImportManifest;
      const existing = (
        await tx.query('SELECT payload FROM snapshots WHERE org_id=$1', [input.org_id])
      ).map(json) as UnitSnapshot[];
      validateHierarchy(rows, existing);
      const keys = new Set(existing.map((r) => `${r.unit_external_id}|${r.snapshot_date}`));
      if (rows.some((r) => keys.has(`${r.unit_external_id}|${r.snapshot_date}`)))
        fail('IMMUTABLE_SNAPSHOT_CONFLICT', 409);
      const id = randomUUID();
      const storagePath = `${input.org_id}/${id}/source.csv`;
      try {
        await this.storage().upload({
          bucket: 'source-imports',
          path: storagePath,
          body: input.csv,
          contentType: 'text/csv',
        });
      } catch (error) {
        if (error instanceof StorageError)
          fail(error.code, error.code === 'STORAGE_CONFIG_REQUIRED' ? 503 : 502);
        throw error;
      }
      const manifest: ImportManifest = {
        import_id: id,
        org_id: input.org_id,
        created_by: user,
        created_at: now(),
        source_name: input.source_name,
        file_hash: fileHash,
        row_count: rows.length,
        storage_path: storagePath,
        schema_version: 'csv-v1',
        provisional: true,
      };
      await tx.query('INSERT INTO imports(org_id,id,file_hash,payload) VALUES($1,$2,$3,$4)', [
        input.org_id,
        id,
        fileHash,
        JSON.stringify(manifest),
      ]);
      for (const row of rows)
        await this.insertSnapshot(tx, {
          ...row,
          org_id: input.org_id,
          import_id: id,
          snapshot_id: randomUUID(),
        });
      return manifest;
    });
  }
  async listImports(user: string, org: string): Promise<ImportManifest[]> {
    return this.readList(user, org, 'imports');
  }
  private async readList<T>(
    user: string,
    org: string,
    table: 'imports' | 'runs' | 'reports' | 'definitions',
  ): Promise<T[]> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      return (await tx.query(`SELECT payload FROM ${table} WHERE org_id=$1`, [org])).map(
        json,
      ) as T[];
    });
  }
  private async createConversation(
    tx: Driver,
    user: string,
    org: string,
    kind: Conversation['kind'],
    title: string,
  ): Promise<Conversation> {
    const date = now();
    const conversation: Conversation = {
      conversation_id: randomUUID(),
      org_id: org,
      created_by: user,
      kind,
      title,
      created_at: date,
      updated_at: date,
    };
    await tx.query(
      'INSERT INTO conversations(org_id,id,created_by,kind,title,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        conversation.org_id,
        conversation.conversation_id,
        conversation.created_by,
        conversation.kind,
        conversation.title,
        conversation.created_at,
        conversation.updated_at,
      ],
    );
    return conversation;
  }
  private async touchConversation(tx: Driver, org: string, id: string, date = now()) {
    await tx.query('UPDATE conversations SET updated_at=$1 WHERE org_id=$2 AND id=$3', [
      date,
      org,
      id,
    ]);
  }
  private async insertMessage(
    tx: Driver,
    message: Message,
    payloadExtra: Record<string, unknown> = {},
  ) {
    await tx.query(
      "INSERT INTO messages(org_id,id,conversation_id,run_id,client_turn_id,role,status,created_at,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,($10::jsonb #>> '{}')::jsonb)",
      [
        message.org_id,
        message.message_id,
        message.conversation_id,
        message.run_id,
        message.client_turn_id,
        message.role,
        message.status,
        message.created_at,
        message.updated_at,
        JSON.stringify({ ...message, ...payloadExtra }),
      ],
    );
  }
  private async updateMessage(tx: Driver, message: Message) {
    await tx.query(
      `UPDATE messages
       SET run_id=$1,client_turn_id=$2,role=$3,status=$4,created_at=$5,updated_at=$6,
           payload=(CASE jsonb_typeof(payload)
             WHEN 'string' THEN (payload #>> '{}')::jsonb
             ELSE payload
           END) || (($7::jsonb #>> '{}')::jsonb)
       WHERE org_id=$8 AND id=$9`,
      [
        message.run_id,
        message.client_turn_id,
        message.role,
        message.status,
        message.created_at,
        message.updated_at,
        JSON.stringify(message),
        message.org_id,
        message.message_id,
      ],
    );
  }
  private async message(tx: Driver, org: string, id: string, lock = false): Promise<Message> {
    const rows = await tx.query(
      `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,status,created_at,updated_at,payload FROM messages WHERE org_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
      [org, id],
    );
    if (!rows[0]) fail('MESSAGE_NOT_FOUND', 404);
    return normalizeMessage(rows[0]);
  }
  private async attachRunMessages(tx: Driver, run: AnalysisRun, context: TurnContext) {
    const userMessage = await this.message(tx, run.org_id, context.user_message_id, true);
    const assistantMessage = await this.message(tx, run.org_id, context.assistant_message_id, true);
    if (
      userMessage.conversation_id !== context.conversation_id ||
      assistantMessage.conversation_id !== context.conversation_id ||
      userMessage.client_turn_id !== context.client_turn_id ||
      assistantMessage.client_turn_id !== context.client_turn_id ||
      userMessage.role !== 'user' ||
      assistantMessage.role !== 'assistant'
    )
      fail('TURN_MISMATCH', 409);
    if (userMessage.run_id && userMessage.run_id !== run.run_id) fail('TURN_ALREADY_ATTACHED', 409);
    if (assistantMessage.status !== 'in_progress') fail('TURN_TERMINAL', 409);
    const date = now();
    userMessage.run_id = run.run_id;
    userMessage.status = 'completed';
    userMessage.updated_at = date;
    assistantMessage.run_id = run.run_id;
    assistantMessage.status = 'in_progress';
    assistantMessage.content = 'Đang chuẩn bị phân tích.';
    assistantMessage.parts = [
      { type: 'text', text: assistantMessage.content },
      { type: 'run_ref', run_id: run.run_id, status: 'queued' },
    ];
    assistantMessage.updated_at = date;
    await this.updateMessage(tx, userMessage);
    await this.updateMessage(tx, assistantMessage);
    await this.touchConversation(tx, run.org_id, context.conversation_id, date);
  }
  private async createRunMessages(tx: Driver, run: AnalysisRun) {
    const date = now();
    const assistantDate = new Date(Date.parse(date) + 1).toISOString();
    const userMessage: Message = {
      message_id: randomUUID(),
      org_id: run.org_id,
      conversation_id: run.request.conversation_id!,
      run_id: run.run_id,
      client_turn_id: null,
      role: 'user',
      status: 'completed',
      content: run.request.question,
      parts: textPart(run.request.question),
      created_at: date,
      updated_at: date,
    };
    const assistantMessage: Message = {
      message_id: randomUUID(),
      org_id: run.org_id,
      conversation_id: run.request.conversation_id!,
      run_id: run.run_id,
      client_turn_id: null,
      role: 'assistant',
      status: 'in_progress',
      content: 'Đang chuẩn bị phân tích.',
      parts: [
        { type: 'text', text: 'Đang chuẩn bị phân tích.' },
        { type: 'run_ref', run_id: run.run_id, status: 'queued' },
      ],
      created_at: assistantDate,
      updated_at: assistantDate,
    };
    await this.insertMessage(tx, userMessage);
    await this.insertMessage(tx, assistantMessage);
    await this.touchConversation(tx, run.org_id, run.request.conversation_id!, assistantDate);
  }
  async buildRun(
    tx: Driver,
    user: string,
    input: AnalysisRequest,
    key: string,
    options: {
      entrypoint?: 'interactive' | 'scheduled';
      occurrence_id?: string;
      turn?: TurnContext;
    } = {},
  ): Promise<AnalysisRun> {
    const request = AnalysisRequestSchema.parse(input);
    await this.auth(tx, user, request.org_id, true);
    await tx.query('SELECT org_id FROM organizations WHERE org_id=$1 FOR UPDATE', [request.org_id]);
    if (!key || key.length > 200) fail('INVALID_IDEMPOTENCY_KEY');
    const requestHash = hash(JSON.stringify(request));
    const prior = await tx.query(
      'SELECT payload FROM runs WHERE org_id=$1 AND created_by=$2 AND idempotency_key=$3',
      [request.org_id, user, key],
    );
    if (prior[0]) {
      const run = json(prior[0]) as AnalysisRun;
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
      const conversation = await this.createConversation(
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
    const selected = await this.selectLatest(tx, request);
    await insertBatches(
      tx,
      'INSERT INTO run_snapshots(org_id,run_id,snapshot_id)',
      selected.rows.map((row) => [run.org_id, run.run_id, row.snapshot_id]),
    );
    if (options.turn) await this.attachRunMessages(tx, run, options.turn);
    else await this.createRunMessages(tx, run);
    return run;
  }
  createRun(
    user: string,
    request: AnalysisRequest,
    key: string,
    options?: { entrypoint?: 'interactive' | 'scheduled'; occurrence_id?: string },
  ) {
    return this.db.transaction((tx) => this.buildRun(tx, user, request, key, options));
  }
  async listRuns(user: string, org: string): Promise<AnalysisRun[]> {
    return (await this.readList<AnalysisRun>(user, org, 'runs')).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }
  async getRun(user: string, org: string, id: string) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const run = await this.run(tx, org, id);
      const tasks = (
        await tx.query('SELECT payload FROM tasks WHERE org_id=$1 AND run_id=$2', [org, id])
      ).map(json) as RunTask[];
      const events = (
        await tx.query('SELECT payload FROM events WHERE org_id=$1 AND run_id=$2', [org, id])
      ).map(json) as RunEvent[];
      return { run, tasks, events };
    });
  }
  private async run(tx: Driver, org: string, id: string, lock = false): Promise<AnalysisRun> {
    const rows = await tx.query(
      `SELECT payload FROM runs WHERE org_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
      [org, id],
    );
    if (!rows[0]) fail('RUN_NOT_FOUND', 404);
    return json(rows[0]) as AnalysisRun;
  }
  private async updateRun(tx: Driver, run: AnalysisRun, worker: string | null = null) {
    run.updated_at = now();
    await tx.query(
      'UPDATE runs SET status=$1,lease_until=$2,fencing_token=$3,worker_id=$4,payload=$5 WHERE org_id=$6 AND id=$7',
      [
        run.status,
        run.lease_until,
        run.fencing_token,
        worker,
        JSON.stringify(run),
        run.org_id,
        run.run_id,
      ],
    );
  }
  async cancelRun(user: string, org: string, id: string) {
    await this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const run = await this.run(tx, org, id, true);
      if (run.status === 'succeeded' || run.status === 'failed') fail('RUN_TERMINAL', 409);
      run.cancel_requested = true;
      run.status = 'cancelled';
      run.lease_until = null;
      run.fencing_token++;
      await this.updateRun(tx, run);
      await this.finalizeRunAssistant(tx, run, {
        status: 'cancelled',
        content: 'Lượt phân tích đã bị hủy.',
        parts: [
          { type: 'text', text: 'Lượt phân tích đã bị hủy.' },
          { type: 'run_ref', run_id: run.run_id, status: 'cancelled' },
          { type: 'error', code: 'RUN_CANCELLED', retryable: false },
        ],
      });
    });
  }
  async retryRun(user: string, org: string, id: string) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const run = await this.run(tx, org, id, true);
      if (run.status !== 'failed') fail('RUN_NOT_RETRYABLE', 409);
      if (run.attempt >= 3) fail('RUN_MAX_ATTEMPTS', 409);
      await this.auth(tx, run.created_by, org, true);
      run.status = 'queued';
      run.error_code = null;
      await this.updateRun(tx, run);
      await this.finalizeRunAssistant(tx, run, {
        status: 'in_progress',
        content: 'Đang chuẩn bị chạy lại phân tích.',
        parts: [
          { type: 'text', text: 'Đang chuẩn bị chạy lại phân tích.' },
          { type: 'run_ref', run_id: run.run_id, status: 'queued' },
        ],
      });
      return run;
    });
  }
  async messages(user: string, org: string, id: string): Promise<Message[]> {
    const page = await this.listMessages(user, org, id, { limit: 100, cursor: null });
    return page.messages;
  }
  async getConversation(user: string, org: string, id: string): Promise<Conversation> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = await tx.query(
        'SELECT org_id,id,created_by,kind,title,created_at,updated_at FROM conversations WHERE org_id=$1 AND id=$2',
        [org, id],
      );
      if (!rows[0]) fail('CONVERSATION_NOT_FOUND', 404);
      return conversationFromRow(rows[0]);
    });
  }
  async listConversations(
    user: string,
    org: string,
    pageInput: PageRequest,
  ): Promise<ConversationPage> {
    const page = PageRequestSchema.parse(pageInput);
    const cursor = decodeCursor(page.cursor);
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = await tx.query(
        `SELECT c.org_id,c.id,c.created_by,c.kind,c.title,c.created_at,c.updated_at,
          (SELECT m.status FROM messages m WHERE m.org_id=c.org_id AND m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS latest_status
         FROM conversations c
         WHERE c.org_id=$1 AND c.kind='interactive'
           AND ($2::timestamptz IS NULL OR (c.updated_at,c.id) < ($2::timestamptz,$3))
         ORDER BY c.updated_at DESC,c.id DESC
         LIMIT $4`,
        [org, cursor?.timestamp ?? null, cursor?.id ?? '', page.limit + 1],
      );
      const hasMore = rows.length > page.limit;
      const items = rows.slice(0, page.limit);
      const last = items.at(-1);
      return {
        conversations: items.map((row) => ({
          ...conversationFromRow(row),
          latest_status:
            typeof row.latest_status === 'string' &&
            ['submitted', 'in_progress', 'completed', 'failed', 'cancelled'].includes(
              row.latest_status,
            )
              ? (row.latest_status as MessageStatus)
              : null,
        })),
        next_cursor:
          hasMore && last
            ? encodeCursor({ timestamp: asTimestamp(last.updated_at), id: String(last.id) })
            : null,
      };
    });
  }
  async listMessages(
    user: string,
    org: string,
    conversationId: string,
    pageInput: PageRequest,
  ): Promise<MessagePage> {
    const page = PageRequestSchema.parse(pageInput);
    const cursor = decodeCursor(page.cursor);
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const conversation = await tx.query(
        'SELECT id FROM conversations WHERE org_id=$1 AND id=$2',
        [org, conversationId],
      );
      if (!conversation[0]) fail('CONVERSATION_NOT_FOUND', 404);
      const rows = await tx.query(
        `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,status,created_at,updated_at,payload
         FROM messages
         WHERE org_id=$1 AND conversation_id=$2
           AND ($3::timestamptz IS NULL OR (created_at,id) < ($3::timestamptz,$4))
         ORDER BY created_at DESC,id DESC
         LIMIT $5`,
        [org, conversationId, cursor?.timestamp ?? null, cursor?.id ?? '', page.limit + 1],
      );
      const hasMore = rows.length > page.limit;
      const pageRows = rows.slice(0, page.limit);
      const last = pageRows.at(-1);
      return {
        messages: pageRows.map(normalizeMessage).reverse(),
        next_cursor:
          hasMore && last
            ? encodeCursor({ timestamp: asTimestamp(last.created_at), id: String(last.id) })
            : null,
      };
    });
  }
  private async turnFromUserMessage(tx: Driver, userMessage: Message): Promise<AgentTurn> {
    const conversationRows = await tx.query(
      'SELECT org_id,id,created_by,kind,title,created_at,updated_at FROM conversations WHERE org_id=$1 AND id=$2',
      [userMessage.org_id, userMessage.conversation_id],
    );
    const assistantRows = await tx.query(
      `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,status,created_at,updated_at,payload
       FROM messages WHERE org_id=$1 AND conversation_id=$2 AND client_turn_id=$3 AND role='assistant'`,
      [userMessage.org_id, userMessage.conversation_id, userMessage.client_turn_id],
    );
    if (!conversationRows[0] || !assistantRows[0]) fail('TURN_INCOMPLETE', 409);
    return {
      conversation: conversationFromRow(conversationRows[0]),
      user_message: userMessage,
      assistant_message: normalizeMessage(assistantRows[0]),
      idempotent_replay: true,
    };
  }
  async startTurn(
    user: string,
    inputValue: AgentTurnRequest,
    idempotencyKey: string,
    requestedConversationId?: string,
  ): Promise<AgentTurn> {
    const input = AgentTurnRequestSchema.parse(inputValue);
    if (!idempotencyKey || idempotencyKey.length > 200) fail('INVALID_IDEMPOTENCY_KEY');
    const requestHash = hash(JSON.stringify(input));
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, input.org_id, true);
      await tx.query('SELECT org_id FROM organizations WHERE org_id=$1 FOR UPDATE', [input.org_id]);
      const priorRows = await tx.query(
        `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,status,created_at,updated_at,payload
         FROM messages
         WHERE org_id=$1 AND role='user'
           AND (client_turn_id=$2 OR payload #>> '{agent_turn,idempotency_key}'=$3)
         ORDER BY created_at ASC,id ASC
         LIMIT 1 FOR UPDATE`,
        [input.org_id, input.client_turn_id, idempotencyKey],
      );
      if (priorRows[0]) {
        const prior = normalizeMessage(priorRows[0]);
        const payload = json(priorRows[0]) as Record<string, unknown>;
        const stored = payload.agent_turn as Record<string, unknown> | undefined;
        if (
          !stored ||
          stored.actor_id !== user ||
          stored.request_hash !== requestHash ||
          stored.idempotency_key !== idempotencyKey ||
          (requestedConversationId !== undefined &&
            prior.conversation_id !== requestedConversationId)
        )
          fail('IDEMPOTENCY_CONFLICT', 409);
        return this.turnFromUserMessage(tx, prior);
      }
      let conversation: Conversation;
      if (requestedConversationId) {
        const rows = await tx.query(
          'SELECT org_id,id,created_by,kind,title,created_at,updated_at FROM conversations WHERE org_id=$1 AND id=$2 FOR UPDATE',
          [input.org_id, requestedConversationId],
        );
        if (!rows[0]) fail('CONVERSATION_NOT_FOUND', 404);
        conversation = conversationFromRow(rows[0]);
        if (conversation.kind !== 'interactive') fail('CONVERSATION_NOT_INTERACTIVE', 409);
      } else {
        conversation = await this.createConversation(
          tx,
          user,
          input.org_id,
          'interactive',
          titleFrom(input.text),
        );
      }
      const date = now();
      const assistantDate = new Date(Date.parse(date) + 1).toISOString();
      const userMessage: Message = {
        message_id: randomUUID(),
        org_id: input.org_id,
        conversation_id: conversation.conversation_id,
        run_id: null,
        client_turn_id: input.client_turn_id,
        role: 'user',
        status: 'submitted',
        content: input.text,
        parts: textPart(input.text),
        created_at: date,
        updated_at: date,
      };
      const assistantMessage: Message = {
        message_id: randomUUID(),
        org_id: input.org_id,
        conversation_id: conversation.conversation_id,
        run_id: null,
        client_turn_id: input.client_turn_id,
        role: 'assistant',
        status: 'in_progress',
        content: 'Đang chuẩn bị phân tích.',
        parts: textPart('Đang chuẩn bị phân tích.'),
        created_at: assistantDate,
        updated_at: assistantDate,
      };
      const agentTurn = {
        agent_turn: {
          actor_id: user,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          request: input,
        },
      };
      await this.insertMessage(tx, userMessage, agentTurn);
      await this.insertMessage(tx, assistantMessage, agentTurn);
      await this.touchConversation(tx, input.org_id, conversation.conversation_id, assistantDate);
      return {
        conversation,
        user_message: userMessage,
        assistant_message: assistantMessage,
        idempotent_replay: false,
      };
    });
  }
  async attachRunToTurn(
    user: string,
    context: TurnContext,
    input: AnalysisRequest,
    idempotencyKey: string,
  ): Promise<AnalysisRun> {
    if (input.org_id !== context.org_id || input.conversation_id !== context.conversation_id)
      fail('TURN_SCOPE_MISMATCH', 403);
    return this.db.transaction((tx) =>
      this.buildRun(tx, user, input, idempotencyKey, { entrypoint: 'interactive', turn: context }),
    );
  }
  async finalizeTurn(
    user: string,
    context: TurnContext,
    result: {
      status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled'>;
      content: string;
      parts: MessagePart[];
    },
  ): Promise<Message> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, context.org_id, true);
      const assistant = await this.message(tx, context.org_id, context.assistant_message_id, true);
      if (
        assistant.conversation_id !== context.conversation_id ||
        assistant.client_turn_id !== context.client_turn_id ||
        assistant.role !== 'assistant'
      )
        fail('TURN_MISMATCH', 409);
      if (assistant.run_id !== null) fail('TURN_HAS_RUN', 409);
      if (assistant.status !== 'in_progress') fail('TURN_TERMINAL', 409);
      assistant.status = result.status;
      assistant.content = result.content;
      assistant.parts = result.parts;
      assistant.updated_at = now();
      await this.updateMessage(tx, assistant);
      const userMessage = await this.message(tx, context.org_id, context.user_message_id, true);
      if (userMessage.status === 'submitted') {
        userMessage.status = 'completed';
        userMessage.updated_at = assistant.updated_at;
        await this.updateMessage(tx, userMessage);
      }
      await this.touchConversation(
        tx,
        context.org_id,
        context.conversation_id,
        assistant.updated_at,
      );
      return assistant;
    });
  }
  async artifacts(user: string, org: string, id: string) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      await this.run(tx, org, id);
      const artifacts = (
        await tx.query('SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2', [org, id])
      ).map(json) as Artifact[];
      const validations = (
        await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2', [org, id])
      ).map(json) as ArtifactValidation[];
      const sourceIds = new Set(artifacts.flatMap((a) => a.source_refs));
      const sources = (
        (await tx.query('SELECT payload FROM imports WHERE org_id=$1', [org])).map(
          json,
        ) as ImportManifest[]
      ).filter((x) => sourceIds.has(x.import_id));
      return { artifacts, validations, sources };
    });
  }
  async claimRun(worker: string, date = new Date(), leaseMs = 30000): Promise<Lease | null> {
    return this.db.transaction(async (tx) => {
      const candidates = await tx.query(
        "SELECT payload FROM runs WHERE status='queued' OR (status='running' AND lease_until<$1) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        [date.toISOString()],
      );
      if (!candidates[0]) return null;
      const run = json(candidates[0]) as AnalysisRun;
      if (run.attempt >= 3) {
        run.status = 'failed';
        run.error_code = 'MAX_ATTEMPTS';
        run.lease_until = null;
        await this.updateRun(tx, run);
        return null;
      }
      try {
        await this.auth(tx, run.created_by, run.org_id, true);
      } catch {
        run.status = 'failed';
        run.error_code = 'MEMBERSHIP_REVOKED';
        await this.updateRun(tx, run);
        return null;
      }
      run.status = 'running';
      run.attempt++;
      run.fencing_token++;
      run.lease_until = new Date(date.getTime() + leaseMs).toISOString();
      await this.updateRun(tx, run, worker);
      return { run, worker_id: worker, fencing_token: run.fencing_token };
    });
  }
  private async fenced(tx: Driver, lease: Lease): Promise<AnalysisRun> {
    const run = await this.run(tx, lease.run.org_id, lease.run.run_id, true);
    await this.auth(tx, run.created_by, run.org_id, true);
    const owner = await tx.query('SELECT worker_id FROM runs WHERE org_id=$1 AND id=$2', [
      run.org_id,
      run.run_id,
    ]);
    if (
      run.status !== 'running' ||
      run.fencing_token !== lease.fencing_token ||
      run.lease_until! <= now() ||
      owner[0]?.worker_id !== lease.worker_id
    )
      fail('LEASE_LOST', 409);
    return run;
  }
  async assertLease(lease: Lease) {
    await this.db.transaction(async (tx) => {
      await this.fenced(tx, lease);
    });
  }
  async renewLease(lease: Lease, ms = 30000) {
    await this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      run.lease_until = new Date(Date.now() + ms).toISOString();
      await this.updateRun(tx, run, lease.worker_id);
    });
  }
  private querySpec(request: AnalysisRequest) {
    return {
      sql: 'WITH targets(target_date) AS (VALUES (CAST($2 AS date)),(CAST($2 AS date)-7),(CAST($2 AS date)-30),(CAST($2 AS date)-90)), ranked AS (SELECT DISTINCT ON (t.target_date,s.unit_external_id) s.payload,s.snapshot_date,s.unit_external_id FROM targets t JOIN snapshots s ON s.org_id=$1 AND s.project_external_id=$3 AND s.snapshot_date<=t.target_date ORDER BY t.target_date,s.unit_external_id,s.snapshot_date DESC) SELECT DISTINCT payload,snapshot_date,unit_external_id FROM ranked ORDER BY snapshot_date,unit_external_id LIMIT 20001',
      parameters: [request.org_id, request.data_as_of, request.scope.project_external_id],
      row_limit: 20000,
      timeout_ms: 5000,
    };
  }
  private async selectLatest(tx: Driver, request: AnalysisRequest): Promise<QueryResult> {
    const spec = this.querySpec(request);
    await tx.query("SET LOCAL statement_timeout = '5s'");
    const rows = (await tx.query(spec.sql, spec.parameters)).map(json) as UnitSnapshot[];
    if (rows.length > spec.row_limit) fail('QUERY_ROW_LIMIT_EXCEEDED', 422);
    return { ...spec, rows };
  }
  async getMetricConfig(lease: Lease) {
    return this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      const rows = await tx.query(
        'SELECT slow_moving_threshold_days FROM runs WHERE org_id=$1 AND id=$2',
        [run.org_id, run.run_id],
      );
      return { slow_moving_threshold_days: Number(rows[0].slow_moving_threshold_days) };
    });
  }
  async deleteDefinition(user: string, org: string, id: string) {
    await this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const def = await this.definition(tx, org, id);
      def.enabled = false;
      def.definition_version++;
      await this.saveDefinition(tx, def);
    });
  }
  async readSnapshots(lease: Lease): Promise<QueryResult> {
    return this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      const sql =
        'SELECT s.payload FROM snapshots s JOIN run_snapshots r ON r.org_id=s.org_id AND r.snapshot_id=s.id WHERE r.org_id=$1 AND r.run_id=$2 ORDER BY s.snapshot_date,s.unit_external_id LIMIT 20001';
      await tx.query("SET LOCAL statement_timeout = '5s'");
      const parameters = [run.org_id, run.run_id];
      const rows = (await tx.query(sql, parameters)).map(json) as UnitSnapshot[];
      if (rows.length > 20000) fail('QUERY_ROW_LIMIT_EXCEEDED', 422);
      return { sql, parameters, rows, row_limit: 20000, timeout_ms: 5000 };
    });
  }
  async storeArtifact(lease: Lease, input: Artifact): Promise<Artifact> {
    const artifact = ArtifactSchema.parse(input);
    verifyArtifact(artifact);
    return this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      if (artifact.org_id !== run.org_id || artifact.run_id !== run.run_id)
        fail('ARTIFACT_SCOPE_MISMATCH', 403);
      const prior = await tx.query(
        'SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2 AND kind=$3',
        [run.org_id, run.run_id, artifact.kind],
      );
      if (prior[0]) {
        const old = json(prior[0]) as Artifact;
        if (old.content_hash !== artifact.content_hash) fail('IMMUTABLE_ARTIFACT_CONFLICT', 409);
        return old;
      }
      await tx.query(
        'INSERT INTO artifacts(org_id,id,run_id,task_id,kind,payload) VALUES($1,$2,$3,$4,$5,$6)',
        [
          artifact.org_id,
          artifact.artifact_id,
          artifact.run_id,
          artifact.task_id,
          artifact.kind,
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
  async validateArtifact(lease: Lease, validation: ArtifactValidation) {
    await this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      if (validation.org_id !== run.org_id || validation.run_id !== run.run_id)
        fail('VALIDATION_SCOPE_MISMATCH', 403);
      await tx.query(
        'INSERT INTO validations(org_id,id,run_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,id) DO UPDATE SET payload=excluded.payload',
        [run.org_id, validation.artifact_id, run.run_id, JSON.stringify(validation)],
      );
    });
  }
  async setTask(lease: Lease, task: RunTask) {
    await this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      if (task.org_id !== run.org_id || task.run_id !== run.run_id)
        fail('TASK_SCOPE_MISMATCH', 403);
      await tx.query(
        'INSERT INTO tasks(org_id,id,run_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,id) DO UPDATE SET payload=excluded.payload',
        [run.org_id, task.task_id, run.run_id, JSON.stringify(task)],
      );
    });
  }
  async addEvent(lease: Lease, message: string, taskId?: string) {
    await this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
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
  private async assistantForRun(tx: Driver, run: AnalysisRun): Promise<Message> {
    const rows = await tx.query(
      `SELECT org_id,id,conversation_id,run_id,client_turn_id,role,status,created_at,updated_at,payload
       FROM messages WHERE org_id=$1 AND run_id=$2 AND role='assistant' FOR UPDATE`,
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
    await this.insertMessage(tx, assistant);
    return assistant;
  }
  private async finalizeRunAssistant(
    tx: Driver,
    run: AnalysisRun,
    result: {
      status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled' | 'in_progress'>;
      content: string;
      parts: MessagePart[];
    },
  ) {
    const assistant = await this.assistantForRun(tx, run);
    assistant.status = result.status;
    assistant.content = result.content;
    assistant.parts = result.parts;
    assistant.updated_at = now();
    await this.updateMessage(tx, assistant);
    await this.touchConversation(tx, run.org_id, assistant.conversation_id, assistant.updated_at);
  }
  async completeRun(lease: Lease, id: string) {
    await this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      const rows = await tx.query(
        'SELECT a.payload,v.payload AS validation FROM artifacts a JOIN validations v ON v.org_id=a.org_id AND v.id=a.id WHERE a.org_id=$1 AND a.run_id=$2 AND a.id=$3 AND a.kind=$4',
        [run.org_id, run.run_id, id, 'report'],
      );
      if (
        !rows[0] ||
        !(
          typeof rows[0].validation === 'string'
            ? JSON.parse(rows[0].validation)
            : rows[0].validation
        ).valid
      )
        fail('PUBLICATION_VALIDATION_REQUIRED', 422);
      const artifact = json(rows[0]) as Artifact;
      if (artifact.kind !== 'report') fail('INVALID_REPORT', 422);
      const allArtifacts = (
        await tx.query('SELECT payload FROM artifacts WHERE org_id=$1 AND run_id=$2', [
          run.org_id,
          run.run_id,
        ])
      ).map(json) as Artifact[];
      const allValidations = (
        await tx.query('SELECT payload FROM validations WHERE org_id=$1 AND run_id=$2', [
          run.org_id,
          run.run_id,
        ])
      ).map(json) as ArtifactValidation[];
      if (
        allArtifacts.some(
          (a) => !allValidations.some((v) => v.artifact_id === a.artifact_id && v.valid),
        )
      )
        fail('PUBLICATION_VALIDATION_REQUIRED', 422);
      validateReport(artifact.payload, allArtifacts, run.org_id, run.run_id);
      run.status = 'succeeded';
      run.report_artifact_id = id;
      run.lease_until = null;
      await this.updateRun(tx, run);
      const report: ReportRecord = {
        report_id: randomUUID(),
        org_id: run.org_id,
        run_id: run.run_id,
        artifact_id: id,
        created_at: now(),
        occurrence_id: run.occurrence_id,
      };
      await tx.query(
        'INSERT INTO reports(org_id,id,run_id,artifact_id,payload) VALUES($1,$2,$3,$4,$5)',
        [run.org_id, report.report_id, run.run_id, id, JSON.stringify(report)],
      );
      await this.finalizeRunAssistant(tx, run, {
        status: 'completed',
        content: artifact.payload.summary,
        parts: [
          { type: 'text', text: artifact.payload.summary },
          { type: 'run_ref', run_id: run.run_id, status: 'succeeded' },
          { type: 'report_ref', run_id: run.run_id, report_id: report.report_id },
          ...allArtifacts.map((item) => ({
            type: 'artifact_ref' as const,
            run_id: run.run_id,
            artifact_id: item.artifact_id,
            kind: item.kind,
          })),
        ],
      });
    });
  }
  async failRun(lease: Lease, code: string) {
    await this.db.transaction(async (tx) => {
      const run = await this.fenced(tx, lease);
      run.status = 'failed';
      run.error_code = code;
      run.lease_until = null;
      await this.updateRun(tx, run);
      await this.finalizeRunAssistant(tx, run, {
        status: 'failed',
        content: 'Lượt phân tích không thể hoàn tất.',
        parts: [
          { type: 'text', text: 'Lượt phân tích không thể hoàn tất.' },
          { type: 'run_ref', run_id: run.run_id, status: 'failed' },
          { type: 'error', code, retryable: true },
        ],
      });
    });
  }
  async listReports(user: string, org: string): Promise<ReportRecord[]> {
    return (await this.readList<ReportRecord>(user, org, 'reports')).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }
  async getReport(user: string, org: string, id: string) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = await tx.query('SELECT payload FROM reports WHERE org_id=$1 AND id=$2', [
        org,
        id,
      ]);
      if (!rows[0]) fail('REPORT_NOT_FOUND', 404);
      const report = json(rows[0]) as ReportRecord;
      const artifacts = await tx.query('SELECT payload FROM artifacts WHERE org_id=$1 AND id=$2', [
        org,
        report.artifact_id,
      ]);
      return { report, artifact: json(artifacts[0]) as Artifact };
    });
  }
  async createDefinition(user: string, input: ReportDefinitionInput, date = new Date()) {
    return this.db.transaction(async (tx) => {
      const parsed = ReportDefinitionInputSchema.parse(input);
      await this.auth(tx, user, parsed.org_id, true);
      const def: ReportDefinition = {
        ...parsed,
        report_definition_id: randomUUID(),
        definition_version: 1,
        created_by: user,
        created_at: now(),
        next_run_at: nextScheduledAt(parsed, date),
      };
      await tx.query(
        'INSERT INTO definitions(org_id,id,created_by,next_run_at,enabled,payload) VALUES($1,$2,$3,$4,$5,$6)',
        [
          def.org_id,
          def.report_definition_id,
          user,
          def.next_run_at,
          Number(def.enabled),
          JSON.stringify(def),
        ],
      );
      return def;
    });
  }
  async storeReportExport(
    user: string,
    org: string,
    reportId: string,
    format: 'json' | 'csv',
    contentHash: string,
    body: string,
    contentType: string,
  ): Promise<{ storage_path: string }> {
    const storagePath = `${org}/${reportId}/${contentHash}.${format}`;
    await this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, false);
      const record = await tx.query('SELECT payload FROM reports WHERE org_id=$1 AND id=$2', [
        org,
        reportId,
      ]);
      if (!record[0]) fail('REPORT_NOT_FOUND', 404);
    });
    try {
      await this.storage().upload({
        bucket: 'report-exports',
        path: storagePath,
        body,
        contentType,
        allowExisting: true,
      });
    } catch (error) {
      if (error instanceof StorageError)
        fail(error.code, error.code === 'STORAGE_CONFIG_REQUIRED' ? 503 : 502);
      throw error;
    }
    await this.db.transaction(async (tx) => {
      // Export is a read entitlement; the ledger is a server-owned projection.
      await this.auth(tx, user, org, false);
      const record = await tx.query('SELECT payload FROM reports WHERE org_id=$1 AND id=$2', [
        org,
        reportId,
      ]);
      if (!record[0]) fail('REPORT_NOT_FOUND', 404);
      if (!storagePath.startsWith(`${org}/${reportId}/`)) fail('EXPORT_PATH_MISMATCH', 403);
      await tx.query('RESET ROLE');
      await tx.query(
        'INSERT INTO report_exports(org_id,report_id,format,storage_path,content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,report_id,format) DO NOTHING',
        [org, reportId, format, storagePath, contentHash, now()],
      );
    });
    return { storage_path: storagePath };
  }
  async updateDefinition(
    user: string,
    org: string,
    id: string,
    input: ReportDefinitionInput,
    date = new Date(),
  ) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const old = await this.definition(tx, org, id);
      const parsed = ReportDefinitionInputSchema.parse(input);
      if (parsed.org_id !== org) fail('DEFINITION_SCOPE_MISMATCH', 403);
      const def = {
        ...old,
        ...parsed,
        definition_version: old.definition_version + 1,
        next_run_at: nextScheduledAt(parsed, date),
      };
      await this.saveDefinition(tx, def);
      return def;
    });
  }
  async listDefinitions(user: string, org: string): Promise<ReportDefinition[]> {
    return this.readList(user, org, 'definitions');
  }
  private async definition(tx: Driver, org: string, id: string): Promise<ReportDefinition> {
    const rows = await tx.query(
      'SELECT payload FROM definitions WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [org, id],
    );
    if (!rows[0]) fail('DEFINITION_NOT_FOUND', 404);
    return json(rows[0]) as ReportDefinition;
  }
  private async saveDefinition(tx: Driver, def: ReportDefinition) {
    await tx.query(
      'UPDATE definitions SET next_run_at=$1,enabled=$2,payload=$3 WHERE org_id=$4 AND id=$5',
      [
        def.next_run_at,
        Number(def.enabled),
        JSON.stringify(def),
        def.org_id,
        def.report_definition_id,
      ],
    );
  }
  private async occurrence(
    tx: Driver,
    def: ReportDefinition,
    scheduled: string,
  ): Promise<ReportOccurrence> {
    await this.auth(tx, def.created_by, def.org_id, true);
    const existing = await tx.query(
      'SELECT payload FROM occurrences WHERE org_id=$1 AND definition_id=$2 AND scheduled_for=$3',
      [def.org_id, def.report_definition_id, scheduled],
    );
    if (existing[0]) return json(existing[0]) as ReportOccurrence;
    let asOf = localDate(new Date(scheduled), def.timezone);
    if (def.data_as_of_policy === 'previous_day')
      asOf = new Date(new Date(`${asOf}T00:00:00Z`).getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
    const id = randomUUID();
    const run = await this.buildRun(
      tx,
      def.created_by,
      {
        org_id: def.org_id,
        scope: def.scope,
        data_as_of: asOf,
        question: `Báo cáo hằng ngày: ${def.name}`,
        conversation_id: null,
      },
      `schedule:${def.report_definition_id}:${scheduled}`,
      { entrypoint: 'scheduled', occurrence_id: id },
    );
    const occurrence: ReportOccurrence = {
      occurrence_id: id,
      org_id: def.org_id,
      report_definition_id: def.report_definition_id,
      definition_version: def.definition_version,
      definition_snapshot: def,
      scheduled_for: scheduled,
      run_id: run.run_id,
      created_at: now(),
    };
    await tx.query(
      'INSERT INTO occurrences(org_id,id,definition_id,scheduled_for,run_id,payload) VALUES($1,$2,$3,$4,$5,$6)',
      [def.org_id, id, def.report_definition_id, scheduled, run.run_id, JSON.stringify(occurrence)],
    );
    return occurrence;
  }
  async triggerDefinition(user: string, org: string, id: string, date = new Date()) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const def = await this.definition(tx, org, id);
      const day = localDate(date, def.timezone);
      const scheduled = scheduledOnDate(def, day);
      return this.occurrence(tx, def, scheduled);
    });
  }
  async tick(
    date = new Date(),
    scope?: { userId: string; orgId: string },
  ): Promise<ReportOccurrence[]> {
    return this.db.transaction(async (tx) => {
      if (scope) await this.auth(tx, scope.userId, scope.orgId, true);
      const rows = await tx.query(
        `SELECT payload FROM definitions WHERE enabled=1 AND next_run_at<=$1${scope ? ' AND org_id=$2' : ''} FOR UPDATE SKIP LOCKED`,
        scope ? [date.toISOString(), scope.orgId] : [date.toISOString()],
      );
      const result: ReportOccurrence[] = [];
      for (const row of rows) {
        const def = json(row) as ReportDefinition;
        try {
          await this.auth(tx, def.created_by, def.org_id, true);
        } catch {
          def.enabled = false;
          await this.saveDefinition(tx, def);
          continue;
        }
        result.push(await this.occurrence(tx, def, def.next_run_at));
        def.next_run_at = nextScheduledAt(def, date);
        await this.saveDefinition(tx, def);
      }
      return result;
    });
  }
}
