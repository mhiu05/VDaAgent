import { describe, expect, it } from 'vitest';
import { resolveReportIntent } from './intent';

describe('report intent', () => {
  it.each([
    ['Fix chart 2 in the current report.', 'update'],
    ['Update the report.', 'update'],
    ['Create a separate executive report for the CEO.', 'new'],
    ['Create another report and revise its chart.', 'new'],
    ['Cập nhật báo cáo hiện tại.', 'update'],
    ['Tạo báo cáo mới cho giám đốc.', 'new'],
    ['Compare these reports.', null],
  ])('resolves %s', (text, expected) => {
    expect(resolveReportIntent({ text })).toBe(expected);
  });
  it('preserves explicit intent over inferred language', () => {
    expect(resolveReportIntent({ text: 'Update the report', report_intent: 'new' })).toBe('new');
  });
});
