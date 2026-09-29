# Các workflow chính

| Việc người dùng làm | Luồng thực thi | Kết quả |
| --- | --- | --- |
| Nhập CSV tồn kho | [Dataset processing](dataset-processing.md) | Import manifest, snapshot bất biến, CSV trong Storage |
| Hỏi trong hội thoại | [Analysis workflow](analysis-workflow.md) | Message trả lời từ capability đọc hoặc run mới |
| Tạo phân tích trực tiếp / theo lịch | [Analysis workflow](analysis-workflow.md) | `agent-v1` run và artifact đã validate |
| Tạo báo cáo | [Report generation](report-generation.md) | Draft, review, report record/version nội bộ |
| Xử lý ngắt quãng | [Failure recovery](failure-recovery.md) | Reclaim theo lease hoặc trạng thái terminal có mã lỗi |

Các luồng cùng dùng organization scope và repository. Một chat turn đọc ngắn không nhất thiết tạo run; specialist run có thể kết thúc ở pack mà không tạo report. Lịch chỉ tạo run; worker vẫn cần hoạt động để thực thi.

Code: `src/frontend/server/api/routes`, `src/backend/worker`, `src/backend/agents/analysis`. Xem [system flow](../architecture/system-flow.md).
