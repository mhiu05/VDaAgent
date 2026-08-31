---
name: compare-profile-drift
description: Kiểm tra profile drift evidence đã lưu. Dùng khi user hỏi dataset đã thay đổi thế nào, cần schema/distribution drift finding hoặc so sánh các profiling run tương thích.
---

# So sánh profile drift

Chỉ tạo drift qua `POST /api/v1/profile/{run_id}/drift` sau khi API validate hai run đã completed, khác nhau và cùng workspace. Chỉ đọc evidence đã lưu bằng `get_drift_summary`, `get_drift_findings` và `get_schema_diff`.

Không suy ra drift từ raw row và không so sánh run giữa các workspace. Nêu rõ khi chưa có report đã lưu.
