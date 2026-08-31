# Quan sát và phục hồi lỗi

## Kiểm tra sức khỏe và chẩn đoán

- Backend liveness: `GET /health` ở root, không phải `/api/v1/health`.
- Worker liveness: `/health` của worker, trả role `profiling-worker`; trạng thái stopping/unhealthy dùng 503.
- Frontend liveness: route Next `/health`.
- Diagnostic API: `/api/v1/status` và `/api/v1/audit`, có authorization.

API validate hoặc tạo correlation id rồi trả trong response. Structured log, request metric, agent trace và audit event có thể nối bằng id này. Performance telemetry có thể phát `Server-Timing` khi bật; slow-query threshold và sampling có thể cấu hình. LangSmith tracing là optional; adapter hiện luôn ẩn input/output và chỉ export metadata trong allow-list, dù setting `LANGSMITH_DATA_MODE` còn nhận cả giá trị `sanitized_content`.

## Ngữ nghĩa lỗi

Validation là 422; domain conflict thường là 409; authentication/authorization là 401/403; not-found là 404; database operational failure là 503 với `Retry-After: 3`; lỗi không biết là safe 500 kèm request id. Error payload không chứa credential, raw source value, prompt hoặc local path.

## Hướng dẫn phục hồi

**Profile Job bị kẹt ở queued:** kiểm tra process worker, `PYTHONPATH=backend`, database connectivity và worker health. API enqueue không tự thực thi profile.

**Job kẹt ở running:** kiểm tra heartbeat/lease và worker log. Stale recovery sẽ reclaim lease hết hạn; vượt attempt limit thì job chuyển failed. Sau khi mất lease, cần giả định xử lý at-least-once.

**Preview hoặc Official timeout:** kiểm tra QuerySpec limit, source latency, preview row budget và bounded execution timeout. Không tăng limit ngay; trước hết xác minh PII/context/quality-gate constraint và source health.

**Datasource attention/expired:** dùng connector test/status endpoint và xoay credential ở backend. Secret được mã hóa và không thể lấy lại từ API response.

**PDF export lỗi:** kiểm tra quyền với export-source và Chromium trong frontend image. Server route timeout source fetch sau 30 giây và trả safe 502/504/500.

## Vị trí source code và kiểm chứng

- Middleware/error: [`backend/src/main.py`](../../backend/src/main.py).
- Worker recovery: [`backend/src/workers/profiling_worker.py`](../../backend/src/workers/profiling_worker.py).
- Telemetry: [`backend/src/services/perf_telemetry.py`](../../backend/src/services/perf_telemetry.py).
- Test: tìm trong `tests/` với `health`, `correlation`, `retry`, `stale`, `timeout`, `audit` và `telemetry`.
