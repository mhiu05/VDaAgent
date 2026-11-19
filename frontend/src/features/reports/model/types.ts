/** Feature-owned demo contracts. These are not the pending Shell contract or API DTOs. */
export type Role = 'USER' | 'ADMIN';
export interface Principal {
  id: string;
  role: Role | 'unknown';
  projectIds: readonly string[];
  reportIds: readonly string[];
}
export interface Clock { now(): Date }
export interface DateRange { from: string; to: string; timezone: string }
export interface ReportScope extends DateRange { market?: string; project?: string }
export interface SourceMeta {
  id: string;
  mode: 'mock' | 'api';
  label: string;
  dataThrough: string;
  updatedAt: string;
  completeness: 'full' | 'partial' | 'missing';
}
export type ErrorCode = 'forbidden' | 'notFound' | 'validation' | 'conflict' | 'unavailable' | 'timeout';
export class RepositoryError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.code = code; this.name = 'RepositoryError'; }
}
export type ReportType = string;
export type ReportStatus = 'completed' | 'generating' | 'failed' | 'draft' | 'unsupported';
export interface GenerationAttempt {
  id: string;
  reportId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
  createdAt: string;
  finishedAt: string | null;
  versionId: string | null;
}
export interface ReportRecord {
  id: string;
  code: string;
  title: string;
  type: ReportType;
  projectIds: readonly string[];
  marketIds: readonly string[];
  author: { id: string; name: string };
  agent: string;
  createdAt: string;
  versionIds: readonly string[];
  latestAttemptId: string | null;
}
export interface Evidence {
  id: string;
  sourceId: string;
  label: string;
  projectIds: readonly string[];
  snapshotId: string | null;
  dataThrough: string;
  limitation: string;
}
export type ReportBlock =
  | { id: string; kind: 'text' | 'methodology' | 'limitations'; title: string; paragraphs: readonly string[] }
  | { id: string; kind: 'finding' | 'recommendation'; title: string; text: string; evidenceIds: readonly string[] }
  | { id: string; kind: 'metric-table' | 'comparison'; title: string; columns: readonly string[]; rows: readonly (readonly (string | number | null)[])[]; unit: string }
  | { id: string; kind: 'chart'; chartType?: 'bar' | 'line' | 'area'; title: string; question: string; unit: string; labels: readonly string[]; values: readonly (number | null)[]; sourceId: string };
export interface ReportVersion {
  schema?: import('./report-schema').ReportSchema;
  schemaIssue?: string;
  id: string;
  reportId: string;
  sequence: number;
  completedAt: string;
  source: SourceMeta;
  policyVersion: string;
  contentRevision: string;
  sections: readonly ReportBlock[];
  evidenceIds: readonly string[];
  artifactIds: readonly string[];
}
export interface Artifact {
  id: string;
  versionId: string;
  filename: string;
  /** HTML/CSV in the mock; the API also serves PDF, DOCX and XLSX artifacts (doc 19). */
  mediaType: 'text/html' | 'text/csv' | 'application/pdf'
    | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  content: string;
}
export interface ReportDataset {
  projects: readonly { id: string; name: string }[];
  records: readonly ReportRecord[];
  versions: readonly ReportVersion[];
  attempts: readonly GenerationAttempt[];
  evidence: readonly Evidence[];
  artifacts: readonly Artifact[];
  source: SourceMeta;
}
export interface ReportSummary {
  record: ReportRecord;
  status: ReportStatus;
  latestVersion: ReportVersion | null;
  matchedVersion: ReportVersion | null;
  latestAttempt: GenerationAttempt | null;
}
export interface ReportQuery {
  q: string;
  types: readonly ReportType[];
  statuses: readonly ReportStatus[];
  markets: readonly string[];
  projects: readonly string[];
  authors: readonly string[];
  agents: readonly string[];
  dateField: 'createdAt' | 'completedAt';
  from?: string;
  to?: string;
  timezone: string;
  sort: 'createdAt' | 'completedAt' | 'title' | 'status';
  direction: 'asc' | 'desc';
  page: number;
  pageSize: 25 | 50 | 100;
}
export interface Page<T> { rows: T[]; totalRows: number; page: number; pageSize: number; pageCount: number }
export interface ReportAggregate { distinctReports: number; completedVersions: number; source: SourceMeta }
export interface ReportDetail {
  summary: ReportSummary;
  version: ReportVersion | null;
  versions: ReportVersion[];
  evidence: Evidence[];
  artifacts: Omit<Artifact, 'content'>[];
}
export interface DownloadDescriptor extends Omit<Artifact, 'content'> {
  /** Text in the mock; the API adapter returns the downloaded bytes. */
  content: string | Blob;
  sizeBytes: number;
  sourceMode: 'mock' | 'api';
}
export interface ReportsReadPort {
  summarize(scope: ReportScope, signal?: AbortSignal): Promise<ReportAggregate>;
  readRecent(scope: ReportScope, limit: number, signal?: AbortSignal): Promise<ReportSummary[]>;
}
export interface ReportsRepository extends ReportsReadPort {
  list(query: ReportQuery, signal?: AbortSignal): Promise<Page<ReportSummary>>;
  readDetail(id: string, versionId?: string, signal?: AbortSignal): Promise<ReportDetail>;
  resolveDownload(id: string, versionId: string, artifactId: string, signal?: AbortSignal): Promise<DownloadDescriptor>;
  /** Only reports with no saved version can be deleted (doc 19 invariant 8). */
  delete(id: string, signal?: AbortSignal): Promise<void>;
}
export interface MockReadOptions {
  principal: Principal;
  clock: Clock;
  latencyMs?: number | ((operation: string) => number);
  fail?: (operation: string) => Error | undefined;
}
