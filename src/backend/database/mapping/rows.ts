import type { Row } from '../driver';

export const json = (row: Row) => {
  if (typeof row.payload === 'string') return JSON.parse(row.payload);
  if (Array.isArray(row.payload))
    return row.payload.reduce<Record<string, unknown>>(
      (value, item) => ({ ...value, ...(typeof item === 'string' ? JSON.parse(item) : item) }),
      {},
    );
  return row.payload;
};
