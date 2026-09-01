# Dataset và profiling

> Đã đối chiếu với dataset/ingestion/profile API và worker hiện tại ngày 2026-09-01.

Dataset là metadata của một nguồn dạng bảng; profile run là một lần phân tích cụ thể trên dataset đó. Một dataset có thể có nhiều run để so sánh theo thời gian.

## Tạo dataset

Người dùng có thể:

- upload CSV, TSV, Parquet hoặc JSON;
- chọn object từ storage đã kết nối;
- dùng bảng/collection từ MySQL, MongoDB hoặc DuckDB connector.

Sau khi tạo dataset, `POST /api/v1/datasets/{dataset_id}/profile` tạo job bất đồng bộ và trả HTTP 202. Batch endpoint `POST /api/v1/datasets/profile` nhận từ 1 đến 20 dataset. `POST /api/v1/profile` là contract profiling trực tiếp dùng cho các luồng tương thích.

API upload mặc định stream file qua backend vào canonical storage. Ingestion session là luồng direct TUS tùy chọn: `POST /api/v1/datasets/upload-sessions` tạo artifact pending và `POST /api/v1/datasets/upload-sessions/{ingestion_id}/finalize` verify object rồi chuyển artifact hiện tại sang `ready`. Idempotency key được ràng buộc theo workspace/user; finalize lặp lại phải trả cùng artifact hoặc lỗi conflict an toàn.

Client nên gửi idempotency key dài 8–255 ký tự khi có khả năng retry.

## Trạng thái

Job và kết quả domain là hai trạng thái khác nhau:

- job: queued, running, succeeded hoặc failed;
- profile run: created/queued/running, pending_review, resuming, completed hoặc failed;
- dataset ingestion: uploading/importing/validating/ready/failed/deleted; artifact: pending/ready/failed/deleted.

Job có thể `succeeded` trong khi run vẫn `pending_review`. Đây là trạng thái hợp lệ: tính toán đã xong nhưng metadata cần người dùng xác nhận. Sau confirm, worker được requeue để tiếp tục graph.

Theo dõi bằng:

- `GET /api/v1/profiling-jobs/{job_id}`;
- `GET /api/v1/profiling-jobs/{job_id}/events`;
- `GET /api/v1/profile/{run_id}`;
- `GET /api/v1/profile/{run_id}/summary`.

SSE phát các event `queued`, `profiling`, `resuming`, `review_required`, `ready`, `failed`. Backend poll theo nhịp thích ứng 1/2/3/5 giây, keepalive độc lập 10 giây, reset khi state đổi và dừng sớm khi client ngắt kết nối.

## Cách profiling chạy

Đường chính dùng DuckDB với source file-backed:

1. materialize nguồn vào file tạm có quota;
2. chỉ đọc/project các cột cần thiết;
3. tạo sample bằng reservoir sampling;
4. tính schema, null, cardinality, thống kê, correlation, PII, duplicate và candidate key trực tiếp trong DuckDB;
5. chỉ nạp các cột được chọn vào pandas cho statistical test;
6. xóa dữ liệu trung gian và file tạm.

Mặc định sample 10.000 dòng, seed 42, tối đa 200 cột và top-k 10. Một số metric trên dữ liệu lớn là xấp xỉ; UI/API phải giữ cờ approximation thay vì trình bày như giá trị tuyệt đối.

## Review metadata

Graph có thể đề xuất semantic type, PII và candidate key. Chính sách mặc định chỉ auto-confirm đề xuất semantic type rủi ro thấp khi confidence đạt 0,95. Cấu hình low-risk tại Settings hiện chưa tự mở rộng allow-list runtime; thay đổi UI không đồng nghĩa thay đổi policy backend.

`PATCH /api/v1/profile/{run_id}/confirm` ghi quyết định review. Trạng thái PII `pending`, `confirmed`, `edited` và `auto_confirmed` đều bị chặn ở các luồng phân tích; chỉ `rejected` được xem là không phải PII.

## Kết quả và thao tác tiếp theo

Một run hoàn tất cung cấp:

- profile/summary và export;
- statistical test;
- QA có evidence;
- drift comparison;
- Command Center;
- report draft.

Dataset có thể list, xem lịch sử run, cập nhật collection hoặc soft-delete qua nhóm route `/api/v1/datasets`.

## Nguồn triển khai

- `backend/src/api/routes.py`
- `backend/src/workers/profiling_worker.py`
- `backend/src/agents/graph.py`
- `backend/src/services/compute.py`
- `backend/src/services/profile_service.py`
- `backend/src/services/storage.py`
- `frontend/src/app/datasets/`
- `frontend/src/app/profiles/`
