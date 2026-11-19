import { describe, expect, it } from 'vitest';
import { createReportFixtures } from '../../../mocks/reports/fixtures';
import { normalizeServiceError } from '../../../shared/contracts/normalize-service-error';
import { decodeReportVersion } from '../adapters/decode-version';

describe('report adapter domain decoding', () => {
  const selected = { reportId: 'R001', versionId: 'R001-v1' };
  const fixture = () => structuredClone(createReportFixtures().versions[0]);
  it('accepts mock and API-normalized snapshots under the same domain contract', () => {
    for (const mode of ['mock', 'api'] as const) {
      const input = fixture(); input.source.mode = mode;
      const decoded = decodeReportVersion(input, selected);
      expect(decoded).toEqual({ ...input, source: { ...input.source,
        dataThrough: new Date(input.source.dataThrough).toISOString(), updatedAt: new Date(input.source.updatedAt).toISOString() } });
      expect(decoded).not.toBe(input);
    }
  });
  it('normalizes offset timestamps to instants without changing the business cutoff', () => {
    const input = fixture();
    input.completedAt = '2026-10-16T00:59:59.001+08:00';
    const decoded = decodeReportVersion(input, selected);
    expect(decoded.completedAt).toBe('2026-10-15T16:59:59.001Z');
    expect(decoded.source.dataThrough).toBe(input.source.dataThrough.replace('59Z', '59.000Z'));
  });
  it('preserves explicit null values without manufacturing zeros', () => {
    const input = fixture();
    const chart = input.sections.find(item => item.kind === 'chart')!;
    chart.values = [null, ...chart.values.slice(1)];
    expect(decodeReportVersion(input, selected).sections.find(item => item.kind === 'chart')!.values[0]).toBeNull();
  });
  it('rejects missing fields, nonfinite numbers, bad shapes, chronology, and cross-version references', () => {
    const inputs: unknown[] = [null, {}, { ...fixture(), completedAt: '2026-10-16' },
      { ...fixture(), sections: undefined }, { ...fixture(), reportId: 'R002' },
      { ...fixture(), id: 'R001-v2' }, { ...fixture(), evidenceIds: [] },
      { ...fixture(), source: { ...fixture().source, dataThrough: '2030-01-01T00:00:00Z' } },
      { ...fixture(), sections: [{ id: 'x', title: 'x', kind: 'markdown' }] },
      { ...fixture(), sections: [{ id: 'x', title: 'x', kind: 'chart', labels: ['x'], values: [NaN], sourceId: 'source', unit: 'x', question: 'x' }] },
      { ...fixture(), sections: [{ id: 'x', title: 'x', kind: 'chart', labels: ['x'], values: [], sourceId: 'source', unit: 'x', question: 'x' }] },
    ];
    for (const input of inputs) expect(() => decodeReportVersion(input, selected)).toThrow();
  });
});

describe('adapter error normalization', () => {
  it.each([[403, 'forbidden', false], [404, 'notFound', false], [409, 'conflict', true], [422, 'validation', false], [408, 'timeout', true], [501, 'unsupported', false], [503, 'unavailable', true]] as const)('normalizes status %s into a stable application error', (status, code, retryable) => {
    const keys: Record<string, string> = { forbidden: 'unauthorized', validation: 'invalid', conflict: 'saveError', timeout: 'unavailable' };
    expect(normalizeServiceError({ status, message: 'server-private-message' })).toEqual({ code, messageKey: `app:${keys[code] ?? code}`, retryable });
  });
  it('maps unknown failures safely and preserves abort control flow', () => {
    expect(normalizeServiceError(new Error('secret'))).toMatchObject({ code: 'unavailable' });
    expect(normalizeServiceError({ code: 'timeout' })).toMatchObject({ code: 'timeout' });
    const abort = new DOMException('Stopped', 'AbortError');
    expect(() => normalizeServiceError(abort)).toThrow(abort);
  });
});
