import type {
  AnalysisRequest,
  AnalysisRun,
  AgentKey,
  AgentTurnRequest,
  Artifact,
  ArtifactOf,
  ArtifactValidation,
  Catalog,
  Conversation,
  ConversationPage,
  DecisionBriefResponse,
  DecisionIntelligenceResponse,
  ImportManifest,
  Message,
  MessagePage,
  MessagePart,
  MessageStatus,
  PageRequest,
  ReportDefinition,
  ReportDefinitionInput,
  ReportOccurrence,
  ReportRecord,
  Role,
  RunEvent,
  RunTask,
  Session,
  UnitSnapshot,
} from '@vda/contracts';
export interface Lease {
  run: AnalysisRun;
  worker_id: string;
  fencing_token: number;
}
export interface AgentTurn {
  conversation: Conversation;
  user_message: Message;
  assistant_message: Message;
  idempotent_replay: boolean;
}
export interface TurnContext {
  org_id: string;
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  client_turn_id: string;
}
export interface QueryResult {
  rows: UnitSnapshot[];
  sql: string;
  parameters: (string | null)[];
  row_limit: number;
  timeout_ms: number;
}

/**
 * The database key is deliberately kept outside the immutable artifact payload.
 * Legacy artifacts therefore continue to hash and parse exactly as they did when
 * their logical key is derived from `kind`.
 */
export interface ArtifactStoreOptions {
  artifact_key?: string;
}

export interface ReviewedDraftPublication {
  draft_artifact_id: string;
  review_artifact_id: string;
  /** Must be the fenced, running publication checkpoint. */
  publication_task: RunTask;
  report: ArtifactOf<'report'>;
}

/**
 * A specialized agent checkpoint is a reference-only shared chat update.
 * Repository code creates its parts from the fenced run and rejects private
 * draft/review artifacts, so callers cannot accidentally copy canonical data
 * or private workflow content into the conversation.
 */
export interface AgentStageMessageInput {
  sender_agent: AgentKey;
  content: string;
  artifact?: Artifact;
}

export function normalizeArtifactKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 160) throw new Error('INVALID_ARTIFACT_KEY');
  return key;
}

export function logicalArtifactKey(
  artifact: Pick<Artifact, 'kind'>,
  options: ArtifactStoreOptions = {},
): string {
  return normalizeArtifactKey(options?.artifact_key ?? artifact.kind);
}

export interface Repository {
  close(): Promise<void>;
  session(userId: string, email?: string): Promise<Session>;
  authorize(userId: string, orgId: string, write?: boolean): Promise<Role>;
  catalog(userId: string, orgId: string): Promise<Catalog>;
  importCsv(
    userId: string,
    input: { org_id: string; source_name: string; csv: string },
  ): Promise<ImportManifest>;
  listImports(userId: string, orgId: string): Promise<ImportManifest[]>;
  createRun(
    userId: string,
    request: AnalysisRequest,
    key: string,
    options?: { entrypoint?: 'interactive' | 'scheduled'; occurrence_id?: string },
  ): Promise<AnalysisRun>;
  listRuns(userId: string, orgId: string): Promise<AnalysisRun[]>;
  getRun(
    userId: string,
    orgId: string,
    runId: string,
  ): Promise<{ run: AnalysisRun; tasks: RunTask[]; events: RunEvent[] }>;
  cancelRun(userId: string, orgId: string, runId: string): Promise<void>;
  retryRun(userId: string, orgId: string, runId: string): Promise<AnalysisRun>;
  messages(userId: string, orgId: string, conversationId: string): Promise<Message[]>;
  listConversations(userId: string, orgId: string, page: PageRequest): Promise<ConversationPage>;
  getConversation(userId: string, orgId: string, conversationId: string): Promise<Conversation>;
  listMessages(
    userId: string,
    orgId: string,
    conversationId: string,
    page: PageRequest,
  ): Promise<MessagePage>;
  startTurn(
    userId: string,
    input: AgentTurnRequest,
    idempotencyKey: string,
    conversationId?: string,
  ): Promise<AgentTurn>;
  attachRunToTurn(
    userId: string,
    context: TurnContext,
    request: AnalysisRequest,
    idempotencyKey: string,
  ): Promise<AnalysisRun>;
  finalizeTurn(
    userId: string,
    context: TurnContext,
    result: {
      status: Extract<MessageStatus, 'completed' | 'failed' | 'cancelled'>;
      content: string;
      parts: MessagePart[];
      /** A bounded @Agent follow-up may attribute its existing turn reply. */
      sender_agent?: AgentKey | null;
    },
  ): Promise<Message>;
  artifacts(
    userId: string,
    orgId: string,
    runId: string,
  ): Promise<{
    artifacts: Artifact[];
    validations: ArtifactValidation[];
    sources: ImportManifest[];
  }>;
  artifactByKey(
    userId: string,
    orgId: string,
    runId: string,
    artifactKey: string,
  ): Promise<Artifact>;
  decisionBrief(userId: string, orgId: string, runId: string): Promise<DecisionBriefResponse>;
  decisionIntelligence(
    userId: string,
    orgId: string,
    runId: string,
  ): Promise<DecisionIntelligenceResponse>;
  claimRun(workerId: string, now?: Date, leaseMs?: number): Promise<Lease | null>;
  renewLease(lease: Lease, leaseMs?: number): Promise<void>;
  assertLease(lease: Lease): Promise<void>;
  readSnapshots(lease: Lease): Promise<QueryResult>;
  getMetricConfig(lease: Lease): Promise<{ slow_moving_threshold_days: number }>;
  storeArtifact(
    lease: Lease,
    artifact: Artifact,
    options?: ArtifactStoreOptions,
  ): Promise<Artifact>;
  validateArtifact(lease: Lease, validation: ArtifactValidation): Promise<void>;
  setTask(lease: Lease, task: RunTask): Promise<void>;
  addEvent(lease: Lease, message: string, taskId?: string): Promise<void>;
  upsertStageMessage(lease: Lease, input: AgentStageMessageInput): Promise<Message>;
  completeRun(lease: Lease, reportArtifactId: string): Promise<void>;
  publishReviewedDraft(lease: Lease, input: ReviewedDraftPublication): Promise<ReportRecord>;
  failRun(lease: Lease, errorCode: string): Promise<void>;
  listReports(userId: string, orgId: string): Promise<ReportRecord[]>;
  getReport(
    userId: string,
    orgId: string,
    reportId: string,
  ): Promise<{ report: ReportRecord; artifact: Artifact }>;
  storeReportExport(
    userId: string,
    orgId: string,
    reportId: string,
    format: 'json' | 'csv',
    hash: string,
    body: string,
    contentType: string,
  ): Promise<{ storage_path: string }>;
  createDefinition(
    userId: string,
    input: ReportDefinitionInput,
    now?: Date,
  ): Promise<ReportDefinition>;
  updateDefinition(
    userId: string,
    orgId: string,
    id: string,
    input: ReportDefinitionInput,
    now?: Date,
  ): Promise<ReportDefinition>;
  listDefinitions(userId: string, orgId: string): Promise<ReportDefinition[]>;
  deleteDefinition(userId: string, orgId: string, id: string): Promise<void>;
  triggerDefinition(
    userId: string,
    orgId: string,
    id: string,
    now?: Date,
  ): Promise<ReportOccurrence>;
  tick(now?: Date, scope?: { userId: string; orgId: string }): Promise<ReportOccurrence[]>;
}
