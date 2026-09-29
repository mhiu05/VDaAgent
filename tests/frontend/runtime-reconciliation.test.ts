import { describe, expect, it } from 'vitest';
import { RuntimeActivityEventSchema, RuntimeActivityRecordSchema } from '../../src/contracts';
import {
  applyRuntimeEvent,
  emptyRuntimeReconciliation,
  installRuntimeSnapshot,
} from '../../src/frontend/features/agent-chat/runtime-reconciliation';

const id = 'a4019134-4c1a-4bd7-a763-7f6060808628';
const run = '4cbe66a9-714c-4ced-b01e-25dd8292a363';
const org = 'f1a3a5c1-5374-4ee8-b4a6-857b13071b2a';
const date = '2026-09-29T12:34:56.000Z';
function record(status: 'running' | 'completed', activityId = id) {
  return RuntimeActivityRecordSchema.parse({
    activity_id: activityId,
    org_id: org,
    run_id: run,
    conversation_id: null,
    kind: 'invocation',
    step_key: `team:${activityId}`,
    agent_key: 'coordinator',
    status,
    summary: status,
    created_at: date,
    updated_at: date,
  });
}
function event(sequence: number, status: 'running' | 'completed' = 'running', activityId = id) {
  return RuntimeActivityEventSchema.parse({
    event_id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    run_id: run,
    sequence,
    type: 'invocation',
    record: record(status, activityId),
    created_at: date,
  });
}
describe('runtime replay reconciliation', () => {
  it('drains more than 500 event updates without regressing a newer record snapshot', () => {
    let state = installRuntimeSnapshot(emptyRuntimeReconciliation(), {
      records: [record('completed')],
      events: Array.from({ length: 500 }, (_, i) => event(i + 1)),
      last_sequence: 500,
      snapshot_sequence: 600,
    });
    for (let sequence = 501; sequence <= 600; sequence++)
      state = applyRuntimeEvent(state, event(sequence));
    expect(state.deliveredSequence).toBe(600);
    expect(state.view.records[0]?.status).toBe('completed');
    expect(state.view.last_sequence).toBe(600);
    expect(state.view.events.at(-1)?.sequence).toBe(600);
  });
  it('retains live events newer than a delayed record snapshot', () => {
    let state = installRuntimeSnapshot(emptyRuntimeReconciliation(), {
      records: [record('running')],
      events: [],
      last_sequence: 0,
      snapshot_sequence: 1,
    });
    state = applyRuntimeEvent(state, event(2, 'completed'));
    state = installRuntimeSnapshot(state, {
      records: [record('running')],
      events: [event(1)],
      last_sequence: 1,
      snapshot_sequence: 1,
    });
    expect(state.view.records[0]?.status).toBe('completed');
    expect(state.deliveredSequence).toBe(2);
  });
  it('keeps a quiet completed record fresh through more than 500 updates to another record', () => {
    const other = 'b4019134-4c1a-4bd7-a763-7f6060808628';
    let state = installRuntimeSnapshot(emptyRuntimeReconciliation(), {
      records: [record('running'), record('running', other)],
      events: [event(1)],
      last_sequence: 1,
      snapshot_sequence: 1,
    });
    state = applyRuntimeEvent(state, event(2, 'completed'));
    for (let sequence = 3; sequence <= 603; sequence++)
      state = applyRuntimeEvent(state, event(sequence, 'running', other));
    state = installRuntimeSnapshot(state, {
      records: [record('running'), record('running', other)],
      events: [],
      last_sequence: 1,
      snapshot_sequence: 1,
    });
    expect(state.view.records.find((value) => value.activity_id === id)?.status).toBe('completed');
    expect(state.deliveredSequence).toBe(603);
  });
  it('treats old-server snapshots as authoritative while tracking delivered events', () => {
    let state = installRuntimeSnapshot(emptyRuntimeReconciliation(), {
      records: [record('completed')],
      events: [],
      last_sequence: 0,
    });
    state = applyRuntimeEvent(state, event(1));
    expect(state.view.records[0]?.status).toBe('completed');
    expect(state.deliveredSequence).toBe(1);
  });
});
