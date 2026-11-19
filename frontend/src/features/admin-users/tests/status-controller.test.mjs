import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createStatusController } from '../model/status-controller.ts';
import { createAdminUsersMockService } from '../../../mocks/admin-users/service.ts';
import { demoAdmin, demoClock } from '../../../mocks/reports/fixtures.ts';

const options = { principal: demoAdmin, clock: demoClock };
test('cancelled confirmation and unconfirmed submission cannot change an account', async () => {
  const repo = createAdminUsersMockService(options); const controller = createStatusController(repo, () => 'cancel-op');
  await assert.rejects(controller.confirm(), e => e.code === 'validation');
  controller.request((await repo.readDetail('user-01')).user, 'disabled'); controller.cancel();
  assert.equal(controller.getState().state, 'idle'); assert.equal((await repo.readDetail('user-01')).user.status, 'active');
});
test('confirmation freezes target/revision, duplicate confirmation returns the pending operation', async () => {
  const repo = createAdminUsersMockService({ ...options, latencyMs: 5 }); const controller = createStatusController(repo, () => 'confirmed-op');
  const user = (await repo.readDetail('user-01')).user; const state = controller.request(user, 'disabled');
  user.id = 'user-02'; state.command.userId = 'user-03';
  const pending = controller.confirm(); assert.equal(controller.getState().state, 'pending');
  assert.equal(controller.confirm(), pending); assert.throws(() => controller.request(user, 'disabled'), e => e.code === 'conflict');
  controller.cancel(); assert.equal(controller.getState().state, 'pending');
  const result = await pending; assert.equal(result.state, 'success'); assert.equal(result.result.user.id, 'user-01');
});
test('error remains an error after refetch, then retry keeps the same operation ID', async () => {
  let fail = true;
  const repo = createAdminUsersMockService({ ...options, fail: op => fail && op === 'admin.changeStatus' ? new Error('offline') : undefined });
  const controller = createStatusController(repo, () => 'retry-op');
  controller.request((await repo.readDetail('user-01')).user, 'disabled');
  const result = await controller.confirm(); assert.equal(result.state, 'error'); assert.equal(result.latest.user.status, 'active');
  fail = false; const retry = await controller.retry(); assert.equal(retry.state, 'success'); assert.equal(retry.result.audit.operationId, 'retry-op');
});
test('timeout success is confirmed only from matching audit evidence after refetch', async () => {
  const repo = createAdminUsersMockService({ ...options, timeoutAfterApply: true }); const controller = createStatusController(repo, () => 'lost-response');
  controller.request((await repo.readDetail('user-01')).user, 'disabled');
  const result = await controller.confirm(); assert.equal(result.state, 'success'); assert.equal(result.result.replayed, true);
  assert.equal((await repo.readDetail('user-01')).audit.length, 1);
});
test('revision conflict requires review and a new confirmation instead of silent overwrite', async () => {
  const repo = createAdminUsersMockService(options); const controller = createStatusController(repo, () => 'stale-confirm');
  controller.request((await repo.readDetail('user-01')).user, 'disabled');
  await repo.changeStatus({ userId: 'user-01', targetStatus: 'disabled', expectedRevision: 1, operationId: 'other-admin' });
  const result = await controller.confirm(); assert.equal(result.state, 'error'); assert.equal(result.latest.user.revision, 2);
  await assert.rejects(controller.retry(), e => e.code === 'conflict');
});
