const workflowLabels: Record<string, string> = {
  loading: 'Đang tải',
  live: 'Đang cập nhật',
  reconnecting: 'Đang kết nối lại',
  idle: 'Chưa hoạt động',
  queued: 'Đang chờ',
  waiting: 'Đang chờ kết quả',
  running: 'Đang chạy',
  submitted: 'Đã gửi',
  in_progress: 'Đang xử lý',
  succeeded: 'Thành công',
  completed: 'Hoàn tất',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
  pending: 'Đang chờ',
  draft: 'Bản nháp',
  provisional: 'Tạm thời',
  published: 'Đã phát hành',
  validated: 'Đã xác thực',
  complete: 'Hoàn tất',
  incomplete: 'Chưa hoàn thiện',
  pass: 'Đã duyệt',
  revision_required: 'Cần chỉnh sửa',
  ready: 'Sẵn sàng',
  available: 'Có dữ liệu',
  unavailable: 'Không khả dụng',
  warning: 'Cần lưu ý',
  high: 'Cao',
  limited: 'Hạn chế',
  exploratory: 'Thăm dò',
  medium: 'Trung bình',
  low: 'Thấp',
  critical: 'Nghiêm trọng',
  increased: 'Tăng',
  increase: 'Tăng',
  decreased: 'Giảm',
  decrease: 'Giảm',
  stable: 'Ổn định',
  improved: 'Cải thiện',
  improving: 'Đang cải thiện',
  worsened: 'Xấu đi',
  deteriorating: 'Đang xấu đi',
  mixed: 'Biến động trái chiều',
  insufficient_evidence: 'Chưa đủ bằng chứng',
  watch: 'Cần theo dõi',
  material: 'Đáng kể',
  partial: 'Một phần',
  insufficient: 'Chưa đủ dữ liệu',
  context_only: 'Chỉ mang tính bối cảnh',
  failed_validation: 'Xác thực thất bại',
  unknown: 'Chưa rõ',
  INSUFFICIENT_HISTORY: 'Thiếu dữ liệu lịch sử',
  INSUFFICIENT_PEERS: 'Chưa đủ nhóm so sánh',
  MISSING_REQUIRED_FIELD: 'Thiếu trường dữ liệu bắt buộc',
  NO_DATA: 'Không có dữ liệu',
  ZERO_DENOMINATOR: 'Mẫu số bằng 0',
  INCOMPARABLE_CURRENCY: 'Khác loại tiền tệ nên không thể so sánh',
  NO_SNAPSHOT: 'Không có mốc dữ liệu',
  INSUFFICIENT_SAMPLE_SIZE: 'Chưa đủ số lượng mẫu',
  UNSUPPORTED_METRIC: 'Chỉ số chưa được hỗ trợ',
  UNSUPPORTED_CHART: 'Biểu đồ chưa được hỗ trợ',
  INCOMPATIBLE_GRAIN: 'Mức độ chi tiết dữ liệu không tương thích',
  TOO_MANY_CATEGORIES: 'Có quá nhiều nhóm để hiển thị',
};

const inventoryLabels: Record<string, string> = {
  available: 'Còn hàng',
  reserved: 'Đã giữ chỗ',
  sold: 'Đã bán',
  held: 'Tạm giữ',
  unknown: 'Chưa rõ',
};

export function workflowStatusLabel(value: string) {
  return workflowLabels[value] ?? value.replaceAll('_', ' ');
}

const decisionReasonLabels: Record<string, string> = {
  slow_moving: 'Tồn kho luân chuyển chậm',
  available_inventory: 'Căn còn hàng',
  concentration: 'Tỷ trọng tập trung cao',
  age_critical: 'Tồn kho trên 180 ngày',
  age_high: 'Căn cần ưu tiên kiểm tra',
  age_medium: 'Tồn kho trên 90 ngày',
  age_watch: 'Cần theo dõi',
};

export function decisionReasonLabel(value: string, metricLabel: (key: string) => string) {
  return decisionReasonLabels[value] ?? metricLabel(value);
}

const artifactKindLabels: Record<string, string> = {
  unit_snapshot: 'Dữ liệu căn tại thời điểm ghi nhận',
  calculation: 'Kết quả tính toán',
  coordinator_decision: 'Quyết định điều phối',
  data_analysis_pack: 'Kết quả phân tích tồn kho',
  visual_evidence: 'Bằng chứng trực quan',
  comparison_calculation: 'Kết quả tính toán so sánh',
  comparison: 'Kết quả so sánh',
  comparison_pack: 'Bằng chứng so sánh',
  chart_pack: 'Dữ liệu biểu đồ',
  analysis_pack: 'Phát hiện phân tích',
  insight: 'Nhận định',
  insight_pack: 'Tập hợp nhận định',
  decision_intelligence_pack: 'Kết quả hỗ trợ quyết định',
  report_draft: 'Bản nháp báo cáo',
  review_result: 'Kết quả rà soát',
  report: 'Báo cáo',
};

export function artifactKindLabel(value: string) {
  return artifactKindLabels[value] ?? workflowStatusLabel(value);
}

export function inventoryStatusLabel(value: string) {
  return inventoryLabels[value] ?? value.replaceAll('_', ' ');
}

const agentExecutionEventLabels: Record<string, string> = {
  invocation_queued: 'Đã xếp lịch tác nhân',
  invocation_started: 'Tác nhân bắt đầu chạy',
  invocation_completed: 'Tác nhân hoàn tất',
  invocation_failed: 'Tác nhân gặp lỗi',
  invocation_cancelled: 'Tác nhân đã bị hủy',
  turn_queued: 'Lượt phân tích đang chờ',
  turn_started: 'Lượt phân tích bắt đầu',
  turn_completed: 'Lượt phân tích hoàn tất',
  turn_failed: 'Lượt phân tích gặp lỗi',
  turn_cancelled: 'Lượt phân tích đã bị hủy',
};

export function agentExecutionEventLabel(value: string) {
  return agentExecutionEventLabels[value] ?? value.replaceAll('_', ' ');
}
