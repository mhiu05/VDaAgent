import type {
  RuntimeActivityEvent,
  RuntimeActivityRecord,
  RunRuntimeSnapshot,
} from '@vda/contracts';

export type RuntimeReconciliation = {
  view: RunRuntimeSnapshot;
  deliveredSequence: number;
  snapshotSequence: number;
  applied: RuntimeActivityEvent[];
};
export const emptyRuntimeReconciliation = (): RuntimeReconciliation => ({
  view: { records: [], events: [], last_sequence: 0 },
  deliveredSequence: 0,
  snapshotSequence: 0,
  applied: [],
});
function apply(records: RuntimeActivityRecord[], event: RuntimeActivityEvent) {
  const index = records.findIndex((record) => record.activity_id === event.record.activity_id);
  if (index < 0) return [...records, event.record];
  const result = [...records];
  result[index] = event.record;
  return result;
}
const terminalStatus = new Set(['completed', 'failed', 'cancelled']);
function preservesTerminal(previous: RuntimeActivityRecord, next: RuntimeActivityRecord) {
  return (
    terminalStatus.has(previous.status) &&
    !terminalStatus.has(next.status) &&
    next.updated_at <= previous.updated_at
  );
}
function applyLegacyEvent(records: RuntimeActivityRecord[], event: RuntimeActivityEvent) {
  const previous = records.find((record) => record.activity_id === event.record.activity_id);
  return previous && preservesTerminal(previous, event.record) ? records : apply(records, event);
}
function eventHistory(old: RuntimeActivityEvent[], incoming: RuntimeActivityEvent[]) {
  const bySequence = new Map(old.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence).slice(-100);
}

/** Record freshness and delivered event cursor are independent. */
export function installRuntimeSnapshot(
  current: RuntimeReconciliation,
  next: RunRuntimeSnapshot,
): RuntimeReconciliation {
  const deliveredSequence = Math.max(current.deliveredSequence, next.last_sequence);
  const events = eventHistory(current.view.events, next.events);
  const watermark = next.snapshot_sequence;
  if (watermark === undefined) {
    // Old servers lack a record watermark. Preserve delivered events beyond
    // their event page and avoid regressing a terminal record on equal times.
    const previousById = new Map(
      current.view.records.map((record) => [record.activity_id, record]),
    );
    let records = next.records.map((record) => {
      const previous = previousById.get(record.activity_id);
      return previous && preservesTerminal(previous, record) ? previous : record;
    });
    const applied = current.applied.filter((event) => event.sequence > next.last_sequence);
    for (const event of applied) records = applyLegacyEvent(records, event);
    return {
      ...current,
      view: { ...next, records, events, last_sequence: deliveredSequence },
      deliveredSequence,
      applied,
    };
  }
  if (watermark < current.snapshotSequence) {
    return {
      ...current,
      view: { ...current.view, events, last_sequence: deliveredSequence },
      deliveredSequence,
    };
  }
  const applied = current.applied.filter((event) => event.sequence > watermark);
  let records = next.records;
  for (const event of applied) records = apply(records, event);
  return {
    view: { ...next, records, events, last_sequence: deliveredSequence },
    deliveredSequence,
    snapshotSequence: watermark,
    applied,
  };
}
export function applyRuntimeEvent(
  current: RuntimeReconciliation,
  event: RuntimeActivityEvent,
): RuntimeReconciliation {
  if (event.sequence <= current.deliveredSequence) return current;
  const deliveredSequence = event.sequence;
  const events = eventHistory(current.view.events, [event]);
  if (current.view.snapshot_sequence === undefined) {
    const byRecord = new Map(current.applied.map((value) => [value.record.activity_id, value]));
    byRecord.set(event.record.activity_id, event);
    return {
      ...current,
      deliveredSequence,
      applied: [...byRecord.values()],
      view: {
        ...current.view,
        records: applyLegacyEvent(current.view.records, event),
        events,
        last_sequence: deliveredSequence,
      },
    };
  }
  if (event.sequence <= current.snapshotSequence)
    return {
      ...current,
      deliveredSequence,
      view: { ...current.view, events, last_sequence: deliveredSequence },
    };
  // Keep the newest event for each bounded runtime record. A long replay can
  // contain thousands of updates to other records before a refresh arrives.
  const byRecord = new Map(current.applied.map((value) => [value.record.activity_id, value]));
  byRecord.set(event.record.activity_id, event);
  const applied = [...byRecord.values()];
  return {
    ...current,
    deliveredSequence,
    applied,
    view: {
      ...current.view,
      records: apply(current.view.records, event),
      events,
      last_sequence: deliveredSequence,
    },
  };
}
