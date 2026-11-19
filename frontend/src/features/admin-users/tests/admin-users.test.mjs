/* global URLSearchParams, performance, console */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createAdminFixtures } from '../../../mocks/admin-users/fixtures.ts';
import { createAdminScenario } from '../../../mocks/admin-users/scenarios.ts';
import { createAdminUsersMockService } from '../../../mocks/admin-users/service.ts';
import { createStressUsers } from '../../../mocks/admin-users/stress.ts';
import { validateAdmin } from '../../../mocks/admin-users/validate.ts';
import { createReportFixtures, demoUser, demoAdmin, demoClock } from '../../../mocks/reports/fixtures.ts';
import { defaultAdminQuery, parseAdminQuery, serializeAdminQuery, updateAdminQuery } from '../model/query.ts';

const options = () => ({ principal: demoAdmin, clock: demoClock });
const command = (patch = {}) => ({ userId: 'user-01', targetStatus: 'disabled', expectedRevision: 1, operationId: 'op-disable-1', ...patch });
const errorCode = code => error => error.code === code;

test('S01 admin fixture has only 24 USER accounts, 20 active, 4 disabled; report authors match', () => {
  const data = createAdminFixtures(); assert.deepEqual(validateAdmin(data), []);
  assert.equal(data.users.length, 24); assert.equal(data.users.filter(u => u.status === 'active').length, 20);
  assert.ok(data.users.every(u => u.id !== demoAdmin.id));
  for (const record of createReportFixtures().records) assert.equal(data.users.find(u => u.id === record.author.id).name, record.author.name);
});
test('S12 pessimistic change does not update status or audit before success', async () => {
  const service = createAdminUsersMockService({ ...options(), latencyMs: op => op === 'admin.changeStatus' ? 30 : 0 });
  const pending = service.changeStatus(command());
  const before = await service.readDetail('user-01'); assert.equal(before.user.status, 'active'); assert.equal(before.audit.length, 0);
  const result = await pending; assert.equal(result.user.status, 'disabled'); assert.equal(result.user.revision, 2);
  assert.equal(result.audit.fromStatus, 'active'); assert.equal(result.audit.actorId, demoAdmin.id); assert.equal(result.sourceMode, 'mock');
});
test('S12 failed mutation never changes status, revision or audit, and can retry', async () => {
  let fail = true;
  const service = createAdminUsersMockService({ ...options(), fail: op => op === 'admin.changeStatus' && fail ? new Error('offline demo') : undefined });
  await assert.rejects(service.changeStatus(command()), /offline demo/);
  const detail = await service.readDetail('user-01'); assert.equal(detail.user.status, 'active'); assert.equal(detail.user.revision, 1); assert.equal(detail.audit.length, 0);
  fail = false; assert.equal((await service.changeStatus(command())).user.status, 'disabled');
});
test('double submit with same operation ID applies once and creates one audit event', async () => {
  const service = createAdminUsersMockService({ ...options(), latencyMs: 5 });
  const results = await Promise.all([service.changeStatus(command()), service.changeStatus(command())]);
  assert.equal(results.filter(r => r.replayed).length, 1); assert.equal((await service.readDetail('user-01')).audit.length, 1);
});
test('S13 concurrent different commands using same revision cannot overwrite', async () => {
  const service = createAdminUsersMockService({ ...options(), latencyMs: 5 });
  const results = await Promise.allSettled([service.changeStatus(command()), service.changeStatus(command({ operationId: 'op-other' }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'conflict');
  assert.equal((await service.readDetail('user-01')).audit.length, 1);
});
test('S13 response lost after apply reconciles by refetch and idempotent retry', async () => {
  const service = createAdminUsersMockService({ ...options(), timeoutAfterApply: true }, createAdminScenario('S13'));
  await assert.rejects(service.changeStatus(command()), errorCode('timeout'));
  const detail = await service.readDetail('user-01'); assert.equal(detail.user.status, 'disabled'); assert.equal(detail.audit.length, 1);
  const retry = await service.changeStatus(command()); assert.equal(retry.replayed, true); assert.equal(retry.user.revision, 2);
  assert.equal((await service.readDetail('user-01')).audit.length, 1);
});
test('same operation ID cannot be reused for another target, status or revision', async () => {
  const service = createAdminUsersMockService(options()); await service.changeStatus(command());
  await assert.rejects(service.changeStatus(command({ userId: 'user-02' })), errorCode('conflict'));
  await assert.rejects(service.changeStatus(command({ targetStatus: 'active', expectedRevision: 2 })), errorCode('conflict'));
});
test('enable and disable produce isolated audit events; no-op creates no fake event', async () => {
  const service = createAdminUsersMockService(options());
  assert.equal((await service.changeStatus(command({ targetStatus: 'active' }))).audit, null);
  await service.changeStatus(command({ operationId: 'disable' }));
  const result = await service.changeStatus(command({ operationId: 'enable', targetStatus: 'active', expectedRevision: 2 }));
  assert.equal(result.user.status, 'active'); assert.equal(result.user.revision, 3); assert.equal((await service.readDetail('user-01')).audit.length, 2);
});
test('S14 non-ADMIN principals fail closed on all repository operations', async () => {
  for (const principal of [demoUser, { ...demoUser, role: 'unknown' }]) {
    const service = createAdminUsersMockService({ ...options(), principal });
    await assert.rejects(service.list(defaultAdminQuery()), errorCode('forbidden'));
    await assert.rejects(service.readDetail('user-01'), errorCode('forbidden'));
    await assert.rejects(service.changeStatus(command()), errorCode('forbidden'));
    assert.throws(() => service.reset(), errorCode('forbidden'));
  }
});
test('ADMIN targets or corrupted role records are excluded and cannot be changed', async () => {
  const data = createAdminFixtures(); data.users[0].role = 'ADMIN';
  const service = createAdminUsersMockService(options(), data);
  assert.equal((await service.list(defaultAdminQuery())).totalRows, 23);
  await assert.rejects(service.changeStatus(command()), errorCode('notFound'));
  await assert.rejects(service.readDetail('admin-demo'), errorCode('notFound'));
});
test('invalid mutation input fails before side effects', async () => {
  const service = createAdminUsersMockService(options());
  for (const patch of [{ operationId: '' }, { expectedRevision: 0 }, { targetStatus: 'deleted' }]) await assert.rejects(service.changeStatus(command(patch)), errorCode('validation'));
  assert.equal((await service.readDetail('user-01')).audit.length, 0);
});
test('seed, returned snapshots, and independent sessions remain isolated; reset is explicit', async () => {
  const seed = createAdminFixtures(); const service = createAdminUsersMockService(options(), seed);
  await service.changeStatus(command()); assert.equal(seed.users[0].status, 'active');
  const result = await service.readDetail('user-01'); result.user.status = 'active';
  assert.equal((await service.readDetail('user-01')).user.status, 'disabled');
  assert.equal((await createAdminUsersMockService(options(), seed).readDetail('user-01')).user.status, 'active');
  seed.users[0].status = 'disabled'; service.reset(); assert.equal((await service.readDetail('user-01')).user.status, 'active');
  assert.equal((await service.readDetail('user-01')).audit.length, 0);
});
test('reset cannot race a pending mutation', async () => {
  const service = createAdminUsersMockService({ ...options(), latencyMs: 5 }); const pending = service.changeStatus(command());
  assert.throws(() => service.reset(), errorCode('conflict')); await pending;
});
test('query restores filters and panel from URL; changes reset pagination', () => {
  const query = parseAdminQuery(new URLSearchParams('q=đặng&status=active&sort=name&direction=asc&page=3&pageSize=50&user=user-04'));
  assert.deepEqual(parseAdminQuery(serializeAdminQuery(query)), query); assert.equal(updateAdminQuery(query, { q: 'x' }).page, 1);
});
test('Vietnamese search, status filters and null last-active sorting', async () => {
  const service = createAdminUsersMockService(options());
  const result = await service.list({ ...defaultAdminQuery(), q: 'dang', statuses: ['active'] });
  assert.ok(result.totalRows > 0); assert.ok(result.rows.every(u => u.name.includes('Đặng') && u.status === 'active'));
  const sorted = await service.list({ ...defaultAdminQuery(), sort: 'lastActiveAt', direction: 'asc' });
  assert.equal(sorted.rows.at(-1).lastActiveAt, null); assert.equal(sorted.rows.find(u => u.id === 'user-01').lastActiveAt, null);
});
test('S16 full 10,000-row scope is filtered/sorted before clamped pagination', async () => {
  const service = createAdminUsersMockService(options(), createStressUsers());
  const start = performance.now(); const result = await service.list({ ...defaultAdminQuery(), q: 'stress.9999', page: 90 });
  console.info(`10,000-row admin query including response clone: ${(performance.now() - start).toFixed(2)} ms`);
  assert.equal(result.totalRows, 1); assert.equal(result.page, 1); assert.equal(result.rows[0].id, 'stress-user-09999');
});
