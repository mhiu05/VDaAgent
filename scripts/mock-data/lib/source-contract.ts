export type RawRecord = Record<string, string>;

export const MOCK_MARKER = 'MOCK_ONLY';

export const HEADERS = {
  organization: [
    'org_id',
    'organization_name',
    'country_code',
    'dataset_version',
    'synthetic_marker',
  ],
  market: [
    'market_external_id',
    'market_code',
    'market_name',
    'country_code',
    'currency',
    'dataset_version',
    'synthetic_marker',
  ],
  project: [
    'project_external_id',
    'project_name',
    'market_external_id',
    'market_name',
    'project_type',
    'launch_date',
    'expected_handover_date',
    'total_units',
    'project_status',
    'price_segment',
    'synthetic_marker',
  ],
  zone: [
    'zone_external_id',
    'zone_name',
    'project_external_id',
    'project_name',
    'zone_sequence',
    'building_block_count',
    'total_units',
    'dataset_version',
    'synthetic_marker',
  ],
  unit: [
    'unit_external_id',
    'unit_code',
    'org_id',
    'market_external_id',
    'project_external_id',
    'zone_external_id',
    'unit_type',
    'area_sqm',
    'bedrooms',
    'floor_number',
    'building_block',
    'view_type',
    'orientation',
    'initial_list_price',
    'currency',
    'launch_date',
    'dataset_version',
    'synthetic_marker',
  ],
  inventory: [
    'org_id',
    'snapshot_id',
    'import_id',
    'snapshot_date',
    'country_code',
    'market_external_id',
    'market_name',
    'project_external_id',
    'project_name',
    'zone_external_id',
    'zone_name',
    'unit_external_id',
    'unit_code',
    'unit_type',
    'area_sqm',
    'list_price',
    'currency',
    'status',
    'available_since',
    'sold_at',
    'bedrooms',
    'floor_number',
    'building_block',
    'view_type',
    'orientation',
    'handover_status',
    'sales_channel',
    'source_system',
    'batch_id',
    'dataset_version',
    'synthetic_marker',
  ],
  transaction: [
    'transaction_id',
    'org_id',
    'unit_external_id',
    'project_external_id',
    'zone_external_id',
    'transaction_date',
    'transaction_type',
    'transaction_status',
    'currency',
    'gross_amount',
    'discount_amount',
    'net_amount',
    'payment_method',
    'sales_channel',
    'customer_segment',
    'agent_external_id',
    'contract_type',
    'cancellation_reason',
    'dataset_version',
    'synthetic_marker',
  ],
  priceHistory: [
    'price_history_id',
    'org_id',
    'unit_external_id',
    'project_external_id',
    'effective_date',
    'previous_price',
    'new_price',
    'currency',
    'change_percent',
    'change_reason',
    'approved_by',
    'dataset_version',
    'synthetic_marker',
  ],
  reservation: [
    'reservation_id',
    'org_id',
    'unit_external_id',
    'project_external_id',
    'reservation_date',
    'expiry_date',
    'status',
    'deposit_amount',
    'currency',
    'sales_channel',
    'customer_segment',
    'cancellation_reason',
    'dataset_version',
    'synthetic_marker',
  ],
} as const;

export type HeaderKey = keyof typeof HEADERS;

export type Manifest = {
  dataset_version: string;
  synthetic_marker: string;
  row_counts: Record<string, number>;
  totals: Record<string, number>;
  snapshot_dates: string[];
};

export type SourceImport = {
  importId: string;
  snapshotDate: string;
  rowCount: number;
};

export function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

export function integer(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`invalid integer ${field}`);
  return parsed;
}

export function nullableInteger(value: string, field: string): number | null {
  return value === '' ? null : integer(value, field);
}

export function assertRecord(
  row: RawRecord,
  datasetVersion: string,
  orgId: string,
  file: string,
): void {
  if (row.synthetic_marker !== MOCK_MARKER)
    throw new Error(`${file}: synthetic_marker must be ${MOCK_MARKER}`);
  if ('dataset_version' in row && row.dataset_version !== datasetVersion)
    throw new Error(`${file}: unexpected dataset_version`);
  if ('org_id' in row && row.org_id !== orgId) throw new Error(`${file}: cross-organization row`);
}
