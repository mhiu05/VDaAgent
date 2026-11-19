import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createReportsScenario } from '../../../mocks/reports/scenarios.ts';
import { createDashboardScenario } from '../../../mocks/dashboard/scenarios.ts';
import { createAdminScenario } from '../../../mocks/admin-users/scenarios.ts';
import { validateReports } from '../../../mocks/reports/validate.ts';
import { validateAdmin } from '../../../mocks/admin-users/validate.ts';
import { demoUser, demoScope, demoClock } from '../../../mocks/reports/fixtures.ts';
import { createReportsMockService } from '../../../mocks/reports/service.ts';
import { defaultReportQuery } from '../model/query.ts';

test('report scenario seeds remain deterministic and relationally valid', () => {
  for (const id of ['S01', 'S03', 'S08', 'S09', 'S10', 'S11', 'S14', 'S15', 'S17', 'S18']) {
    assert.deepEqual(createReportsScenario(id), createReportsScenario(id));
    assert.deepEqual(validateReports(createReportsScenario(id), demoUser.projectIds, ['source-inventory', 'source-transactions', 'source-reports']), [], id);
  }
});
test('dashboard and admin scenario factories do not modify shared seeds', () => {
  for (const id of ['S01', 'S02', 'S04', 'S05', 'S06', 'S07', 'S11', 'S17']) assert.deepEqual(createDashboardScenario(id), createDashboardScenario(id));
  for (const id of ['S01', 'S11', 'S12', 'S13', 'S14']) {
    assert.deepEqual(createAdminScenario(id), createAdminScenario(id));
    assert.deepEqual(validateAdmin(createAdminScenario(id)), [], id);
  }
});
test('report types, full-data type filters and saved transaction chart totals agree', async () => {
  const data = createReportsScenario('S01');
  assert.equal(new Set(data.records.map(r => r.type)).size, 3);
  const service = createReportsMockService({ principal: demoUser, clock: demoClock }, data);
  const query = { ...defaultReportQuery(), types: ['transactions'], statuses: ['completed'], dateField: 'completedAt', ...demoScope };
  const results = await service.list(query); assert.equal(results.totalRows, 3);
  for (const row of results.rows) {
    const detail = await service.readDetail(row.record.id); const chart = detail.version.sections.find(s => s.kind === 'chart');
    const metrics = detail.version.sections.find(s => s.kind === 'metric-table');
    assert.equal(chart.values.reduce((sum, v) => sum + v, 0), metrics.rows[0][1]);
  }
});
