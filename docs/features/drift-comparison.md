# So sánh drift

## Hợp đồng

`POST /api/v1/profile/{run_id}/drift` so sánh current Profile Run đã hoàn tất với baseline khác cũng đã hoàn tất trong cùng workspace. API không kiểm tra hai run phải thuộc cùng dataset; nó chỉ kiểm tra tồn tại trong workspace, trạng thái `completed` và id khác nhau. Service đọc `column_stats` đã lưu và không reload raw data. Response gồm baseline/current id, summary và mọi finding có column, drift type, severity, metric, baseline/current value, PSI nếu có và detail.

## Tín hiệu

Implementation phát hiện schema signal cho column thêm/xóa và dtype change, null-rate shift, numeric mean/std/cardinality shift và PSI trên top-k distribution đã lưu. Threshold nằm trong [`backend/src/services/drift.py`](../../backend/src/services/drift.py): null-rate shift minor ở 5 điểm phần trăm và major ở 10; numeric relative shift minor ở 20% và major ở 50%; PSI minor ở 0,1 và major ở 0,25. Một column có thể tạo nhiều finding.

Trường `summary` đếm signal major/minor, không đếm số column duy nhất. Phía sử dụng phải render mọi finding thay vì chọn một metric cho mỗi column.

## Hành vi giao diện

`/compare` liệt kê run đã completed trong workspace hiện tại, yêu cầu ít nhất hai run, hỗ trợ tìm column và lọc severity, rồi group toàn bộ finding backend theo column. Drift trong report dùng cùng grouping/evidence label. Filter chỉ thay đổi phạm vi hiển thị, không thay đổi backend comparison.

## Vị trí source code và kiểm chứng

- Tính toán/API: [`backend/src/services/drift.py`](../../backend/src/services/drift.py), [`backend/src/api/routes.py`](../../backend/src/api/routes.py), [`backend/src/models/schemas.py`](../../backend/src/models/schemas.py).
- UI normalization: [`frontend/src/components/compare-workspace.tsx`](../../frontend/src/components/compare-workspace.tsx), [`frontend/src/lib/drift-evidence.ts`](../../frontend/src/lib/drift-evidence.ts).
- Test: tìm trong `tests/` với `drift`, `psi`, `compare` và `finding`.
