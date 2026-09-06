# So sánh drift

> Đã đối chiếu với drift service/route và UI compare hiện tại ngày 2026-09-03.

Drift comparison đối chiếu hai profiling run bằng thống kê đã được lưu. Endpoint không đọc lại raw dataset và không gọi model.

## Contract

`POST /api/v1/profile/{current_run_id}/drift` nhận baseline run ID. Backend yêu cầu:

- hai run khác ID;
- cả hai đã hoàn tất;
- cả hai thuộc workspace hiện tại;
- người gọi có capability cần thiết.

Kết quả gồm schema change, null-rate shift, numeric distribution shift và mức severity. So sánh có thể tái lập vì chỉ dùng artifact profiling bất biến của từng run.

## Ngưỡng mặc định

| Tín hiệu | Warning | Critical |
| --- | ---: | ---: |
| Thay đổi null rate | 5 điểm phần trăm | 10 điểm phần trăm |
| Thay đổi tương đối của metric số | 20% | 50% |
| PSI | 0,10 | 0,25 |

Schema thêm/xóa cột hoặc đổi kiểu được báo riêng. Ngưỡng là policy hiện tại, không phải quy tắc thống kê phổ quát; nếu thay đổi phải cập nhật test và tài liệu cùng lúc.

## Giới hạn hiện tại

Backend xác nhận cùng workspace nhưng chưa bắt buộc hai run thuộc cùng `dataset_id`. UI nên chỉ cho chọn run của cùng dataset, nhưng đây chưa phải invariant ở tầng service. Không dùng drift endpoint như bằng chứng rằng hai nguồn đại diện cho cùng thực thể dữ liệu.

## Diễn giải an toàn

- Phân biệt điểm phần trăm với phần trăm tương đối.
- Metric thiếu ở một run là “không đủ dữ liệu”, không tự suy ra “không drift”.
- Drift là tín hiệu cần điều tra, không tự động là lỗi pipeline.
- Báo cáo phải giữ baseline/current run ID và thời điểm tạo profile.

## Nguồn triển khai

- `backend/src/api/routes.py`
- `backend/src/services/drift.py`
- `backend/src/models/schemas.py`
- `frontend/src/app/compare/page.tsx`
- `frontend/src/components/compare-workspace.tsx`
