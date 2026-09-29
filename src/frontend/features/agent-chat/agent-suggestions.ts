import type { AgentKey } from '@vda/contracts';

// Keep this exhaustive with AgentKey so a new registered agent needs its own prompts.
export const agentSuggestions: Record<AgentKey, readonly [string, string]> = {
  coordinator: [
    'Phân tích hiện trạng tồn kho trong phạm vi đang chọn, nêu chỉ số chính, bằng chứng và giới hạn dữ liệu.',
    'Phân tích phân bố căn đang mở bán theo phân khu trong phạm vi đang chọn và nêu điểm cần xem xét.',
  ],
  data: [
    'Phân tích số căn đang mở bán và tỷ lệ mở bán trong phạm vi đang chọn, kèm nguồn snapshot.',
    'Phân tích số căn chậm luân chuyển và mức thiếu ngày bắt đầu mở bán trong phạm vi đang chọn.',
  ],
  comparison: [
    'Phân tích chênh lệch số căn đang mở bán giữa các phân khu trong phạm vi đang chọn, kèm bằng chứng và giới hạn khi chỉ có một phân khu.',
    'Phân tích chênh lệch tuổi tồn trung vị giữa các phân khu trong phạm vi đang chọn; nêu giới hạn khi thiếu nhóm hoặc thiếu tuổi.',
  ],
  insight: [
    'Phân tích các nhận định đáng chú ý về tuổi tồn và căn chậm luân chuyển, kèm bằng chứng và giới hạn.',
    'Phân tích điểm cần lưu ý về dữ liệu tuổi tồn còn thiếu trong phạm vi đang chọn, kèm bằng chứng.',
  ],
  chart: [
    'Phân tích và trình bày biểu đồ tỷ lệ căn chậm luân chuyển theo phân khu trong phạm vi đang chọn.',
    'Phân tích và trình bày biểu đồ tuổi tồn của căn đang mở bán, kèm nguồn dữ liệu và giới hạn.',
  ],
  report: [
    'Tạo báo cáo hiện trạng tồn kho trong phạm vi đang chọn, kèm chỉ số, bằng chứng và giới hạn.',
    'Tạo báo cáo về căn chậm luân chuyển và chất lượng dữ liệu tuổi tồn trong phạm vi đang chọn.',
  ],
  reviewer: [
    'Rà soát bằng chứng và giới hạn của báo cáo tồn kho trong phạm vi đang chọn.',
    'Rà soát tính nhất quán của chỉ số tồn chậm và dữ liệu tuổi tồn trong báo cáo cho phạm vi đang chọn.',
  ],
  analyst: [
    'Phân tích các phát hiện định lượng về tỷ lệ mở bán hiện tại, kèm chỉ số và bằng chứng.',
    'Phân tích tỷ lệ căn chậm luân chuyển và dữ liệu tuổi tồn còn thiếu trong phạm vi đang chọn.',
  ],
};
