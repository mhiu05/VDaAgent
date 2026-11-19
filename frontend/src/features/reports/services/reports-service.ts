import type { Principal } from '../../../shared/contracts/auth';
import type { ServiceResult } from '../../../shared/contracts/service-result';
import type { DownloadDescriptor, Page, ReportAggregate, ReportDetail, ReportQuery, ReportScope, ReportSummary } from '../model/types';
export interface WorkspaceCatalog {
  reportTypes?: readonly import('../model/report-schema').ReportTypeMetadata[];
  projects: { id: string; name: string; marketId: string; marketLabel: string }[];
  authors: { id: string; name: string }[];
  agents: string[];
  defaultScope: ReportScope;
}
export interface ReportsService {
  catalog(principal: Principal, signal?: AbortSignal): Promise<ServiceResult<WorkspaceCatalog>>;
  list(principal: Principal, query: ReportQuery, signal?: AbortSignal): Promise<ServiceResult<Page<ReportSummary>>>;
  detail(principal: Principal, id: string, version?: string, signal?: AbortSignal): Promise<ServiceResult<ReportDetail>>;
  download(principal: Principal, id: string, version: string, artifact: string, signal?: AbortSignal): Promise<ServiceResult<DownloadDescriptor>>;
  summarize(principal: Principal, scope: ReportScope, signal?: AbortSignal): Promise<ServiceResult<ReportAggregate>>;
  recent(principal: Principal, scope: ReportScope, limit: number, signal?: AbortSignal): Promise<ServiceResult<ReportSummary[]>>;
  /** Only reports with no published version can be deleted (doc 19 invariant 8). */
  delete(principal: Principal, id: string, signal?: AbortSignal): Promise<ServiceResult<void>>;
  /** `report.updated` (doc 14 "Realtime") with the changed report id; the mock never fires it. */
  onChanged(listener: (reportId: string) => void): () => void;
}
