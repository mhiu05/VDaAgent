import type { ReportDataset } from '../../features/reports/index';
import { validInstant } from '../../features/reports/model/query';

export function validateReports(data: ReportDataset, projectIds: readonly string[], sourceIds: readonly string[]): string[] {
  const errors: string[] = [];
  for (const [name, rows] of Object.entries({ records: data.records, versions: data.versions, attempts: data.attempts, evidence: data.evidence, artifacts: data.artifacts })) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) errors.push(`${name}: duplicate ID`);
  }
  for (const record of data.records) {
    if (!validInstant(record.createdAt)) errors.push(`${record.id}: createdAt`);
    if (!record.projectIds.every(id => projectIds.includes(id))) errors.push(`${record.id}: project`);
    if (record.latestAttemptId && !data.attempts.some(a => a.id === record.latestAttemptId && a.reportId === record.id)) errors.push(`${record.id}: latest attempt`);
    for (const id of record.versionIds) if (!data.versions.some(v => v.id === id && v.reportId === record.id)) errors.push(`${record.id}: version ${id}`);
  }
  for (const version of data.versions) {
    const record = data.records.find(r => r.id === version.reportId);
    if (!record?.versionIds.includes(version.id)) errors.push(`${version.id}: report`);
    if (!Number.isSafeInteger(version.sequence) || version.sequence < 1 || data.versions.filter(v => v.reportId === version.reportId && v.sequence === version.sequence).length !== 1) errors.push(`${version.id}: sequence`);
    if (!validInstant(version.completedAt) || !record || Date.parse(version.completedAt) < Date.parse(record.createdAt)) errors.push(`${version.id}: completedAt`);
    if (Date.parse(version.source.dataThrough) > Date.parse(version.completedAt) || Date.parse(version.source.updatedAt) > Date.parse(version.completedAt)) errors.push(`${version.id}: source chronology`);
    if (new Set(version.sections.map(s => s.id)).size !== version.sections.length) errors.push(`${version.id}: section ID`);
    for (const id of version.evidenceIds) if (!data.evidence.some(e => e.id === id)) errors.push(`${version.id}: evidence ${id}`);
    for (const id of version.artifactIds) if (!data.artifacts.some(a => a.id === id && a.versionId === version.id)) errors.push(`${version.id}: artifact ${id}`);
    for (const block of version.sections) {
      if ('evidenceIds' in block && block.evidenceIds.some(id => !version.evidenceIds.includes(id))) errors.push(`${version.id}: block evidence`);
      if (block.kind === 'chart' && (!sourceIds.includes(block.sourceId) || block.labels.length !== block.values.length)) errors.push(`${version.id}: chart`);
    }
  }
  for (const attempt of data.attempts) {
    if (!data.records.some(r => r.id === attempt.reportId) || !validInstant(attempt.createdAt) || (attempt.finishedAt !== null && (!validInstant(attempt.finishedAt) || Date.parse(attempt.finishedAt) < Date.parse(attempt.createdAt)))) errors.push(`${attempt.id}: attempt chronology/relation`);
    if (attempt.versionId && (attempt.state !== 'succeeded' || !data.versions.some(v => v.id === attempt.versionId && v.reportId === attempt.reportId))) errors.push(`${attempt.id}: saved version`);
  }
  for (const evidence of data.evidence) if (!sourceIds.includes(evidence.sourceId) || !evidence.projectIds.every(id => projectIds.includes(id))) errors.push(`${evidence.id}: source/project`);
  for (const artifact of data.artifacts) {
    if (!data.versions.some(v => v.id === artifact.versionId && v.artifactIds.includes(artifact.id))) errors.push(`${artifact.id}: version`);
    if (!artifact.content.includes('DEMO') || !artifact.content.includes(artifact.versionId) || (artifact.mediaType === 'text/html' ? !artifact.filename.endsWith('.html') : !artifact.filename.endsWith('.csv'))) errors.push(`${artifact.id}: content/type`);
  }
  return errors;
}
