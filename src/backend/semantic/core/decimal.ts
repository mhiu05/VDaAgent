import Decimal from 'decimal.js';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';

export const Money = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

export function positive(value: string | null): Decimal | null {
  if (value === null) return null;
  const parsed = new Money(value);
  return parsed.gt(0) ? parsed : null;
}

export function pricePerArea(row: UnitSnapshot): Decimal | null {
  const price = positive(row.list_price);
  const area = positive(row.area_sqm);
  return price && area ? price.div(area) : null;
}

export function percentile(values: Decimal[], p: number): Decimal | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const index = new Money(sorted.length - 1).mul(p);
  const lower = index.floor().toNumber();
  const upper = index.ceil().toNumber();
  return lower === upper
    ? sorted[lower]
    : sorted[lower].plus(sorted[upper].minus(sorted[lower]).mul(index.minus(lower)));
}

export const percent = (numerator: number, denominator: number) =>
  denominator ? new Money(numerator).div(denominator).mul(100).toFixed(6) : null;
export const decimalOf = (value: number | string) => new Money(value);
