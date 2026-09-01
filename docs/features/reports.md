# Báo cáo

> Đã đối chiếu với report lifecycle API, repository và PDF route hiện tại ngày 2026-09-01.

Báo cáo ghép các insight đã được kiểm chứng thành draft có thể chỉnh sửa, sau đó đóng băng thành snapshot để publish/export.

## Mô hình dữ liệu

- report: container và trạng thái lifecycle;
- report item: tham chiếu insight/execution cùng thứ tự và nội dung trình bày;
- draft: trạng thái mutable;
- snapshot: bản bất biến, có payload chuẩn hóa và hash;
- export source: dữ liệu đã kiểm tra để frontend/server renderer tạo PDF.

Item định lượng phải tham chiếu profile run, Official execution hoặc evidence có provenance. Ghi chú thủ công là nội dung biên tập, không trở thành quantitative evidence chỉ vì được thêm vào report.

## API chính

Các route nằm dưới `/api/v1/reports`:

- list/get và lấy export source;
- tạo report;
- thêm, sửa, xóa, sắp xếp item;
- sửa draft title;
- tạo snapshot;
- submit, review, publish, archive;
- xóa report khi policy cho phép.

`GET/POST /api/v1/profile/{run_id}/report-draft` hỗ trợ draft gắn với một profiling run. Frontend PDF route dùng Chromium phía server và timeout 30 giây.

## Snapshot và tính tái lập

Khi tạo snapshot, backend chuẩn hóa payload, giữ provenance và tính hash. Export/publish phải dựa trên snapshot thay vì đọc draft đang thay đổi. Nếu artifact nguồn không còn hợp lệ hoặc workspace không khớp, thao tác phải fail closed.

## Trạng thái triển khai cần hiểu đúng

Các hạn chế hiện tại:

- submit hiện publish trực tiếp trong service thay vì tạo một review chain độc lập;
- canonical workspace role là `analyst`, role này hiện có capability submit/review/publish;
- `report_separation_of_duties` chưa được enforce;
- list/get theo tên “published” vẫn dùng `published_only=False`; list loại rejected nhưng get/export chưa đồng nhất;
- đường fallback có thể tạo `snapshot_hash="draft"`, nên không được xem là bằng chứng của snapshot bất biến.

Vì vậy lifecycle hiện tại là API/workflow khả dụng, chưa phải kiểm soát phê duyệt nhiều người. Không mô tả nó như segregation-of-duties trong hồ sơ tuân thủ.

## Nguồn triển khai

- `backend/src/api/authz_routes.py`
- `backend/src/api/routes.py`
- `backend/src/services/report_service.py`
- `backend/src/services/report_draft_repository.py`
- `backend/src/models/auth_schemas.py`
- `frontend/src/app/reports/`
- `frontend/src/app/api/reports/profile/[runId]/route.ts`
- `frontend/src/lib/pdf-report.ts`
