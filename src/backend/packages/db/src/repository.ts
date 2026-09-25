import { createHash, randomUUID } from 'node:crypto';
import {
  WorkflowVersionSchema,
  type AnalysisRequest,
  type AnalysisRun,
  type AgentKey,
  type AgentTurnRequest,
  type AgentExecutionStatus,
  type Artifact,
  type ArtifactValidation,
  type Catalog,
  type Conversation,
  type ConversationPage,
  type DecisionBriefResponse,
  type DecisionIntelligenceResponse,
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
  type RunTask,
  type Session,
  type UnitSnapshot,
  type WorkflowVersion,
} from '@vda/contracts';
import { postgresDriver, type Driver } from './driver';
import { authorizeInTransaction, readSession } from './authorization/authorization-repository';
import { fail } from './errors';
import { buildRun as buildRunTransaction } from './transactions/create-run';
import { publishLegacyReport } from './transactions/publish-legacy-report';
import { publishReviewedDraft } from './transactions/publish-reviewed-draft';
import { failRun } from './workflow/fail-run';
import { LEGACY_WORKFLOW_VERSION } from './mapping/run';
import { readCatalog } from './repositories/catalog-repository';
import {
  storeArtifact,
  validateArtifact,
  setTask,
  addEvent,
  findRunAssistant,
  upsertStageMessage,
  finishRunAssistant,
} from './workflow/checkpoint-repository';
import {
  claimNextRun,
  fenceRun,
  assertRunLease,
  renewRunLease,
  readMetricConfig,
  readPinnedSnapshots,
} from './workflow/lease-repository';
import {
  updateRun as updateRunRecord,
  cancelRun as cancelRunLifecycle,
  retryRun as retryRunLifecycle,
  selectLatest as selectLatestSnapshots,
} from './repositories/run-repository';
import { ConversationRepository } from './repositories/conversation-repository';
import { AgentExecutionRepository } from './repositories/agent-execution-repository';
import { ScheduleRepository } from './repositories/schedule-repository';
import {
  artifacts,
  artifactByKey,
  publicArtifactById,
  publicArtifactsByIds,
  decisionBrief,
  decisionIntelligence,
} from './repositories/artifact-repository';
import { TEST_ORGS, TEST_USERS, syntheticRows } from './seed';
import { type StorageUploader } from './storage';
import {
  importCsv as importInventoryCsv,
  insertSnapshot as writeSnapshot,
  listImports as readImports,
} from './repositories/import-repository';
import {
  getReport as readReport,
  listReports as readReports,
  storeReportExport as writeReportExport,
} from './repositories/report-repository';
import {
  getRun as readRunWithEvents,
  listRuns as readRuns,
  readRun,
} from './repositories/run-repository';
import {
  type AgentTurn,
  type AgentJobLease,
  type AgentStageMessageInput,
  type ArtifactStoreOptions,
  type Lease,
  type Repository,
  type QueryResult,
  type ReviewedDraftPublication,
  type TurnContext,
} from './types';

export { RepositoryError } from './errors';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
export interface RepositoryOptions {
  databaseUrl?: string;
  storageUrl?: string;
  storageKey?: string;
  storage?: StorageUploader;
  /** Test-only fixture seeding. Production startup never calls this. */
  seedTestData?: boolean;
  /** Server-owned selection for newly created runs; existing runs retain their stored version. */
  workflowVersion?: WorkflowVersion;
  driver?: Driver;
}
export async function createRepository(options: RepositoryOptions = {}): Promise<Repository> {
  const url = options.databaseUrl ?? process.env.SUPABASE_DB_URL;
  if (!url && !options.driver) fail('SUPABASE_DB_URL_REQUIRED', 503);
  const db = options.driver ?? postgresDriver(url!);
  const workflowVersion = WorkflowVersionSchema.parse(
    options.workflowVersion ?? LEGACY_WORKFLOW_VERSION,
  );
  const repo = new SqlRepository(db, { ...options, workflowVersion });
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
  async hasAgentExecutionSchema() {
    const rows = await this.db.query("SELECT to_regclass('public.agent_turn_jobs') AS table_name");
    return rows[0]?.table_name != null;
  }
  private conversation() {
    return new ConversationRepository(this.db);
  }
  private agentExecution() {
    return new AgentExecutionRepository(this.db, (tx,user,request,key,turn) =>
      this.buildRun(tx,user,request,key,{entrypoint:'interactive',turn,workflowVersion:'agent-v1'}));
  }
  private schedule() {
    return new ScheduleRepository(this.db, (tx, user, input, key, options) =>
      this.buildRun(tx, user, input, key, options),
    );
  }
  async auth(tx: Driver, user: string, org: string, write = false): Promise<Role> {
    return authorizeInTransaction(tx, user, org, write);
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
    return readSession(this.db, user, email);
  }
  async catalog(user: string, org: string): Promise<Catalog> {
    return readCatalog(this.db, user, org);
  }
  async insertSnapshot(tx: Driver, row: UnitSnapshot) {
    return writeSnapshot(tx, row);
  }
  async importCsv(
    user: string,
    input: { org_id: string; source_name: string; csv: string },
  ): Promise<ImportManifest> {
    return importInventoryCsv(this.db, this.options, user, input);
  }
  async listImports(user: string, org: string): Promise<ImportManifest[]> {
    return readImports(this.db, user, org);
  }
  private async createConversation(
    tx: Driver,
    user: string,
    org: string,
    kind: Conversation['kind'],
    title: string,
  ): Promise<Conversation> {
    return this.conversation().createConversation(tx, user, org, kind, title);
  }
  private async touchConversation(tx: Driver, org: string, id: string, date = now()) {
    return this.conversation().touchConversation(tx, org, id, date);
  }
  private async insertMessage(
    tx: Driver,
    message: Message,
    payloadExtra: Record<string, unknown> = {},
  ) {
    return this.conversation().insertMessage(tx, message, payloadExtra);
  }
  private async updateMessage(tx: Driver, message: Message) {
    return this.conversation().updateMessage(tx, message);
  }
  private async message(tx: Driver, org: string, id: string, lock = false): Promise<Message> {
    return this.conversation().message(tx, org, id, lock);
  }
  private async attachRunMessages(tx: Driver, run: AnalysisRun, context: TurnContext) {
    return this.conversation().attachRunMessages(tx, run, context);
  }
  private async createRunMessages(tx: Driver, run: AnalysisRun) {
    return this.conversation().createRunMessages(tx, run);
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
      workflowVersion?: WorkflowVersion;
    } = {},
  ): Promise<AnalysisRun> {
    return buildRunTransaction(
      tx,
      user,
      input,
      key,
      {
        workflowVersion: options.workflowVersion ?? this.options.workflowVersion ?? LEGACY_WORKFLOW_VERSION,
        createConversation: (tx, actor, org, kind, title) =>
          this.createConversation(tx, actor, org, kind, title),
        selectLatest: (tx, request) => this.selectLatest(tx, request),
        attachRunMessages: (tx, run, context) => this.attachRunMessages(tx, run, context),
        createRunMessages: (tx, run) => this.createRunMessages(tx, run),
      },
      options,
    );
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
    return readRuns(this.db, user, org);
  }
  async getRun(user: string, org: string, id: string) {
    return readRunWithEvents(this.db, user, org, id);
  }
  private async run(tx: Driver, org: string, id: string, lock = false): Promise<AnalysisRun> {
    return readRun(tx, org, id, lock);
  }
  private async updateRun(tx: Driver, run: AnalysisRun, worker: string | null = null) {
    return updateRunRecord(tx, run, worker);
  }
  async cancelRun(user: string, org: string, id: string) {
    return cancelRunLifecycle(
      this.db,
      (tx, run, result) => this.finalizeRunAssistant(tx, run, result),
      user,
      org,
      id,
    );
  }
  async retryRun(user: string, org: string, id: string) {
    return retryRunLifecycle(
      this.db,
      (tx, run, result) => this.finalizeRunAssistant(tx, run, result),
      user,
      org,
      id,
    );
  }
  async messages(user: string, org: string, id: string): Promise<Message[]> {
    return this.conversation().messages(user, org, id);
  }
  async getConversation(user: string, org: string, id: string): Promise<Conversation> {
    return this.conversation().getConversation(user, org, id);
  }
  async listConversations(
    user: string,
    org: string,
    pageInput: PageRequest,
  ): Promise<ConversationPage> {
    return this.conversation().listConversations(user, org, pageInput);
  }
  async listMessages(
    user: string,
    org: string,
    conversationId: string,
    pageInput: PageRequest,
  ): Promise<MessagePage> {
    return this.conversation().listMessages(user, org, conversationId, pageInput);
  }

  async startTurn(
    user: string,
    inputValue: AgentTurnRequest,
    idempotencyKey: string,
    requestedConversationId?: string,
  ): Promise<AgentTurn> {
    return this.conversation().startTurn(user, inputValue, idempotencyKey, requestedConversationId);
  }
  enqueueAgentTurn(user: string, input: AgentTurnRequest, key: string, conversationId?: string) {
    return this.agentExecution().enqueue(user,input,key,conversationId);
  }
  getAgentTurnJob(user: string, org: string, id: string, after = 0) {
    return this.agentExecution().get(user,org,id,after);
  }
  getLatestAgentTurnJob(user: string, org: string, conversationId: string) {
    return this.agentExecution().getLatestForConversation(user,org,conversationId);
  }
  cancelAgentTurnJob(user: string, org: string, id: string) {
    return this.agentExecution().cancel(user,org,id);
  }
  claimAgentTurnJob(worker: string, date?: Date, leaseMs?: number) {
    return this.agentExecution().claim(worker,date,leaseMs);
  }
  renewAgentTurnLease(lease: AgentJobLease, leaseMs?: number) {
    return this.agentExecution().renew(lease,leaseMs);
  }
  startAgentAnalysis(lease: AgentJobLease) {
    return this.agentExecution().startAnalysis(lease);
  }
  resumeAgentAnalysis(lease: AgentJobLease) {
    return this.agentExecution().resumeAnalysis(lease);
  }
  failAgentTurnJob(lease: AgentJobLease, code: string) {
    return this.agentExecution().fail(lease,code);
  }
  completeAgentTurnJob(lease: AgentJobLease, content: string) {
    return this.agentExecution().complete(lease,content);
  }
  waitAgentTurnForRun(lease: AgentJobLease, runId: string) {
    return this.agentExecution().waitForRun(lease,runId);
  }
  createAgentInvocation(lease: AgentJobLease, parentId: string, stepKey: string, agentKey: string) {
    return this.agentExecution().createInvocation(lease,parentId,stepKey,agentKey);
  }
  setAgentInvocationStatus(lease: AgentJobLease, invocationId: string, status: AgentExecutionStatus) {
    return this.agentExecution().setInvocationStatus(lease,invocationId,status);
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
      sender_agent?: AgentKey | null;
    },
  ): Promise<Message> {
    return this.conversation().finalizeTurn(user, context, result);
  }
  async artifacts(user: string, org: string, id: string) {
    return artifacts(this.db, user, org, id);
  }
  async artifactByKey(user: string, org: string, runId: string, key: string): Promise<Artifact> {
    return artifactByKey(this.db, user, org, runId, key);
  }
  async publicArtifactById(
    user: string,
    org: string,
    runId: string,
    artifactId: string,
  ): Promise<Artifact> {
    return publicArtifactById(this.db, user, org, runId, artifactId);
  }
  async publicArtifactsByIds(
    user: string,
    org: string,
    runId: string,
    artifactIds: readonly string[],
  ): Promise<Artifact[]> {
    return publicArtifactsByIds(this.db, user, org, runId, artifactIds);
  }
  async decisionBrief(user: string, org: string, id: string): Promise<DecisionBriefResponse> {
    return decisionBrief(this.db, user, org, id);
  }
  async decisionIntelligence(
    user: string,
    org: string,
    id: string,
  ): Promise<DecisionIntelligenceResponse> {
    return decisionIntelligence(this.db, user, org, id);
  }
  async claimRun(worker: string, date = new Date(), leaseMs = 30000): Promise<Lease | null> {
    return claimNextRun(this.db, worker, date, leaseMs);
  }
  private async fenced(tx: Driver, lease: Lease): Promise<AnalysisRun> {
    return fenceRun(tx, lease);
  }
  async assertLease(lease: Lease) {
    return assertRunLease(this.db, lease);
  }
  async renewLease(lease: Lease, ms = 30000) {
    return renewRunLease(this.db, lease, ms);
  }

  private async selectLatest(tx: Driver, request: AnalysisRequest): Promise<QueryResult> {
    return selectLatestSnapshots(tx, request);
  }
  async getMetricConfig(lease: Lease) {
    return readMetricConfig(this.db, lease);
  }
  async deleteDefinition(user: string, org: string, id: string) {
    return this.schedule().deleteDefinition(user, org, id);
  }
  async readSnapshots(lease: Lease): Promise<QueryResult> {
    return readPinnedSnapshots(this.db, lease);
  }
  async storeArtifact(
    lease: Lease,
    input: Artifact,
    options: ArtifactStoreOptions = {},
  ): Promise<Artifact> {
    return storeArtifact(this.db, lease, input, options);
  }
  async validateArtifact(lease: Lease, validation: ArtifactValidation) {
    return validateArtifact(this.db, lease, validation);
  }
  async setTask(lease: Lease, task: RunTask) {
    return setTask(this.db, lease, task);
  }
  async addEvent(lease: Lease, message: string, taskId?: string) {
    return addEvent(this.db, lease, message, taskId);
  }
  private async assistantForRun(tx: Driver, run: AnalysisRun): Promise<Message> {
    return findRunAssistant(tx, run);
  }
  async upsertStageMessage(lease: Lease, input: AgentStageMessageInput): Promise<Message> {
    return upsertStageMessage(this.db, lease, input);
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
    return finishRunAssistant(tx, run, result);
  }
  async completeRun(lease: Lease, id: string) {
    return publishLegacyReport(this.db, lease, id);
  }
  /**
   * The agent workflow publishes only through this short, fenced transaction.
   * It re-reads the exact immutable draft/review graph before creating the
   * final legacy-compatible report marker and terminal assistant message.
   */
  async publishReviewedDraft(lease: Lease, input: ReviewedDraftPublication): Promise<ReportRecord> {
    return publishReviewedDraft(this.db, lease, input);
  }
  async failRun(lease: Lease, code: string) {
    return failRun(this.db, lease, code);
  }
  async listReports(user: string, org: string): Promise<ReportRecord[]> {
    return readReports(this.db, user, org);
  }
  async getReport(user: string, org: string, id: string) {
    return readReport(this.db, user, org, id);
  }
  async createDefinition(user: string, input: ReportDefinitionInput, date = new Date()) {
    return this.schedule().createDefinition(user, input, date);
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
    return writeReportExport(
      this.db,
      this.options,
      user,
      org,
      reportId,
      format,
      contentHash,
      body,
      contentType,
    );
  }
  async updateDefinition(
    user: string,
    org: string,
    id: string,
    input: ReportDefinitionInput,
    date = new Date(),
  ) {
    return this.schedule().updateDefinition(user, org, id, input, date);
  }
  async listDefinitions(user: string, org: string): Promise<ReportDefinition[]> {
    return this.schedule().listDefinitions(user, org);
  }

  async triggerDefinition(user: string, org: string, id: string, date = new Date()) {
    return this.schedule().triggerDefinition(user, org, id, date);
  }
  async tick(
    date = new Date(),
    scope?: { userId: string; orgId: string },
  ): Promise<ReportOccurrence[]> {
    return this.schedule().tick(date, scope);
  }
}
