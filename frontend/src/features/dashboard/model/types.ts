import type { DateRange, Page, ReportAggregate, ReportScope, ReportSummary, SourceMeta } from '../../reports/index';

export interface Project { id: string; name: string; marketId: string; marketLabel: string; sourceId: string }
export interface PropertySnapshot {
  id: string; snapshotId: string; projectId: string;
  status: 'available' | 'reserved' | 'sold' | 'withdrawn';
  listedBusinessDate: string | null; sourceId: string;
}
export interface InventorySnapshot {
  id: string; businessDate: string; closingBefore: string; policyVersion: string;
  properties: readonly PropertySnapshot[]; source: SourceMeta;
}
export interface Transaction {
  id: string; propertyId: string; projectId: string;
  status: 'completed' | 'cancelled' | 'reserved'; completedAt: string | null; test: boolean; sourceId: string;
}
export interface AnalysisTask {
  id: string; projectId: string; state: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string; observedAt: string; failedAt: string | null;
  attemptNumber: number; reportId: string | null; versionId: string | null; error: string | null;
}
export interface DashboardDataset {
  businessTimezone: string;
  projects: readonly Project[]; snapshots: readonly InventorySnapshot[];
  transactions: readonly Transaction[]; tasks: readonly AnalysisTask[];
  transactionSource: SourceMeta; taskSource: SourceMeta;
  /** Full coverage days. Absence means unknown, never zero. */
  coveredDates: readonly string[];
}
export interface InventorySummary {
  total: number; eligible: number; slow: number; unknown: number;
  share: number | null; coverage: number | null;
  bins: { id: 'young' | 'middle' | 'slow' | 'old' | 'unknown'; label: string; count: number }[];
  invalidIds: string[];
}
export interface Metric {
  id: 'inventory' | 'slowShare' | 'transactions'; value: number | null;
  unit: 'căn' | '%' | 'giao dịch'; baseline: number | null;
  delta: number | null; deltaUnit: '%' | 'percentagePoints';
  absoluteDelta: number | null; numerator: number | null; denominator: number | null;
  reason: string | null; quality: 'full' | 'partial' | 'missing';
  source: SourceMeta | null; scope: ReportScope; baselineScope: DateRange;
  policyVersion: string; inspect: 'inventory' | 'slow' | 'transactions';
}
export interface TransactionPoint { date: string; value: number | null }
export interface TrendPoint { day: number; currentDate: string; previousDate: string; current: number | null; previous: number | null }
export interface Attention {
  id: string; rule: 'AT01' | 'AT02' | 'AT03'; evidenceIds: string[];
  projectId: string | null; text: string; policyVersion: string; observedAt: string;
}
export type Section<T> = { state: 'ready'; data: T } | { state: 'error'; error: string };
export interface DashboardOverview {
  asOf: string; sourceMode: 'mock' | 'api'; scope: ReportScope;
  inventory: Section<{ metrics: Metric[]; summary: InventorySummary | null; projects: { project: Project; summary: InventorySummary }[] }>;
  transactions: Section<{ metric: Metric; trend: TrendPoint[] }>;
  tasks: Section<{ active: number | null; failed: number | null; observedAt: string; source: SourceMeta }>;
  reports: Section<{ aggregate: ReportAggregate; recent: ReportSummary[] }>;
  attention: Attention[];
}
export type BreakdownKind = 'inventory' | 'slow' | 'transactions' | 'tasks';
export type BreakdownRow = PropertySnapshot | Transaction | AnalysisTask;
export interface BreakdownQuery { page: number; pageSize: 25 | 50 | 100; taskState?: 'active' | 'failed' | 'all'; ageBand?: InventorySummary['bins'][number]['id'] }
export interface DashboardRepository {
  readOverview(scope: ReportScope, signal?: AbortSignal): Promise<DashboardOverview>;
  readBreakdown(kind: BreakdownKind, scope: ReportScope, query: BreakdownQuery, signal?: AbortSignal): Promise<Page<BreakdownRow>>;
}
