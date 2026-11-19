import type { ReportDataset } from '../../features/reports/index';
import { createReportFixtures, renderDemoHtml } from './fixtures';

export type ReportsScenario = 'S01' | 'S03' | 'S08' | 'S09' | 'S10' | 'S11' | 'S14' | 'S15' | 'S17' | 'S18';
export function createReportsScenario(id: ReportsScenario): ReportDataset {
  const data = createReportFixtures();
  if (id === 'S08') {
    const record = data.records[0]; const attemptId = `${record.id}-failed-regeneration`;
    record.latestAttemptId = attemptId;
    data.attempts = [...data.attempts, { id: attemptId, reportId: record.id, state: 'failed', createdAt: '2026-10-15T18:00:00Z', finishedAt: '2026-10-15T18:01:00Z', versionId: null }];
  }
  if (id === 'S09') {
    const latest = data.versions.find(v => v.id === 'R001-v2')!;
    latest.completedAt = '2026-10-16T01:00:00Z';
    data.attempts.find(a => a.versionId === latest.id)!.finishedAt = latest.completedAt;
    data.artifacts = data.artifacts.map(a => a.versionId === latest.id && a.mediaType === 'text/html' ? { ...a, content: renderDemoHtml(data.records[0], latest, data.evidence.filter(e => latest.evidenceIds.includes(e.id))) } : a);
  }
  if (id === 'S10' || id === 'S11') {
    data.records[0].title = 'Phân tích chuyên sâu dữ liệu mô phỏng về tuổi tồn kho, chất lượng ngày mở bán và phạm vi so sánh giữa các dự án trong bối cảnh nguồn chưa đầy đủ — Báo cáo dài phục vụ kiểm thử đọc hiểu';
    if (id === 'S10') for (const version of data.versions.filter(v => v.reportId === 'R001')) {
      version.sections = [...version.sections, ...Array.from({ length: 20 }, (_, index) => ({
        id: `appendix-${index + 1}`, kind: 'text' as const, title: `Phụ lục ${index + 1}: Đối chiếu dữ liệu`,
        paragraphs: Array.from({ length: 4 }, () => 'Dữ liệu mô phỏng được đối chiếu theo ID nguồn và ngày nghiệp vụ. Cần xem xét phạm vi, độ đầy đủ và chính sách trước khi sử dụng kết quả. Phụ lục mô tả giới hạn của phép so sánh, không bổ sung kết luận nguyên nhân khi thiếu bằng chứng.'),
      }))];
    }
    // Rebuild artifacts to keep their saved document and version metadata consistent.
    data.artifacts = data.artifacts.map(a => a.mediaType === 'text/html' ? { ...a, content: renderDemoHtml(data.records.find(r => r.id === data.versions.find(v => v.id === a.versionId)!.reportId)!, data.versions.find(v => v.id === a.versionId)!, data.evidence.filter(e => data.versions.find(v => v.id === a.versionId)!.evidenceIds.includes(e.id))) } : a);
  }
  if (id === 'S18') {
    const version = data.versions.find(v => v.id === 'R001-v2')!;
    data.artifacts = data.artifacts.filter(a => a.versionId !== version.id); version.artifactIds = [];
  }
  // S03 (no-match), S14 (principal), S15 (latency), S17 (query boundaries) vary request inputs, not records.
  return data;
}
