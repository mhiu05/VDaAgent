export const assistantStates = [
  'idle',
  'thinking',
  'analyzing',
  'happy',
  'success',
  'warning',
  'error',
  'waiting',
  'report-ready',
] as const;

export type AssistantState = (typeof assistantStates)[number];

export type AssistantStateDetails = {
  label: string;
  description: string;
};

/**
 * Copy and colors shared by the visual avatar and the text-based presence.
 * Consumers can override the copy in AssistantPresence without losing the
 * state-specific visual treatment.
 */
export const assistantStateDetails: Record<AssistantState, AssistantStateDetails> = {
  idle: {
    label: 'Sẵn sàng',
    description: 'VDa Navigator sẵn sàng nhận yêu cầu tiếp theo.',
  },
  thinking: {
    label: 'Đang suy nghĩ',
    description: 'VDa Navigator đang xem xét yêu cầu.',
  },
  analyzing: {
    label: 'Đang phân tích',
    description: 'VDa Navigator đang rà soát bằng chứng hiện có.',
  },
  happy: {
    label: 'Đúng hướng',
    description: 'Đã tìm thấy hướng phân tích phù hợp.',
  },
  success: {
    label: 'Hoàn tất',
    description: 'Đã hoàn thành yêu cầu.',
  },
  warning: {
    label: 'Cần xem lại',
    description: 'Có nội dung cần được kiểm tra thêm.',
  },
  error: {
    label: 'Chưa thể hoàn tất',
    description: 'Không thể hoàn thành bước này.',
  },
  waiting: {
    label: 'Đang chờ',
    description: 'Đang chờ thông tin hoặc bước tiếp theo.',
  },
  'report-ready': {
    label: 'Báo cáo sẵn sàng',
    description: 'Có báo cáo mới để xem lại.',
  },
};

export function assistantStateLabel(state: AssistantState) {
  return assistantStateDetails[state].label;
}
