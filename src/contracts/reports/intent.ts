export type ReportIntent = 'new' | 'update';

/** Shared admission/publication semantics; explicit user selection wins. */
export function resolveReportIntent(input: { text: string; report_intent?: unknown }): ReportIntent | null {
  if (input.report_intent === 'new' || input.report_intent === 'update') return input.report_intent;
  const text = input.text.normalize('NFC');
  if (/\b(?:new|separate|another)\s+(?:(?:executive|management)\s+)?report\b|(?:báo cáo).{0,35}(?:mới|riêng|khác)/iu.test(text)) return 'new';
  if (/(?:\b(?:update|fix|revise|edit|modify)\b.*\b(?:report|chart)\b)|(?:(?:cập nhật|sửa|chỉnh sửa).*(?:báo cáo|biểu đồ))/iu.test(text)) return 'update';
  return null;
}
