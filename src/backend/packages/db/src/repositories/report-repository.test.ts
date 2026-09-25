import { describe, expect, it } from 'vitest';
import type { Driver, Row } from '../driver';
import { storeReportExport } from './report-repository';

describe('report export transaction boundary', () => {
  it('authorizes before upload and writes the ledger in a second transaction', async () => {
    const order: string[] = [];
    const tx: Driver = {
      kind: 'postgres',
      query: async (sql) => {
        if (sql.includes('FROM organization_members')) return [{ role: 'viewer' }] as Row[];
        if (sql.includes('FROM reports')) return [{ payload: '{}' }] as Row[];
        if (sql.startsWith('INSERT INTO report_exports')) order.push('ledger');
        return [];
      },
      transaction: async (callback) => callback(tx),
      close: async () => {},
    };
    const db: Driver = {
      ...tx,
      transaction: async (callback) => {
        order.push('begin');
        const result = await callback(tx);
        order.push('commit');
        return result;
      },
    };
    const result = await storeReportExport(
      db,
      { storage: { upload: async () => void order.push('upload') } },
      'viewer',
      'org',
      'report',
      'json',
      'hash',
      '{}',
      'application/json',
    );

    expect(result).toEqual({ storage_path: 'org/report/hash.json' });
    expect(order).toEqual(['begin', 'commit', 'upload', 'begin', 'ledger', 'commit']);
  });
});
