import { randomUUID } from 'node:crypto';
import { type UnitSnapshot } from '@vda/contracts';
export const ORG = '10000000-0000-4000-8000-000000000001';
export function row(overrides: Partial<UnitSnapshot> = {}): UnitSnapshot {
  return {
    org_id: ORG,
    import_id: '30000000-0000-4000-8000-000000000001',
    snapshot_id: randomUUID(),
    snapshot_date: '2026-09-19',
    market_external_id: 'VN',
    market_name: 'Việt Nam synthetic',
    project_external_id: 'P-ALPHA',
    project_name: 'Riverside synthetic',
    zone_external_id: 'Z-NORTH',
    zone_name: 'North',
    unit_external_id: randomUUID(),
    unit_code: 'SYNTHETIC',
    unit_type: 'apartment',
    area_sqm: '100',
    list_price: '3000000000',
    currency: 'VND',
    status: 'available',
    available_since: '2026-06-21',
    sold_at: null,
    bedrooms: null,
    ...overrides,
  };
}
export function oracleRows(): UnitSnapshot[] {
  return [
    row({ unit_external_id: 'U1' }),
    row({ unit_external_id: 'U2', available_since: null }),
    row({ unit_external_id: 'U3', snapshot_date: '2026-09-01' }),
    row({ unit_external_id: 'U3', status: 'sold', sold_at: '2026-09-19' }),
    row({ unit_external_id: 'U4', status: 'sold', sold_at: '2026-08-21' }),
    row({ unit_external_id: 'U5', status: 'sold', sold_at: '2026-08-20' }),
    row({ unit_external_id: 'U6', status: 'reserved' }),
    row({ unit_external_id: 'U7', status: 'unknown' }),
    row({ unit_external_id: 'U8', status: 'held' }),
    row({
      unit_external_id: 'U1',
      snapshot_date: '2026-09-20',
      status: 'sold',
      sold_at: '2026-09-20',
    }),
  ];
}
