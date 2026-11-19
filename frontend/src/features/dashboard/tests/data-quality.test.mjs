import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDashboardFixtures } from '../../../mocks/dashboard/fixtures.ts';
import { createDashboardMockService } from '../../../mocks/dashboard/service.ts';
import { createReportsMockService } from '../../../mocks/reports/service.ts';
import { demoScope, demoClock, demoUser } from '../../../mocks/reports/fixtures.ts';
import { inventoryMetrics, transactionMetric } from '../model/metrics.ts';
import { formatMetric } from '../model/format.ts';

const options = { principal: demoUser, clock: demoClock };
const repository = data => createDashboardMockService(options, createReportsMockService(options), data);

test('null or invalid completed timestamps cannot masquerade as complete zero observations', () => {
  for (const completedAt of [null, 'invalid', '2026-02-30T00:00:00Z']) {
    const data = createDashboardFixtures(); data.transactions[0].completedAt = completedAt;
    assert.equal(transactionMetric(data, demoScope, demoUser.projectIds).metric.value, null);
  }
});
test('a conflicting transaction ID cannot produce a complete period aggregate', () => {
  const data = createDashboardFixtures(); data.transactions = [...data.transactions, { ...data.transactions[0], completedAt: '2026-10-01T02:00:00Z' }];
  assert.equal(transactionMetric(data, demoScope, demoUser.projectIds).metric.value, null);
});
test('timezone changes cannot claim full coverage for a different business calendar', () => {
  const data = createDashboardFixtures(); const scope = { ...demoScope, timezone: 'UTC' };
  assert.equal(inventoryMetrics(data, scope, demoUser.projectIds).summary, null);
  assert.equal(transactionMetric(data, scope, demoUser.projectIds).metric.value, null);
});
test('missing task source stays unknown and creates no failure attention', async () => {
  const data = createDashboardFixtures(); data.taskSource.completeness = 'missing';
  const result = await repository(data).readOverview(demoScope);
  assert.equal(result.tasks.data.active, null); assert.equal(result.tasks.data.failed, null);
  assert.ok(!result.attention.some(a => a.rule === 'AT02'));
});
test('partial snapshot or changed policy cannot trigger the demo project priority rule', async () => {
  for (const patch of [{ policyVersion: 'unreviewed' }, { source: { ...createDashboardFixtures().snapshots[0].source, completeness: 'partial' } }]) {
    const data = createDashboardFixtures(); Object.assign(data.snapshots[0], patch);
    assert.ok(!(await repository(data).readOverview(demoScope)).attention.some(a => a.rule === 'AT03'));
  }
});
test('returned dashboard metadata and project objects cannot mutate the repository', async () => {
  const repo = repository(createDashboardFixtures()); const result = await repo.readOverview(demoScope);
  result.inventory.data.projects[0].project.name = 'corrupted'; result.inventory.data.metrics[0].source.label = 'corrupted';
  result.tasks.data.source.completeness = 'missing';
  const next = await repo.readOverview(demoScope);
  assert.notEqual(next.inventory.data.projects[0].project.name, 'corrupted'); assert.equal(next.tasks.data.active, 3);
});
test('S11 large values and locale differences preserve raw precision and delta units', () => {
  const metric = inventoryMetrics(createDashboardFixtures(), demoScope, demoUser.projectIds).metrics[1];
  assert.equal(formatMetric(metric, 'vi-VN').value, '31,6'); assert.equal(formatMetric(metric, 'vi-VN').delta, '+6,6 đpt');
  assert.equal(formatMetric(metric, 'en-US').delta, '+6.6 pp'); assert.equal(formatMetric(metric, 'vi-VN').raw, 36 / 114 * 100);
  assert.equal(formatMetric({ ...metric, value: 650000, unit: 'căn' }, 'vi-VN').value, '650.000');
  assert.equal(formatMetric({ ...metric, value: null, delta: null }, 'en-US').value, 'Insufficient data');
});
test('unbounded daily date ranges fail validation instead of allocating millions of points', () => {
  assert.throws(() => transactionMetric(createDashboardFixtures(), { ...demoScope, from: '2000-01-01', to: '2026-10-16' }, demoUser.projectIds), error => error.code === 'validation');
});
