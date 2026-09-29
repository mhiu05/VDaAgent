import type { SnapshotRow } from '@vda/contracts/imports/inventory';

export function validateHierarchy(rows: SnapshotRow[], existing: SnapshotRow[] = []): void {
  const keys = new Set<string>();
  const relations = new Map<string, string>();
  for (const row of [...existing, ...rows]) {
    for (const [key, value] of [
      [`market:${row.market_external_id}`, row.market_name],
      [`project:${row.project_external_id}`, `${row.market_external_id}|${row.project_name}`],
      [`zone:${row.zone_external_id}`, `${row.project_external_id}|${row.zone_name}`],
      [`unit:${row.unit_external_id}`, `${row.zone_external_id}|${row.unit_code}|${row.unit_type}`],
    ]) {
      const prior = relations.get(key);
      if (prior !== undefined && prior !== value) throw new Error('HIERARCHY_CONFLICT');
      relations.set(key, value);
    }
  }
  for (const row of rows) {
    const key = `${row.unit_external_id}|${row.snapshot_date}`;
    if (keys.has(key)) throw new Error('DUPLICATE_SNAPSHOT');
    keys.add(key);
  }
}
