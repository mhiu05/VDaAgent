/* global structuredClone, URLSearchParams, AbortController */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDashboardFixtures } from '../../../mocks/dashboard/fixtures.ts';
import { createDashboardScenario } from '../../../mocks/dashboard/scenarios.ts';
import { createDashboardMockService } from '../../../mocks/dashboard/service.ts';
import { validateDashboard } from '../../../mocks/dashboard/validate.ts';
import { createReportFixtures, demoUser, demoAdmin, demoClock, demoScope } from '../../../mocks/reports/fixtures.ts';
import { createReportsMockService } from '../../../mocks/reports/service.ts';
import { inventorySummary, inventoryMetrics, transactionMetric, previousPeriod, percentageChange, ageBand, addDays } from '../model/metrics.ts';
import { parseDashboardQuery, serializeDashboardQuery } from '../model/query.ts';
import { inventoryChart, transactionChart } from '../adapters/chart-series.ts';

const options = () => ({ principal: structuredClone(demoUser), clock: demoClock });
function service(data = createDashboardFixtures(), opts = options()) { return createDashboardMockService(opts, createReportsMockService(opts), data); }
const ids = demoUser.projectIds;

test('Dashboard restores required dates for explicitly empty or oversized URL periods', () => {
  for (const raw of ['from=&to=', 'from=2020-01-01&to=2026-10-16']) {
    const parsed = parseDashboardQuery(new URLSearchParams(raw), demoScope, createDashboardFixtures().projects);
    assert.deepEqual(parsed.query.scope, demoScope);
    assert.ok(parsed.warnings.includes('dateRange'));
  }
});
const metric = (result, id) => result.metrics.find(m => m.id === id);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('S01 all dashboard references and source chronology are valid', () => {
  const reports = createReportFixtures(); const data = createDashboardFixtures(reports);
  assert.deepEqual(validateDashboard(data, reports, demoClock), []);
  assert.deepEqual(createDashboardFixtures(reports), data);
});
test('S01 inventory=120, eligible=114, slow=36; baseline=132/128/32', () => {
  const data = createDashboardFixtures(); const current = inventorySummary(data.snapshots[0], ids); const before = inventorySummary(data.snapshots[1], ids);
  assert.deepEqual([current.total, current.eligible, current.slow, current.unknown], [120, 114, 36, 6]);
  assert.deepEqual([before.total, before.eligible, before.slow], [132, 128, 32]);
  assert.deepEqual(current.bins.map(b => b.count), [50, 28, 24, 12, 6]);
  assert.equal(current.coverage, 95); near(current.share, 36 / 114 * 100);
});
test('S01 KPI precision preserves percentage change versus percentage points', () => {
  const result = inventoryMetrics(createDashboardFixtures(), demoScope, ids);
  near(metric(result, 'inventory').delta, -12 / 132 * 100);
  assert.equal(metric(result, 'inventory').absoluteDelta, -12);
  near(metric(result, 'slowShare').delta, 36 / 114 * 100 - 25);
  assert.equal(metric(result, 'slowShare').deltaUnit, 'percentagePoints');
  assert.equal(metric(result, 'slowShare').baseline, 25);
});
test('S01 daily current and baseline series reconcile to 45/50 and −10%', () => {
  const result = transactionMetric(createDashboardFixtures(), demoScope, ids);
  assert.equal(result.metric.value, 45); assert.equal(result.metric.baseline, 50); assert.equal(result.metric.delta, -10);
  assert.equal(result.trend.length, 30); assert.equal(result.trend.reduce((sum, p) => sum + p.current, 0), 45);
  assert.equal(result.trend.reduce((sum, p) => sum + p.previous, 0), 50);
  assert.equal(previousPeriod(demoScope).from, '2026-08-17');
});
test('S01 shared ReportsReadPort supplies canonical dashboard aggregates and recent reports', async () => {
  const result = await service().readOverview(demoScope);
  assert.equal(result.inventory.state, 'ready'); assert.equal(result.reports.data.aggregate.distinctReports, 12);
  assert.equal(result.reports.data.aggregate.completedVersions, 16); assert.equal(result.tasks.data.active, 3); assert.equal(result.tasks.data.failed, 2);
  assert.deepEqual(result.attention.map(a => a.rule), ['AT01', 'AT02', 'AT03']);
  assert.equal(result.attention.find(a => a.rule === 'AT03').projectId, 'P-A');
  assert.ok(result.attention.every(a => a.evidenceIds.length > 0));
});
test('charts use identical normalized values for renderer and accessible tables', () => {
  const data = createDashboardFixtures(); const summary = inventorySummary(data.snapshots[0], ids);
  const age = inventoryChart(summary, data.snapshots[0].source, data.snapshots[0].businessDate);
  assert.equal(age.rows.reduce((sum, r) => sum + r.count, 0), 120); assert.equal(age.completeness.unknown, 6);
  const transactions = transactionMetric(data, demoScope, ids);
  const chart = transactionChart(transactions.trend, demoScope, previousPeriod(demoScope), data.transactionSource);
  assert.deepEqual(chart.totals, { current: 45, previous: 50 }); assert.equal(chart.rows[0].previousDate, '2026-08-17');
});
test('S02 known empty stock/flow are zero, empty denominator is unavailable', () => {
  const data = createDashboardScenario('S02'); const result = inventoryMetrics(data, demoScope, ids);
  assert.equal(metric(result, 'inventory').value, 0); assert.equal(metric(result, 'slowShare').value, null);
  assert.equal(transactionMetric(data, demoScope, ids).metric.value, 0);
});
test('S04 missing ages stay in inventory but never enter the slow denominator', async () => {
  const result = await service(createDashboardScenario('S04')).readOverview(demoScope);
  assert.equal(result.inventory.data.summary.total, 120); assert.equal(result.inventory.data.summary.unknown, 120);
  assert.equal(metric(result.inventory.data, 'slowShare').value, null);
  assert.ok(!result.attention.some(a => a.rule === 'AT03'));
});
test('age thresholds 89/90, 179/180, 359/360 and future/null/invalid dates', () => {
  const property = createDashboardFixtures().snapshots[0].properties[0]; const date = '2026-10-15';
  for (const [age, band] of [[89, 'young'], [90, 'middle'], [179, 'middle'], [180, 'slow'], [359, 'slow'], [360, 'old']]) assert.equal(ageBand({ ...property, listedBusinessDate: addDays(date, -age) }, date), band);
  for (const listedBusinessDate of [null, 'not-a-date', '2026-02-30', '2026-10-16']) assert.equal(ageBand({ ...property, listedBusinessDate }, date), 'unknown');
});
test('S05 missing or wrong-period snapshot never falls back to latest; no fake baseline', () => {
  const data = createDashboardScenario('S05'); const result = inventoryMetrics(data, demoScope, ids);
  assert.equal(metric(result, 'inventory').value, 120); assert.equal(metric(result, 'inventory').delta, null);
  const historical = inventoryMetrics(data, { ...demoScope, from: '2026-01-01', to: '2026-02-01' }, ids);
  assert.equal(metric(historical, 'inventory').value, null); assert.equal(historical.summary, null);
});
test('mismatched policy or poor baseline coverage suppresses slow-share comparison', () => {
  const data = createDashboardFixtures(); data.snapshots[1].policyVersion = 'different-policy';
  assert.equal(metric(inventoryMetrics(data, demoScope, ids), 'slowShare').delta, null);
  data.snapshots[1].policyVersion = data.snapshots[0].policyVersion;
  for (const p of data.snapshots[1].properties.slice(0, 40)) p.listedBusinessDate = null;
  assert.equal(metric(inventoryMetrics(data, demoScope, ids), 'slowShare').baseline, null);
});
test('S06 partial coverage creates null gaps and suppresses period comparison', () => {
  const result = transactionMetric(createDashboardScenario('S06'), demoScope, ids);
  assert.equal(result.metric.value, null); assert.equal(result.metric.delta, null);
  assert.equal(result.trend.find(p => p.currentDate === '2026-09-20').current, null);
  assert.ok(transactionMetric(createDashboardScenario('S06'), demoScope, ['P-C']).trend.some(p => p.current === 0));
});
test('exact duplicates do not inflate stock or completed transaction counts', () => {
  const data = createDashboardFixtures(); data.snapshots[0].properties = [...data.snapshots[0].properties, data.snapshots[0].properties[0]];
  data.transactions = [...data.transactions, data.transactions[0]];
  assert.equal(inventorySummary(data.snapshots[0], ids).total, 120); assert.equal(transactionMetric(data, demoScope, ids).metric.value, 45);
});
test('conflicting duplicate records are marked partial and cannot produce a delta', () => {
  const data = createDashboardFixtures(); data.snapshots[0].properties = [...data.snapshots[0].properties, { ...data.snapshots[0].properties[0], listedBusinessDate: null }];
  const result = inventoryMetrics(data, demoScope, ids);
  assert.ok(result.summary.invalidIds.includes(data.snapshots[0].properties[0].id)); assert.equal(metric(result, 'inventory').delta, null);
});
test('S07 source failure stays local; independent sections survive and retry works', async () => {
  let fail = true; const opts = { ...options(), fail: op => op === 'dashboard.inventory' && fail ? new Error('inventory offline') : undefined };
  const repo = service(createDashboardScenario('S07'), opts);
  const result = await repo.readOverview(demoScope);
  assert.equal(result.inventory.state, 'error'); assert.equal(result.transactions.state, 'ready'); assert.equal(result.reports.state, 'ready');
  assert.ok(result.attention.every(a => a.rule !== 'AT01' && a.rule !== 'AT03'));
  fail = false; assert.equal((await repo.readOverview(demoScope)).inventory.state, 'ready');
});
test('stock/flow and current tasks use different time semantics', async () => {
  const result = await service().readOverview({ ...demoScope, from: '2026-01-01', to: '2026-02-01' });
  assert.equal(result.tasks.data.active, 3); assert.equal(result.tasks.data.failed, 0); assert.equal(result.inventory.data.summary, null);
});
test('latest task attempt state controls unresolved failure count', async () => {
  const data = createDashboardFixtures(); data.tasks.find(t => t.state === 'failed').state = 'running';
  const result = await service(data).readOverview(demoScope);
  assert.equal(result.tasks.data.failed, 1); assert.equal(result.tasks.data.active, 4);
});
test('principal and project/market scope apply before aggregates and breakdown pagination', async () => {
  const opts = options(); opts.principal.projectIds = ['P-A'];
  const repo = service(createDashboardFixtures(), opts); const result = await repo.readOverview(demoScope);
  assert.equal(result.inventory.data.summary.total, 60); assert.equal(result.reports.data.aggregate.distinctReports, 4);
  const rows = await repo.readBreakdown('inventory', demoScope, { page: 2, pageSize: 25 });
  assert.equal(rows.totalRows, 60); assert.equal(rows.rows.length, 25); assert.ok(rows.rows.every(r => r.projectId === 'P-A'));
  const optsAdmin = { ...options(), principal: demoAdmin }; await assert.rejects(service(createDashboardFixtures(), optsAdmin).readOverview(demoScope), e => e.code === 'forbidden');
});
test('URL keeps inspect state, restores scope and clears conflicting project/market', () => {
  const data = createDashboardFixtures(); const result = parseDashboardQuery(new URLSearchParams('market=HCM&project=P-B&inspect=tasks&taskState=failed'), demoScope, data.projects);
  assert.deepEqual(result.warnings, ['project']); assert.equal(result.query.scope.project, undefined);
  assert.deepEqual(parseDashboardQuery(serializeDashboardQuery(result.query), demoScope, data.projects).query, result.query);
});
test('S17 zero baseline and missing baseline never yield Infinity or fake zero percent', () => {
  assert.equal(percentageChange(45, 0), null); assert.equal(percentageChange(45, null), null);
  const result = transactionMetric(createDashboardScenario('S17'), demoScope, ids);
  assert.equal(result.metric.baseline, 0); assert.equal(result.metric.delta, null); assert.equal(result.metric.reason, 'zeroBaseline');
});
test('aborted overview does not turn an aborted read into a section error', async () => {
  const controller = new AbortController(); const repo = service(createDashboardFixtures(), { ...options(), latencyMs: 30 });
  const request = repo.readOverview(demoScope, controller.signal); controller.abort();
  await assert.rejects(request, e => e.name === 'AbortError');
});
