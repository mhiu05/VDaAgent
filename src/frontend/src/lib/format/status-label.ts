const workflowLabels: Record<string, string> = {
  queued: 'Đang chờ',
  waiting: 'Đang chạy',
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
  ready: 'Sẵn sàng',
  unavailable: 'Không khả dụng',
  warning: 'Cần lưu ý',
  high: 'Cao',
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
  watch: 'Cần theo dõi',
  material: 'Đáng kể',
  partial: 'Một phần',
  insufficient: 'Chưa đủ dữ liệu',
  context_only: 'Chỉ mang tính bối cảnh',
  failed_validation: 'Xác thực thất bại',
  unknown: 'Chưa rõ',
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

export function inventoryStatusLabel(value: string) {
  return inventoryLabels[value] ?? value.replaceAll('_', ' ');
}
