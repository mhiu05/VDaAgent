import type { Artifact, Clock, Evidence, GenerationAttempt, Principal, ReportBlock, ReportDataset, ReportRecord, ReportScope, ReportType, ReportVersion, SourceMeta } from '../../features/reports/model/types';
import { withRiversideReport } from './riverside-adapter';

export const DEMO_NOW = '2026-10-16T02:00:00Z';
export const demoClock: Clock = { now: () => new Date(DEMO_NOW) };
export const demoScope: ReportScope = { from: '2026-09-16', to: '2026-10-16', timezone: 'Asia/Bangkok' };
export const previousScope: ReportScope = { from: '2026-08-17', to: '2026-09-16', timezone: 'Asia/Bangkok' };
export const reportSource: SourceMeta = { id: 'source-reports', mode: 'mock', label: 'Báo cáo mô phỏng VDA', dataThrough: '2026-10-15T16:59:59Z', updatedAt: '2026-10-16T01:40:00Z', completeness: 'full' };
export const demoUser: Principal = { id: 'user-01', role: 'USER', projectIds: ['P-A', 'P-B', 'P-C'], reportIds: Array.from({ length: 18 }, (_, i) => `R${String(i + 1).padStart(3, '0')}`) };
export const demoAdmin: Principal = { id: 'admin-demo', role: 'ADMIN', projectIds: [], reportIds: [] };
const projectLabels = ['VDA Demo Riverside', 'VDA Demo Green Park', 'VDA Demo Long Garden'];
const marketIds = ['HCM', 'BD', 'LA'];
const authors = ['Nguyễn Minh Anh', 'Trần Bảo Hân', 'Lê Quốc Huy'];
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function documentSections(project: number, versionId: string, evidenceId: string, type: ReportType): ReportBlock[] {
  if (type === 'transactions') {
    const current = [24, 15, 6][project]; const previous = [28, 16, 6][project];
    const days = Array.from({ length: 30 }, (_, i) => new Date(Date.parse('2026-09-16') + i * 86400000).toISOString().slice(0, 10));
    const values = days.map((_, day) => Array.from({ length: current }, (_, i) => (i * 7 + project) % 30).filter(index => index === day).length);
    return [
      { id: 'summary', kind: 'text', title: 'Tóm tắt điều hành', paragraphs: [`DỮ LIỆU MÔ PHỎNG — ${projectLabels[project]}; bản lưu ${versionId}. Kỳ 30 ngày [16/09/2026, 16/10/2026) có ${current} giao dịch hoàn tất, so với ${previous} trong kỳ [17/08/2026, 16/09/2026).`, 'Báo cáo mô tả số giao dịch quan sát được, không kết luận về giá, nhu cầu hoặc hiệu quả bán hàng khi thiếu nguồn tương ứng.'] },
      { id: 'context', kind: 'text', title: 'Bối cảnh và phạm vi', paragraphs: ['Ngày nghiệp vụ theo Asia/Bangkok. Hai kỳ đều dài 30 ngày và đã kết thúc. Trạng thái hoàn tất khác với giữ chỗ; giao dịch hủy, bản ghi kiểm thử và ID lặp không làm tăng tổng.', 'Đây là số luồng trong kỳ, không phải tồn kho. Thay đổi tồn kho còn phụ thuộc thêm căn, rút căn và thay đổi trạng thái.'] },
      { id: 'finding-volume', kind: 'finding', title: 'Biến động số giao dịch', text: `${current} so với ${previous} giao dịch hoàn tất. Chênh lệch ${current - previous} giao dịch; chưa có bằng chứng để xác định nguyên nhân.`, evidenceIds: [evidenceId] },
      { id: 'metrics', kind: 'metric-table', title: 'Tổng giao dịch', columns: ['Kỳ', 'Giao dịch', 'Độ đầy đủ'], rows: [['Hiện tại', current, '30/30 ngày'], ['Trước', previous, '30/30 ngày']], unit: 'giao dịch' },
      { id: 'transaction-chart', kind: 'chart', chartType: 'line', title: 'Giao dịch hoàn tất theo ngày', question: 'Giao dịch được phân bổ thế nào trong kỳ?', unit: 'giao dịch/ngày', labels: days, values, sourceId: 'source-transactions' },
      { id: 'comparison', kind: 'comparison', title: 'So sánh hai kỳ bằng nhau', columns: ['Chỉ tiêu', 'Giá trị'], rows: [['Chênh lệch tuyệt đối (giao dịch)', current - previous], ['Thay đổi (%)', (current - previous) / previous * 100]], unit: 'giao dịch và %; không phải điểm phần trăm' },
      { id: 'recommendation', kind: 'recommendation', title: 'Bước kiểm tra tiếp theo', text: 'Đối chiếu ID và ngày hoàn tất tại nguồn trước khi phân tích biến động. Bổ sung lịch sử giá và điều kiện ghi nhận nếu muốn đánh giá nguyên nhân; số giao dịch đơn lẻ chưa đủ cho kết luận đó.', evidenceIds: [evidenceId] },
      { id: 'methodology', kind: 'methodology', title: 'Phương pháp', paragraphs: ['Đếm transactionId duy nhất, không phải số sự kiện cập nhật. Lọc completedAt theo khoảng nửa mở [from,to), loại giao dịch hủy và kiểm thử. Ngày đủ nguồn không phát sinh bằng 0; ngày thiếu nguồn là null.', 'Phần trăm thay đổi = (hiện tại − trước) / trước × 100. Baseline bằng 0 thì không có phần trăm so sánh. Số ngày và phạm vi dự án phải tương đương.'] },
      { id: 'limitations', kind: 'limitations', title: 'Giới hạn', paragraphs: ['Dữ liệu mô phỏng được sinh xác định cho kiểm thử, không được xác nhận từ hệ thống giao dịch thật. Không có số tiền, thuế, lịch sử hợp đồng hoặc phân loại khách hàng.', 'Không suy ra mùa vụ hay nguyên nhân bán chậm từ hai tổng kỳ. Phiên bản đã lưu giữ nguyên khi Dashboard hoặc bộ lọc thay đổi.'] },
    ];
  }
  const counts = [60, 40, 20]; const eligible = [56, 40, 18]; const slow = [20, 12, 4];
  const bins = [[24, 12, 14, 6, 4], [18, 10, 8, 4, 0], [8, 6, 2, 2, 2]];
  return [
    { id: 'summary', kind: 'text', title: 'Tóm tắt điều hành', paragraphs: [
      `DỮ LIỆU MÔ PHỎNG — ${projectLabels[project]}. Bản lưu ${versionId} phân tích tồn kho tại mốc chốt 15/10/2026. Đây là tài liệu kiểm thử trải nghiệm đọc, không phải tư vấn đầu tư hoặc số liệu thị trường đã được xác minh.`,
      `Có ${counts[project]} căn khả dụng, ${eligible[project]} căn có ngày mở bán hợp lệ và ${slow[project]} căn đạt ngưỡng tuổi 180 ngày theo chính sách demo. Tỷ lệ được tính trên mẫu có ngày hợp lệ; phần chưa rõ tuổi vẫn thuộc tổng tồn.`,
    ] },
    { id: 'context', kind: 'text', title: 'Bối cảnh và phạm vi', paragraphs: [
      'Kỳ quan sát giao dịch là [16/09/2026, 16/10/2026), múi giờ Asia/Bangkok. Tồn kho là trạng thái tại mốc chốt, giao dịch là luồng trong kỳ; hai đại lượng không đối soát trực tiếp nếu chưa có sổ thay đổi trạng thái.',
      'Nguồn là snapshot tổng hợp có ID ổn định. Không có dữ liệu giá, chiến dịch quảng cáo hoặc hành vi khách hàng; báo cáo không suy đoán nguyên nhân bán chậm.',
    ] },
    { id: 'finding-age', kind: 'finding', title: 'Tín hiệu cần kiểm tra', text: `${slow[project]}/${eligible[project]} căn đủ dữ liệu có tuổi từ 180 ngày. Đây là tín hiệu về tuổi tồn, chưa chứng minh nguyên nhân hoặc khả năng thanh khoản.`, evidenceIds: [evidenceId] },
    { id: 'metrics', kind: 'metric-table', title: 'Chỉ số tại mốc chốt', columns: ['Chỉ tiêu', 'Giá trị', 'Định nghĩa'], rows: [
      ['Tồn khả dụng', counts[project], 'available tại snapshot'], ['Đủ ngày mở bán', eligible[project], 'Không thiếu hoặc ngày tương lai'],
      ['Tuổi từ 180 ngày', slow[project], 'slow-demo-180d-v1'], ['Chưa rõ tuổi', counts[project] - eligible[project], 'Không tính vào mẫu số tỷ lệ'],
    ], unit: 'căn' },
    { id: 'age-chart', kind: 'chart', title: 'Phân bố tuổi tồn kho', question: 'Tồn kho tập trung ở độ tuổi nào?', unit: 'căn', labels: ['0–89 ngày', '90–179 ngày', '180–359 ngày', 'Từ 360 ngày', 'Chưa rõ tuổi'], values: bins[project], sourceId: 'source-inventory' },
    { id: 'comparison', kind: 'comparison', title: 'So sánh với mốc trước', columns: ['Chỉ tiêu', 'Hiện tại', 'Trước'], rows: [
      ['Tồn khả dụng (căn)', counts[project], [66, 44, 22][project]], ['Đủ ngày (căn)', eligible[project], [64, 42, 22][project]],
      ['Tuổi từ 180 ngày (căn)', slow[project], [18, 10, 4][project]],
    ], unit: 'căn; hai snapshot, không phải cohort cố định' },
    { id: 'recommendation', kind: 'recommendation', title: 'Hành động có điều kiện', text: 'Đối chiếu ngày mở bán bị thiếu với nguồn gốc trước khi quyết định ưu tiên. Xem danh sách căn lớn tuổi và phạm vi dữ liệu; chỉ phân tích nguyên nhân sau khi bổ sung lịch sử giá, nguồn khách và thay đổi trạng thái.', evidenceIds: [evidenceId] },
    { id: 'methodology', kind: 'methodology', title: 'Phương pháp', paragraphs: [
      'Đếm propertyId duy nhất có trạng thái available tại snapshot cuối kỳ. Tuổi tồn dùng chênh lệch ngày lịch tại múi giờ nghiệp vụ, không dùng số mili giây chia 24 giờ. Ngưỡng demo là 180 ngày.',
      'Phần trăm thay đổi dùng baseline khác 0; chênh lệch hai tỷ lệ dùng điểm phần trăm. Giữ độ chính xác gốc đến bước định dạng. Dữ liệu thiếu không được đổi thành số 0.',
    ] },
    { id: 'limitations', kind: 'limitations', title: 'Giới hạn và nguồn', paragraphs: [
      'Mọi tên dự án và số liệu là mô phỏng có chủ đích. Chính sách bán chậm chưa được xác nhận để sử dụng trong vận hành thực tế. Không có công bố hoặc workflow chỉnh sửa báo cáo.',
      'Ngày chốt dữ liệu khác ngày nhập nguồn và thời điểm xem. Phiên bản đã lưu không cập nhật khi Dashboard thay đổi. Báo cáo không cung cấp chỉ báo sức khỏe agent, dự báo, khuyến nghị giá hoặc khẳng định nguyên nhân.',
    ] },
  ];
}
export function renderDemoHtml(record: ReportRecord, version: ReportVersion, evidence: readonly Evidence[]): string {
  const body = version.sections.map(section => {
    let content: string;
    if ('paragraphs' in section) content = section.paragraphs.map(p => `<p>${escape(p)}</p>`).join('');
    else if ('text' in section) content = `<p>${escape(section.text)}</p><p>Nguồn demo: ${section.evidenceIds.map(escape).join(', ')}</p>`;
    else if ('rows' in section) content = `<p>${escape(section.unit)}</p><table><thead><tr>${section.columns.map(c => `<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${section.rows.map(row => `<tr>${row.map(c => `<td>${c === null ? 'Chưa đủ dữ liệu' : escape(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    else content = `<p>${escape(section.question)} (${escape(section.unit)})</p><table><caption>${escape(section.title)}</caption><tbody>${section.labels.map((label, i) => `<tr><th scope="row">${escape(label)}</th><td>${section.values[i] ?? 'Chưa đủ dữ liệu'}</td></tr>`).join('')}</tbody></table>`;
    return `<section id="${escape(section.id)}"><h2>${escape(section.title)}</h2>${content}</section>`;
  }).join('');
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(record.title)} — ${escape(version.id)}</title><body><main><p>DỮ LIỆU MÔ PHỎNG — DEMO</p><h1>${escape(record.title)}</h1><p>Phiên bản ${version.sequence} · ${escape(version.id)} · ${escape(version.completedAt)} · Asia/Bangkok</p><nav aria-label="Mục lục"><ul>${version.sections.map(s => `<li><a href="#${escape(s.id)}">${escape(s.title)}</a></li>`).join('')}</ul></nav>${body}<section id="evidence"><h2>Bằng chứng mô phỏng</h2>${evidence.map(e => `<p>${escape(e.id)}: ${escape(e.label)} — ${escape(e.sourceId)}; ${escape(e.limitation)}</p>`).join('')}</section></main></body></html>`;
}
export function createReportFixtures(): ReportDataset {
  const records: ReportRecord[] = []; const versions: ReportVersion[] = [];
  const attempts: GenerationAttempt[] = []; const evidence: Evidence[] = []; const artifacts: Artifact[] = [];
  for (let i = 0; i < 18; i++) {
    const id = `R${String(i + 1).padStart(3, '0')}`; const project = i % 3;
    const type = (['inventory', 'transactions', 'comparison'] as const)[Math.floor(i / 3) % 3];
    const kindLabel = type === 'transactions' ? 'giao dịch' : type === 'comparison' ? 'so sánh tồn kho' : 'tồn kho';
    const record: ReportRecord = { id, code: `VDA-DEMO-${id}`, title: `Phân tích ${kindLabel} — ${projectLabels[project]} — đợt ${i + 1}`, type, projectIds: [`P-${'ABC'[project]}`], marketIds: [marketIds[project]], author: { id: `user-0${project + 1}`, name: authors[project] }, agent: 'Report', createdAt: `2026-09-${String(16 + i % 14).padStart(2, '0')}T01:00:00Z`, versionIds: [], latestAttemptId: null };
    const versionCount = i < 3 ? 2 : i < 12 ? 1 : 0;
    for (let sequence = 1; sequence <= versionCount; sequence++) {
      const versionId = `${id}-v${sequence}`; const evidenceId = `${versionId}-evidence`;
      const artifactId = `${versionId}-html`;
      const item: Evidence = { id: evidenceId, sourceId: type === 'transactions' ? 'source-transactions' : 'source-inventory', label: `Nguồn demo ${projectLabels[project]}`, projectIds: record.projectIds, snapshotId: type === 'transactions' ? null : 'snapshot-current', dataThrough: reportSource.dataThrough, limitation: 'Nguồn mô phỏng; không xác nhận dữ liệu thị trường thực tế.' };
      const version: ReportVersion = { id: versionId, reportId: id, sequence, completedAt: `2026-10-15T16:59:59.${String(i * 2 + sequence).padStart(3, '0')}Z`, source: { ...reportSource, updatedAt: '2026-10-15T16:59:59Z' }, policyVersion: 'slow-demo-180d-v1', contentRevision: `demo-${versionId}-1`, sections: documentSections(project, versionId, evidenceId, type), evidenceIds: [evidenceId], artifactIds: [artifactId, `${versionId}-csv`] };
      const attemptId = `${versionId}-attempt`;
      attempts.push({ id: attemptId, reportId: id, state: 'succeeded', createdAt: record.createdAt, finishedAt: version.completedAt, versionId });
      record.versionIds = [...record.versionIds, versionId]; record.latestAttemptId = attemptId;
      versions.push(version); evidence.push(item);
      artifacts.push({ id: artifactId, versionId, filename: `VDA-DEMO-${id}-v${sequence}.html`, mediaType: 'text/html', content: renderDemoHtml(record, version, [item]) });
      const csvRows = type === 'transactions' ? `Chi tieu,Giao dich\r\nHien tai,${[24, 15, 6][project]}\r\nKy truoc,${[28, 16, 6][project]}\r\n` : `Chi tieu,So can\r\nTon kha dung,${[60, 40, 20][project]}\r\nDu ngay mo ban,${[56, 40, 18][project]}\r\nTuoi tu 180 ngay,${[20, 12, 4][project]}\r\n`;
      artifacts.push({ id: `${versionId}-csv`, versionId, filename: `VDA-DEMO-${id}-v${sequence}.csv`, mediaType: 'text/csv', content: `\uFEFFDEMO - DU LIEU MO PHONG,${versionId}\r\n${csvRows}` });
    }
    if (i >= 12 && i < 16) {
      record.latestAttemptId = `${id}-attempt-1`;
      attempts.push({ id: record.latestAttemptId, reportId: id, state: i < 14 ? 'running' : 'failed', createdAt: record.createdAt, finishedAt: i < 14 ? null : '2026-10-15T02:00:00Z', versionId: null });
    }
    records.push(record);
  }
  return withRiversideReport({ projects: projectLabels.map((name, i) => ({ id: ['P-A', 'P-B', 'P-C'][i], name })), records, versions, attempts, evidence, artifacts, source: { ...reportSource } });
}
