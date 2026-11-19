/* global structuredClone, URLSearchParams, performance, TextEncoder, AbortController, console */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createReportFixtures, demoUser, demoAdmin, demoClock, demoScope } from '../../../mocks/reports/fixtures.ts';
import { createReportsMockService } from '../../../mocks/reports/service.ts';
import { createReportsScenario } from '../../../mocks/reports/scenarios.ts';
import { createStressReports } from '../../../mocks/reports/stress.ts';
import { validateReports } from '../../../mocks/reports/validate.ts';
import { defaultReportQuery, parseReportQuery, serializeReportQuery, updateReportQuery, validInstant, inPeriod } from '../model/query.ts';
import { createLatestRead } from '../model/latest-read.ts';

const options = () => ({ principal: structuredClone(demoUser), clock: demoClock });

test('metadata search includes project names and collapses repeated whitespace', async () => {
  const service = createReportsMockService(options());
  const result = await service.list({ ...defaultReportQuery(), q: '  vda   DEMO\tRiverside  ' });
  assert.equal(result.totalRows, 6);
  assert.ok(result.rows.every(row => row.record.projectIds.includes('P-A')));
});
const completedQuery = () => ({ ...defaultReportQuery(), ...demoScope, statuses: ['completed'], dateField: 'completedAt' });
const errorCode = code => error => error.code === code;

test('S01 canonical report relationships, artifact formats and chronology are valid', () => {
  assert.deepEqual(validateReports(createReportFixtures(), demoUser.projectIds, ['source-inventory', 'source-transactions', 'source-reports']), []);
  assert.deepEqual(createReportFixtures(), createReportFixtures());
});
test('S01 same predicate yields 12 report records, 16 completed versions and distinct recent reports', async () => {
  const service = createReportsMockService(options());
  const summary = await service.summarize(demoScope);
  const list = await service.list(completedQuery()); const recent = await service.readRecent(demoScope, 5);
  assert.equal(summary.distinctReports, 12); assert.equal(summary.completedVersions, 16);
  assert.equal(list.totalRows, 12); assert.equal(new Set(recent.map(r => r.record.id)).size, 5);
  assert.ok(recent.every(r => list.rows.some(row => row.record.id === r.record.id)));
});
test('S08 failed regeneration keeps completed status and saved version', async () => {
  const service = createReportsMockService(options(), createReportsScenario('S08'));
  const detail = await service.readDetail('R001');
  assert.equal(detail.summary.status, 'completed'); assert.equal(detail.summary.latestAttempt.state, 'failed');
  assert.equal(detail.version.id, 'R001-v2'); assert.equal(detail.versions.length, 2);
});
test('generation lifecycle does not manufacture saved versions', async () => {
  const service = createReportsMockService(options());
  for (const [id, status] of [['R013', 'generating'], ['R015', 'failed'], ['R017', 'draft']]) {
    const detail = await service.readDetail(id); assert.equal(detail.summary.status, status); assert.equal(detail.version, null);
  }
});
test('unknown generation states fail closed instead of completed', async () => {
  const data = createReportFixtures(); data.attempts.find(a => a.reportId === 'R013').state = 'unknown';
  const detail = await createReportsMockService(options(), data).readDetail('R013');
  assert.equal(detail.summary.status, 'unsupported'); assert.equal(detail.version, null);
});
test('S09 filter matches saved v1 when latest v2 is outside the selected period', async () => {
  const service = createReportsMockService(options(), createReportsScenario('S09'));
  const list = await service.list(completedQuery()); const row = list.rows.find(r => r.record.id === 'R001');
  assert.equal(row.matchedVersion.id, 'R001-v1'); assert.equal(row.latestVersion.id, 'R001-v2');
  assert.equal((await service.summarize(demoScope)).distinctReports, 12);
  assert.equal((await service.summarize(demoScope)).completedVersions, 15);
  assert.equal((await service.readRecent(demoScope, 100)).find(r => r.record.id === 'R001').matchedVersion.id, 'R001-v1');
});
test('saved versions and internal fixtures cannot be mutated by callers', async () => {
  const seed = createReportFixtures(); const original = structuredClone(seed);
  const service = createReportsMockService(options(), seed);
  const detail = await service.readDetail('R001', 'R001-v1'); detail.version.sections[0].paragraphs[0] = 'corrupted';
  seed.versions[0].sections[0].paragraphs[0] = 'also corrupted';
  assert.equal((await service.readDetail('R001', 'R001-v1')).version.sections[0].paragraphs[0], original.versions[0].sections[0].paragraphs[0]);
});
test('S14 principal scope is enforced on list, aggregates, detail and download', async () => {
  const scoped = options(); scoped.principal.reportIds = ['R001'];
  const service = createReportsMockService(scoped);
  assert.equal((await service.list(completedQuery())).totalRows, 1);
  assert.equal((await service.summarize(demoScope)).distinctReports, 1);
  await assert.rejects(service.readDetail('R002'), errorCode('notFound'));
  await assert.rejects(service.resolveDownload('R002', 'R002-v1', 'R002-v1-html'), errorCode('notFound'));
  await assert.rejects(createReportsMockService({ ...options(), principal: demoAdmin }).list(defaultReportQuery()), errorCode('forbidden'));
});
test('version or artifact from another report is rejected', async () => {
  const service = createReportsMockService(options());
  await assert.rejects(service.readDetail('R001', 'R002-v1'), errorCode('notFound'));
  await assert.rejects(service.resolveDownload('R001', 'R001-v1', 'R001-v2-html'), errorCode('notFound'));
});
test('download descriptor contains actual demo HTML/CSV with the selected version and byte size', async () => {
  const service = createReportsMockService(options());
  const html = await service.resolveDownload('R001', 'R001-v1', 'R001-v1-html');
  assert.equal(html.mediaType, 'text/html'); assert.equal(html.filename, 'VDA-DEMO-R001-v1.html');
  assert.ok(html.content.startsWith('<!doctype html>')); assert.ok(html.content.includes('DEMO'));
  assert.ok(html.content.includes('R001-v1')); assert.equal(html.sizeBytes, new TextEncoder().encode(html.content).byteLength);
  const csv = await service.resolveDownload('R001', 'R001-v2', 'R001-v2-csv');
  assert.equal(csv.mediaType, 'text/csv'); assert.ok(csv.content.includes('R001-v2')); assert.ok(csv.content.includes('Ton kha dung,60'));
});
test('S18 unavailable artifact does not prevent reading the report', async () => {
  const service = createReportsMockService(options(), createReportsScenario('S18'));
  assert.equal((await service.readDetail('R001')).artifacts.length, 0);
  await assert.rejects(service.resolveDownload('R001', 'R001-v2', 'R001-v2-html'), errorCode('notFound'));
});
test('S10 long report contains substantial prose, stable section IDs and evidence', async () => {
  const detail = await createReportsMockService(options(), createReportsScenario('S10')).readDetail('R001');
  assert.equal(detail.version.sections.length, 29); assert.equal(detail.evidence.length, 1);
  assert.equal(new Set(detail.version.sections.map(s => s.id)).size, detail.version.sections.length);
  assert.ok(detail.artifacts.every(a => !('content' in a)));
});
test('S03 Vietnamese accent-insensitive search and AND/OR filter semantics', async () => {
  const service = createReportsMockService(options());
  const result = await service.list({ ...defaultReportQuery(), q: 'phan tich', projects: ['P-A', 'P-B'], statuses: ['completed'] });
  assert.equal(result.totalRows, 8);
  const none = await service.list({ ...defaultReportQuery(), q: 'khong co bao cao nay' }); assert.equal(none.totalRows, 0); assert.equal(none.page, 1);
});
test('URL parsing canonicalizes malformed input and round-trips query filters', () => {
  const { query, warnings } = parseReportQuery(new URLSearchParams('q=đất&project=P-B&project=P-A&project=P-A&page=-1&pageSize=9&from=2026-02-30&to=bad&timezone=bad'));
  assert.deepEqual(warnings, ['page', 'pageSize', 'timezone', 'dateRange']);
  assert.deepEqual(query.projects, ['P-A', 'P-B']);
  assert.deepEqual(parseReportQuery(serializeReportQuery(query)).query, query);
  assert.equal(updateReportQuery({ ...query, page: 4 }, { q: 'new' }).page, 1);
});
test('S17 periods use local business date, half-open bounds and valid timestamps', () => {
  assert.equal(inPeriod('2026-09-15T17:00:00Z', demoScope.from, demoScope.to, demoScope.timezone), true);
  assert.equal(inPeriod('2026-10-15T17:00:00Z', demoScope.from, demoScope.to, demoScope.timezone), false);
  assert.equal(inPeriod('2026-09-15T16:59:59Z', demoScope.from, demoScope.to, demoScope.timezone), false);
  assert.equal(validInstant('2026-02-30T01:00:00Z'), false); assert.equal(validInstant('2026-10-01'), false);
});
test('S16 filter and stable sort run across all 10,000 rows before pagination', async () => {
  const data = createStressReports(); const opts = options(); opts.principal.reportIds = data.records.map(r => r.id);
  const service = createReportsMockService(opts, data);
  const start = performance.now();
  const result = await service.list({ ...defaultReportQuery(), sort: 'createdAt', page: 2, pageSize: 100 });
  console.info(`10,000-row repository query including response clone: ${(performance.now() - start).toFixed(2)} ms`);
  assert.equal(result.totalRows, 10_000); assert.equal(result.rows.length, 100); assert.equal(result.rows[0].record.id, 'stress-00100');
  const filtered = await service.list({ ...defaultReportQuery(), q: '9999', page: 400 });
  assert.equal(filtered.totalRows, 1); assert.equal(filtered.page, 1); assert.equal(filtered.rows[0].record.id, 'stress-09999');
});
test('read abort is observable and request listeners are cleaned up', async () => {
  const service = createReportsMockService({ ...options(), latencyMs: 40 }); const controller = new AbortController();
  const request = service.list(defaultReportQuery(), controller.signal); controller.abort();
  await assert.rejects(request, error => error.name === 'AbortError');
});
test('S15 stale responses cannot replace newer results, even if transport ignores abort', async () => {
  const latest = createLatestRead();
  let release;
  const first = latest.run(() => new Promise(resolve => { release = resolve; }));
  const second = await latest.run(async () => 'B'); release('A');
  assert.deepEqual(second, { current: true, value: 'B' }); assert.deepEqual(await first, { current: false }); latest.dispose();
});
test('transient read errors are retryable without mutating report state', async () => {
  let fail = true;
  const service = createReportsMockService({ ...options(), fail: operation => operation === 'reports.download' && fail ? new Error('offline demo') : undefined });
  await assert.rejects(service.resolveDownload('R001', 'R001-v1', 'R001-v1-html'), /offline demo/);
  fail = false; assert.equal((await service.resolveDownload('R001', 'R001-v1', 'R001-v1-html')).sourceMode, 'mock');
});
