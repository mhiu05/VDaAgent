import { describe, expect, it } from 'vitest';
import type { Driver, Row } from '../../../src/backend/database/driver';
import { storeReportExport } from '../../../src/backend/database/repositories/report-repository';

describe('report export persistence', () => {
  it('finishes authorization before upload and records the export only afterward', async () => {
    const operations: string[] = [];
    const inside: Driver = {
      kind: 'postgres',
      query: async (sql) => {
        if (sql.includes('FROM organization_members')) return [{ role: 'viewer' }] as Row[];
        if (sql.includes('FROM reports')) return [{ payload: '{}' }] as Row[];
        if (sql.startsWith('INSERT INTO report_exports')) operations.push('record export');
        return [];
      },
      transaction: async (callback) => callback(inside),
      close: async () => {},
    };
    const db: Driver = {
      ...inside,
      transaction: async (callback) => {
        operations.push('begin');
        const result = await callback(inside);
        operations.push('commit');
        return result;
      },
    };

    const saved = await storeReportExport(
      db,
      {
        storage: {
          upload: async () => {
            operations.push('upload');
          },
        },
      },
      'viewer',
      'org',
      'report',
      'json',
      'hash',
      '{}',
      'application/json',
    );

    expect(saved).toEqual({ storage_path: 'org/report/hash.json' });
    expect(operations).toEqual(['begin', 'commit', 'upload', 'begin', 'record export', 'commit']);
  });
});
