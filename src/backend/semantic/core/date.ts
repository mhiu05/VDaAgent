import { DateSchema } from '@vda/contracts/common/primitives';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';

export function dayNumber(date: string): number {
  DateSchema.parse(date);
  return Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;
}

export function dateMinusDays(date: string, days: number): string {
  return new Date((dayNumber(date) - days) * 86_400_000).toISOString().slice(0, 10);
}

export function latestDate(rows: UnitSnapshot[]): string | null {
  return rows.length
    ? rows.reduce(
        (latest, row) => (row.snapshot_date > latest ? row.snapshot_date : latest),
        rows[0].snapshot_date,
      )
    : null;
}
