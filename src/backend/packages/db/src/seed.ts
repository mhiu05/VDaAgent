import type { SnapshotRow } from '@vda/contracts';
export const TEST_ORGS = {
  alpha: '10000000-0000-4000-8000-000000000001',
  beta: '10000000-0000-4000-8000-000000000002',
} as const;
export const TEST_USERS = {
  owner: '20000000-0000-4000-8000-000000000001',
  analyst: '20000000-0000-4000-8000-000000000002',
  viewer: '20000000-0000-4000-8000-000000000003',
  beta: '20000000-0000-4000-8000-000000000004',
} as const;
export const TEST_SNAPSHOT_DATE = '2026-09-19';
export function syntheticRows(): SnapshotRow[] {
  return Array.from({ length: 12 }, (_, i) => ({
    snapshot_date: TEST_SNAPSHOT_DATE,
    market_external_id: 'VN',
    market_name: 'Việt Nam (synthetic)',
    project_external_id: 'P-ALPHA',
    project_name: 'Riverside (synthetic)',
    zone_external_id: i < 8 ? 'Z-NORTH' : 'Z-SOUTH',
    zone_name: i < 8 ? 'North' : 'South',
    unit_external_id: `U-${i + 1}`,
    unit_code: `RS-${String(i + 1).padStart(3, '0')}`,
    unit_type: 'apartment',
    area_sqm: i === 11 ? '0' : '80',
    list_price: String(3000000000 + i * 100000000),
    currency: 'VND',
    status: i === 9 ? 'sold' : i === 10 ? 'reserved' : 'available',
    available_since: i === 7 ? null : i < 6 ? '2026-05-01' : '2026-09-01',
    sold_at: i === 9 ? '2026-09-10' : null,
    bedrooms: 2,
  }));
}
