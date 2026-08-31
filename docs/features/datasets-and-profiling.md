# Profiling dataset

## Luồng người dùng

1. Upload CSV, TSV, Parquet hoặc JSON, hoặc tạo dataset từ datasource được hỗ trợ.
2. API lưu dataset metadata và source reference trong workspace hiện tại.
3. Tạo Profile Run bằng `POST /api/v1/profile` (hoặc biến thể theo dataset/batch) với idempotency key.
4. Poll `GET /api/v1/profiling-jobs/{job_id}` hoặc subscribe SSE event.
5. Đọc `GET /api/v1/profile/{run_id}`; nếu còn proposal thì review tại `PATCH /api/v1/profile/{run_id}/confirm`.

Frontend cung cấp luồng này ở `/datasets`, `/datasets/new`, `/datasets/{datasetId}/runs`, `/profiles/{runId}` và `/profiles/{runId}/review`.

## Kết quả Profile Run

Profile Run hoàn tất lưu row/column count, scan mode và sampling provenance, executed query, missingness, cardinality/uniqueness, numeric summary, string length/top-k value, outlier, Pearson correlation, quasi-identifier, PII/semantic-type proposal, risk warning, statistical test và narrative tùy chọn. Cột PII không có top value. Kết quả sample mang `is_approximate` và margin of error nếu có.

Input reader chạy qua DuckDB và tabular-source helper. Full scan và sample scan bị giới hạn bởi max column, sample size, outlier và test configuration. Source rỗng hoặc không có column sẽ fail an toàn.

## Review và tiếp tục xử lý

Metadata proposal ban đầu ở trạng thái pending. Với cấu hình repository hiện tại, chỉ `semantic_type` thuộc `low_risk_types` và có thể auto-confirm khi đạt confidence threshold; candidate key và PII vẫn chờ Analyst. Tuy nhiên Settings chưa giới hạn giá trị của `HITL_LOW_RISK_TYPES`, nên đây là policy do cấu hình quyết định chứ chưa phải invariant trong code. Action confirm/reject/edit/request_test được lưu, sau đó persisted LangGraph thread có thể resume. Profile-domain status có thể là `pending_review` trong khi job vẫn `running` hoặc `succeeded`.

## Ghi chú API

- `ProfileRequest.question` là tùy chọn, tối đa 2.000 ký tự; có question thì profiling có thể tiếp tục sang QA.
- Sampling dùng `reservoir` hoặc `tablesample`, và lưu seed để tái lập.
- Batch profile nhận 1–20 dataset id duy nhất.
- Raw export mặc định tắt; profile/export response bị giới hạn và có PII policy.

## Vị trí source code và kiểm chứng

- API: [`backend/src/api/routes.py`](../../backend/src/api/routes.py).
- Compute: [`backend/src/services/compute.py`](../../backend/src/services/compute.py), [`tabular_source.py`](../../backend/src/services/tabular_source.py).
- Graph: [`backend/src/agents/graph.py`](../../backend/src/agents/graph.py).
- Schema: [`backend/src/models/schemas.py`](../../backend/src/models/schemas.py).
- Test: tìm trong `tests/` với `profile`, `compute`, `sampling`, `pii`, `proposal` và `idempotency`.

Xem [Profiling Job bất đồng bộ](../architecture/async-profiling-jobs.md) về worker guarantee và [workspace isolation](../security/workspace-isolation-and-privacy.md) về data boundary.
