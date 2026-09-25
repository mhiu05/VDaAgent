const taskLabels: Record<string, string> = {
  coordinator: 'Quyết định điều phối',
  analyst: 'Phân tích có bằng chứng',
  reviewer: 'Rà soát bản nháp',
  publication: 'Cổng phát hành',
  orchestrator: 'Chuẩn bị',
  data: 'Đọc snapshot đã khóa',
  calculation: 'Tính chỉ số',
  comparison: 'Tạo so sánh',
  chart: 'Tạo biểu đồ',
  insight: 'Liên kết insight với bằng chứng',
  validation: 'Kiểm tra bằng chứng',
  report: 'Chuẩn bị báo cáo',
};

export function taskLabel(kind: string): string {
  return taskLabels[kind] ?? 'Đang xử lý';
}
