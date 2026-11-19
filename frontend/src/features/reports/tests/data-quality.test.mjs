/* global structuredClone, URLSearchParams */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createReportFixtures, demoScope, demoUser, demoClock } from '../../../mocks/reports/fixtures.ts';
import { createReportsMockService } from '../../../mocks/reports/service.ts';
import { defaultReportQuery, parseReportQuery } from '../model/query.ts';

test('duplicate canonical IDs are rejected instead of inflating report and version counts', () => {
  for (const key of ['records', 'versions']) {
    const data = createReportFixtures(); data[key] = [...data[key], structuredClone(data[key][0])];
    assert.throws(() => createReportsMockService({ principal: demoUser, clock: demoClock }, data), e => e.code === 'validation');
  }
});
test('a missing Reports source is an error, not a zero-report result', async () => {
  const data = createReportFixtures(); data.source.completeness = 'missing';
  const repo = createReportsMockService({ principal: demoUser, clock: demoClock }, data);
  await assert.rejects(repo.summarize(demoScope), e => e.code === 'unavailable');
  await assert.rejects(repo.list(defaultReportQuery()), e => e.code === 'unavailable');
});
test('unsupported query enums produce normalization warnings', () => {
  const result = parseReportQuery(new URLSearchParams('type=secret!&status=published&dateField=deletedAt&sort=unsafe&direction=sideways'));
  assert.deepEqual(result.warnings, ['type', 'status', 'dateField', 'sort', 'direction']);
});
