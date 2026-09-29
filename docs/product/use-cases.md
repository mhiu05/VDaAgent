# Use case đang hỗ trợ

| Nhóm | Use case | Trạng thái |
| --- | --- | --- |
| Platform | Hội thoại theo tổ chức, chọn ngữ cảnh, theo dõi run, đọc event/evidence, export report | **Implemented** |
| Platform | Lập lịch và trigger report definition | **Implemented**; worker phải chạy để xử lý |
| Domain | Import CSV snapshot tồn kho, tính chỉ số tồn, tuổi tồn và so sánh kỳ/segment | **Implemented** cho schema `csv-v1` và semantic `mvp-inventory-v0.1` |
| Domain | Tạo report có review bằng chứng và version lineage | **Implemented**; publication nội bộ, tối đa một lần sửa draft trong run |
| Agent capability | Đọc kết quả run, signal, chart, evidence, report context và tạo analysis từ hội thoại | **Implemented** theo role/context allowlist |
| Agent/tool extension | Gọi MCP từ workflow đang chạy | **Partially implemented**: gateway có code, chưa thấy server được đăng ký trong luồng chính |
| Skill package | Phát hiện/nạp skill đóng gói workflow | **Planned / placeholder**: không có loader hoặc registry trong repo |

Các thuật ngữ “decision intelligence”, “priority entity” là projection từ artifact tồn kho hiện tại, không phải dịch vụ dự báo tổng quát. Kết quả không chứng minh quan hệ nhân quả; Agent Runtime từ chối câu hỏi nhân quả không được hỗ trợ.

Codebase: `src/backend/agents/use-cases.ts`, `src/backend/agents/runtime/capabilities/registry.ts`, `src/backend/semantic`. Xem [giới hạn sản phẩm](overview.md) và [tools](../agents/tools.md).
