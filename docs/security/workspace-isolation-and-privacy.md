# Cô lập workspace và bảo vệ dữ liệu

## Ranh giới cô lập

Workspace id được resolve từ membership đã xác thực, không tin body của request. Dataset, Profile Run, analysis session/context/execution, report, connector, profile/report retrieval document, audit và agent query mang predicate của workspace đã resolve. External-knowledge document có thể là global với `workspace_id` null và chỉ được đưa vào retrieval khi configuration cho phép. Cross-workspace header bị reject mà không tiết lộ target có tồn tại hay không. Agent trace/evidence endpoint dùng cùng scope.

## Dữ liệu thô và PII

Raw file/object nằm ở Supabase Storage, Google Drive hoặc local development storage; PostgreSQL lưu metadata và derived result. Profiler phát hiện PII bằng heuristic tên column và giá trị sample, không lưu raw value trong proposal evidence và bỏ top-k value của PII column. Quasi-identifier được hiển thị riêng. Analysis reject column có PII proposal ở trạng thái `pending`, `confirmed`, `edited` hoặc `auto_confirmed` trong selection, dimension và filter; chỉ proposal đã `rejected` mới hết bị mask theo quy tắc này.

Profile/export payload có giới hạn. Raw export mặc định tắt. QA answer và agent trace redact bearer/API key, secret, email, phone, payment-card pattern, local path và sensitive key; string/result bị truncate. Telemetry PII-safe, không chứa raw prompt, model message, row hoặc credential. Audit mặc định lưu question hash/length, chỉ lưu content khi bật flag tương ứng.

## Thông tin xác thực và storage

Datasource credential và Google Drive refresh token dùng Fernet encryption. `DATASOURCE_ENCRYPTION_KEY` bắt buộc cho datasource production; local fallback derivation chỉ là tiện ích development. Connector response chỉ có safe target metadata. Upload filename được normalize và loại path traversal; provider upload dùng chunk/retry có giới hạn.

## Chính sách guest

Guest principal nhận workspace cô lập cùng storage provider, size limit và retention window đã cấu hình. Guest cleanup là thao tác maintenance/explicit; session request bình thường không tự xóa guest workspace cũ.

## Vị trí source code và kiểm chứng

- Security helper: [`backend/src/services/security.py`](../../backend/src/services/security.py).
- Authz/repository scope: [`backend/src/api/dependencies.py`](../../backend/src/api/dependencies.py), [`backend/src/services/repository.py`](../../backend/src/services/repository.py).
- PII/compute: [`backend/src/services/compute.py`](../../backend/src/services/compute.py).
- Guardrail/trace: [`backend/src/services/guardrails.py`](../../backend/src/services/guardrails.py), [`backend/src/agents/runtime/trace.py`](../../backend/src/agents/runtime/trace.py).
- Test: tìm trong `tests/` với `pii`, `privacy`, `redact`, `workspace_isolation`, `raw_export`, `path` và `encryption`.
