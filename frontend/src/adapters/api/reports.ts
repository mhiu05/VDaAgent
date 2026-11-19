import type { Principal } from "../../shared/contracts/auth";
import type { ReportsService, WorkspaceCatalog } from "../../features/reports/services/reports-service";
import type { DownloadDescriptor, Page, ReportAggregate, ReportDetail, ReportQuery, ReportScope,
  ReportSummary, ReportVersion } from "../../features/reports/model/types";
import { RepositoryError } from "../../features/reports/model/types";
import { decodeReportVersion } from "../../features/reports/adapters/decode-version";
import type { ApiClient } from "./http";
import type { Realtime } from "./realtime";
import { call, forbidden } from "./result";

/** `reportTargets.hasReport`: ids the reports API has shown this session, never guessed (doc 14c). */
export function createReportTargets() {
  const known = new Set<string>();
  return {
    hasReport: (id: string) => known.has(id),
    learn(ids: Iterable<string>) { for (const id of ids) known.add(id); },
  };
}
export type ReportTargets = ReturnType<typeof createReportTargets>;

const scopeParams = (scope: ReportScope) => ({ from: scope.from, to: scope.to,
  timezone: scope.timezone, market: scope.market, project: scope.project });

function decodeVersion(v: ReportVersion | null, reportId: string): ReportVersion | null {
  if (!v) return null;
  try {
    return decodeReportVersion(v, { reportId, versionId: v.id });
  } catch (error) {
    // An identity mismatch is a real integrity signal: keep rejecting it (doc 14f). Anything else
    // — a stored version older than the current decoder, or a source stamped after the version —
    // must not blank the whole library, because `list` decodes every row at once. Show that one
    // document as unsupported and leave the rest of the page usable.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("identity mismatch")) throw error;
    return { ...v, sections: [], evidenceIds: [], artifactIds: v.artifactIds ?? [],
      schema: undefined, schemaIssue: "Unsupported report version" };
  }
}
function decodeSummary(s: ReportSummary): ReportSummary {
  return { ...s, latestVersion: decodeVersion(s.latestVersion, s.record.id),
    matchedVersion: decodeVersion(s.matchedVersion, s.record.id) };
}

export function createApiReports(client: ApiClient, targets: ReportTargets, realtime: Realtime): ReportsService {
  const user = (p: Principal) => p.role === "USER";
  const remember = (rows: ReportSummary[]) => targets.learn(rows.map((r) => r.record.id));
  const listeners = new Set<(reportId: string) => void>();
  realtime.on("report.updated", (data) => {
    if (!data || typeof data !== "object" || !("report_id" in data) || typeof data.report_id !== "string") return;
    const id: string = data.report_id;
    listeners.forEach((fn) => fn(id));
  });
  return {
    catalog: async (p, signal) => !user(p) ? forbidden() : call(() =>
      client.get<WorkspaceCatalog>("/api/reports/catalog", undefined, signal), signal),
    list: async (p, query: ReportQuery, signal) => !user(p) ? forbidden() : call(async () => {
      const page = await client.get<Page<ReportSummary>>("/api/reports", {
        q: query.q, type: query.types, status: query.statuses, market: query.markets,
        project: query.projects, author: query.authors, agent: query.agents,
        dateField: query.dateField, from: query.from, to: query.to, timezone: query.timezone,
        sort: query.sort, direction: query.direction, page: query.page, pageSize: query.pageSize,
      }, signal);
      remember(page.rows);
      return { ...page, rows: page.rows.map(decodeSummary) };
    }, signal),
    detail: async (p, id, version, signal) => !user(p) ? forbidden() : call(async () => {
      const d = await client.get<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`,
        { version }, signal);
      if (d.summary.record.id !== id) throw new RepositoryError("validation", "Report identity mismatch");
      targets.learn([id]);
      return { ...d, summary: decodeSummary(d.summary), version: decodeVersion(d.version, id),
        versions: d.versions.map((v) => decodeVersion(v, id)!) };
    }, signal),
    download: async (p, id, version, artifact, signal) => !user(p) ? forbidden() : call(async () => {
      const d = await client.get<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`, { version }, signal);
      const meta = d.artifacts.find((a) => a.id === artifact && a.versionId === version);
      if (!meta) throw new RepositoryError("notFound", "Artifact unavailable for this version");
      const { blob, type } = await client.blob(
        `/api/reports/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/artifacts/${encodeURIComponent(artifact)}`, signal);
      const descriptor: DownloadDescriptor = { id: meta.id, versionId: meta.versionId,
        filename: meta.filename, mediaType: (type.split(";")[0] || meta.mediaType) as DownloadDescriptor["mediaType"],
        content: blob, sizeBytes: blob.size, sourceMode: "api" };
      return descriptor;
    }, signal),
    summarize: async (p, scope, signal) => !user(p) ? forbidden() : call(() =>
      client.get<ReportAggregate>("/api/reports/summary", scopeParams(scope), signal), signal),
    recent: async (p, scope, limit, signal) => !user(p) ? forbidden() : call(async () => {
      const rows = await client.get<ReportSummary[]>("/api/reports/recent",
        { ...scopeParams(scope), limit }, signal);
      remember(rows);
      return rows.map(decodeSummary);
    }, signal),
    delete: async (p, id, signal) => !user(p) ? forbidden() : call(() =>
      client.delete<void>(`/api/reports/${encodeURIComponent(id)}`, signal), signal),
    onChanged(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
