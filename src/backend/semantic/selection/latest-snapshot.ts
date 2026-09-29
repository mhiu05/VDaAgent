import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import { DateSchema } from '@vda/contracts/common/primitives';
import type { Scope } from '@vda/contracts/common/primitives';

export function selectLatest(
  rows: UnitSnapshot[],
  orgId: string,
  asOf: string,
  scope?: Scope,
): UnitSnapshot[] {
  DateSchema.parse(asOf);
  const latest = new Map<string, UnitSnapshot>();
  const identities = new Set<string>();
  for (const row of rows) {
    if (row.org_id !== orgId) throw new Error('CROSS_TENANT_SNAPSHOT');
    const identity = `${row.unit_external_id}:${row.snapshot_date}`;
    if (identities.has(identity)) throw new Error('DUPLICATE_SNAPSHOT');
    identities.add(identity);
    if (row.snapshot_date > asOf) continue;
    const current = latest.get(row.unit_external_id);
    if (!current || row.snapshot_date > current.snapshot_date)
      latest.set(row.unit_external_id, row);
  }
  return [...latest.values()]
    .filter(
      (row) =>
        !scope ||
        (row.project_external_id === scope.project_external_id &&
          (!scope.zone_external_id || row.zone_external_id === scope.zone_external_id)),
    )
    .sort((a, b) => a.unit_external_id.localeCompare(b.unit_external_id));
}
