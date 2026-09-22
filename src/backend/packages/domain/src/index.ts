import { parse } from 'csv-parse/sync';
export * from './integrity';
export * from './report-sections';
export * from './agent-workflow';
export * from './decision-intelligence';
import {
  CSV_COLUMNS,
  SnapshotRowSchema,
  type SnapshotRow,
  type ReportDefinitionInput,
} from '@vda/contracts';

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
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function nextScheduledAt(
  def: Pick<ReportDefinitionInput, 'timezone' | 'local_time'>,
  after: Date,
): string {
  // Minute enumeration handles DST gaps and folds without assuming a fixed UTC offset.
  const start = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: def.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const afterDay = localDate(after, def.timezone);
  const pastDailyTime = formatter.format(after) >= def.local_time;
  for (let i = 0; i < 3000; i++) {
    const at = new Date(start + i * 60000);
    const time = formatter.format(at);
    if (time === def.local_time && (!pastDailyTime || localDate(at, def.timezone) > afterDay))
      return at.toISOString();
  }
  throw new Error('SCHEDULE_UNRESOLVABLE');
}
export function scheduledOnDate(
  def: Pick<ReportDefinitionInput, 'timezone' | 'local_time'>,
  day: string,
): string {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - 16 * 3600000);
  let slot = nextScheduledAt(def, start);
  for (let i = 0; i < 3 && localDate(new Date(slot), def.timezone) < day; i++)
    slot = nextScheduledAt(def, new Date(slot));
  if (localDate(new Date(slot), def.timezone) !== day)
    throw new Error('SCHEDULE_TIME_ABSENT_ON_DATE');
  return slot;
}
