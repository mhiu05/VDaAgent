import type { ReportQuery, ReportSummary } from './types';
import type { WorkspaceCatalog } from '../services/reports-service';

/** Keep the same selected-version semantics in table and compact-card layouts. */
export function reportRowPresentation(row: ReportSummary, projects: WorkspaceCatalog['projects'], dateField: ReportQuery['dateField']) {
  const version = row.matchedVersion ?? row.latestVersion;
  const attemptNote = row.status === 'completed'
    ? row.latestAttempt?.state === 'failed' ? 'newAttemptFailed' : row.latestAttempt?.state === 'running' || row.latestAttempt?.state === 'queued' ? 'newAttemptRunning' : null
    : null;
  return {
    version,
    link: `/reports/${encodeURIComponent(row.record.id)}${version ? `?version=${encodeURIComponent(version.id)}` : ''}`,
    projectLabel: row.record.projectIds.map(id => projects.find(project => project.id === id)?.name ?? id).join(', '),
    date: dateField === 'createdAt' ? row.record.createdAt : version?.completedAt,
    tone: row.status === 'completed' ? 'success' as const : row.status === 'failed' ? 'danger' as const : 'neutral' as const,
    attemptNote,
  };
}
