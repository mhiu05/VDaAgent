import { parse } from 'csv-parse/sync';
import { CSV_COLUMNS, SnapshotRowSchema, type SnapshotRow } from '@vda/contracts/imports/inventory';
import { validateHierarchy } from './hierarchy';

export function parseInventoryCsv(csv: string): SnapshotRow[] {
  const records = parse(csv, {
    bom: true,
    columns: false,
    skip_empty_lines: true,
    max_record_size: 10000,
  }) as string[][];
  const header = records.shift();
  if (!header || JSON.stringify(header) !== JSON.stringify(CSV_COLUMNS))
    throw new Error('CSV_HEADER_INVALID');
  if (!records.length || records.length > 10000) throw new Error('CSV_ROW_LIMIT');
  const rows = records.map((values, i) => {
    if (values.length !== CSV_COLUMNS.length) throw new Error(`CSV_COLUMNS_ROW_${i + 2}`);
    const row: Record<string, unknown> = Object.fromEntries(
      CSV_COLUMNS.map((key, j) => [key, values[j]]),
    );
    for (const key of ['area_sqm', 'list_price', 'available_since', 'sold_at'])
      if (row[key] === '') row[key] = null;
    const parsed = SnapshotRowSchema.safeParse(row);
    if (!parsed.success) throw new Error(`CSV_ROW_${i + 2}: ${parsed.error.message}`);
    return parsed.data;
  });
  validateHierarchy(rows);
  return rows;
}
