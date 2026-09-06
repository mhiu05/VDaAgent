# Quan sát và khôi phục lỗi

> Đã đối chiếu với health route, telemetry và worker recovery hiện tại ngày 2026-09-03.

Observability của VDaAgent dựa trên structured log, request correlation, audit record, agent trace và health endpoint. Không ghi raw dataset, credential, bearer token hoặc prompt chứa PII vào log.

## Health và trạng thái

- API: `GET /health`.
- Worker: `GET /health` trên health port của process worker.
- Frontend: `GET /health`.
- Trạng thái ứng dụng: `GET /api/v1/status`.

OpenAPI bị tắt trong production. Health chỉ nên phản ánh readiness cần thiết, không trả cấu hình nhạy cảm.

## Telemetry backend

Mỗi request có correlation/request ID. Performance telemetry theo dõi tổng thời gian, database query và slow query (mặc định từ 200 ms). Server-Timing tắt mặc định vì có thể lộ chi tiết vận hành; chỉ bật có chủ đích.

Theo dõi tối thiểu:

- request rate, error rate, p50/p95/p99;
- database pool wait, query chậm, lock và connection exhaustion;
- profiling queue depth, tuổi job lâu nhất, retry, lease expiry;
- CPU/RAM/disk tạm của worker;
- upload session/finalize, Drive metadata/download, canonical upload/verify và storage download latency;
- SSE connection/disconnect;
- PDF timeout.

## AI và agent

Log latency tách router, planner, retrieval, tools, evidence, final LLM, validation và time-to-first-token; kèm call/token count khi có. Agent run lưu plan, trace, evidence và trace summary đã làm sạch.

LangSmith là tùy chọn. Adapter hiện ẩn input/output và gửi metadata-only kể cả khi data mode cấu hình là `sanitized_content`. Không gửi dataset value hoặc secret sang tracing.

## Khôi phục profiling job

Worker dùng lease, heartbeat, retry và stale-job recovery:

- concurrency mặc định 1;
- poll 1 giây;
- lease 300 giây;
- tối đa 3 attempt;
- shutdown grace 30 giây.

Delivery là at-least-once, nên handler phải idempotent. Khi worker chết, lease hết hạn cho phép worker khác claim lại. Không sửa trạng thái bằng tay trước khi kiểm tra attempt, lease owner, heartbeat, domain state và audit.

Profile job đã bind `artifact_id` không được đổi sang artifact mới hơn của dataset. `queue_wait_ms`, `execution_ms` và `storage_download_ms` cho phép tách queue, materialization và tổng worker execution. Ingestion log `canonical_upload_ms`, `canonical_verify_ms` và metadata finalize; Drive audit thêm metadata/download/import total. Không suy ra Supabase nhanh hơn Drive nếu chưa chạy benchmark staging.

## Reconciliation và migration

- `python scripts/reconcile_storage.py` là read-only, phát hiện record thiếu object, ingestion stale và tùy chọn object chưa có record.
- `python scripts/migrate_storage_to_supabase.py` mặc định dry-run; `--execute` canonicalize legacy Drive theo batch ngoài Alembic.
- `python scripts/benchmark_storage_materialization.py` đo p50/p95/p99 cho reference legacy/canonical; kết quả chỉ là local/staging measurement.

Không tự xóa orphan candidate. Trước cleanup phải kiểm tra ingestion idempotency key, audit, object age và mọi retained Profile Run/evidence có còn bind artifact hay không.

## Playbook sự cố

### Queue tăng nhưng không có job chạy

1. kiểm tra worker health/startup command;
2. kiểm tra database connectivity/pool;
3. kiểm tra lease cũ và heartbeat;
4. kiểm tra storage credential và quota file tạm;
5. scale concurrency thận trọng sau khi xác định bottleneck.

### Job succeeded nhưng UI vẫn chờ

Kiểm tra profile run có `pending_review` hay không. Job thành công không đồng nghĩa domain đã `completed`. Xác minh SSE nhận `review_required` và client xử lý terminal/domain state đúng.

### SSE bị treo

Kiểm tra proxy buffering, keepalive 10 giây, disconnect log và trạng thái job/run trực tiếp. Client có thể fallback polling nhưng không được tạo job mới nếu đã có idempotency key.

### Lỗi OOM hoặc hết disk

Kiểm tra giới hạn materialization, file tạm bị sót và projection. Luồng chính phải file-backed DuckDB; nếu thấy full pandas load, xác định đó có phải statistical test có chọn cột hay regression.

### QA trả số không có nguồn

Lấy agent trace/evidence, kiểm tra tool result và validator. Response đúng là abstain nếu evidence không đủ; không bỏ validator để “cứ trả lời”.

### Deploy không healthy

So sánh image SHA, app settings, migration revision và log startup của từng app. API/worker phải cùng backend SHA. Rollback theo [Triển khai](deployment.md), không sửa schema thủ công.

## Dữ liệu phục vụ điều tra

Giữ request ID, workspace ID, job/run/agent ID, image SHA, migration revision và timestamp. Chỉ dùng synthetic hoặc dữ liệu đã redact khi chia sẻ ngoài nhóm có quyền.
