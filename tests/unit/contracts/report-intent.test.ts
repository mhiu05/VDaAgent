import { describe, expect, it } from 'vitest';
import { resolveReportIntent } from '../../../src/contracts/reports/intent';

describe('report identity intent', () => {
  it.each([
    ['Update the current report', 'update'],
    ['Create a separate report for the CEO', 'new'],
    ['Tạo báo cáo mới cho giám đốc', 'new'],
    ['Compare these reports', null],
  ] as const)('resolves %s', (text, expected) => {
    expect(resolveReportIntent({ text })).toBe(expected);
  });

  it('honors explicit new identity even when the wording suggests an update', () => {
    expect(resolveReportIntent({ text: 'Update the report', report_intent: 'new' })).toBe('new');
  });
});
