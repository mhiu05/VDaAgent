# Cô lập workspace và quyền riêng tư

> Đã đối chiếu với policy/repository/migration hiện tại ngày 2026-09-01.

Hệ thống dùng defense in depth: auth/capability ở API, scope workspace trong repository, Data API đóng với browser role, storage private và redaction trước AI/telemetry.

## Ranh giới Data API

Trình duyệt chỉ dùng Supabase Auth với publishable key. Nó không được đọc/ghi bảng domain trực tiếp.

Migration `20260831_0022_data_api_boundary` bật RLS trên mọi app table được inventory nhưng không tạo policy cho `anon` hoặc `authenticated`; đồng thời revoke quyền table, sequence, function và default privilege của `PUBLIC`, `anon`, `authenticated`. Vì không có policy, RLS fail closed; vì grant đã bị revoke, Data API còn bị chặn ở lớp privilege.

Backend dùng connection/secret riêng và là nơi duy nhất thực thi domain access. `backend/src/services/database_access_policy.py` giữ inventory bảng hiện hành, optional runtime và legacy table để migration/test không bỏ sót.

## Scope tenant

Mỗi thao tác phải:

1. lấy principal từ bearer token;
2. resolve membership và workspace hợp lệ;
3. kiểm capability;
4. query resource với `workspace_id`;
5. kiểm quan hệ dataset/run/session/report khi có nhiều ID;
6. ghi audit cho thao tác nhạy cảm.

Không tin `workspace_id`, resource ID hoặc role do browser gửi. Query theo ID đơn lẻ là không đủ.

## Storage và file tạm

- Bucket/object là private.
- Object key có prefix workspace/dataset.
- Backend kiểm membership trước download/materialize.
- Credential connector được mã hóa và không echo.
- Source remote được stream với quota vào file tạm.
- File tạm được dọn trên cả success và failure.
- Provenance lưu stable source reference, không lưu temp path.

Local storage chỉ dùng phát triển. Guest storage phải có prefix/lifecycle riêng và không trộn với tenant production.

## PII và AI

PII status `pending`, `confirmed`, `edited` và `auto_confirmed` đều bị chặn; chỉ `rejected` được dùng trong phân tích/model context. Planner sanitize schema/context trước model và không cho cột hạn chế ảnh hưởng fallback. QA validator fail closed nếu evidence sai run/workspace, nguồn không hợp lệ hoặc số không được hỗ trợ.

Không gửi raw row, PII, bearer token, DB URI hoặc secret tới LLM/LangSmith. Trace/evidence phải qua redaction. LangSmith adapter hiện metadata-only.

## Kiểm thử bắt buộc

```powershell
python scripts/migration_smoke.py
python scripts/assert_database_security.py
python -m pytest -q tests/test_database_access_policy.py tests/test_database_security.py
python -m pytest -q tests/test_auth.py tests/test_permissions.py tests/test_services/test_security.py
```

Security assertion thực sự đổi sang browser role để chứng minh truy cập bị từ chối, rồi xác nhận backend role vẫn CRUD. Chỉ kiểm tra `relrowsecurity=true` là chưa đủ.

## Checklist review

- Bảng mới đã vào inventory và migration RLS/revoke chưa?
- Repository query đã scope workspace chưa?
- Storage object có prefix và auth check chưa?
- Response/log/trace có raw value hoặc secret không?
- PII pending có bị chặn không?
- Guest/compatibility có tắt ở production không?
- Test cross-workspace gồm cả đọc, sửa, xóa và export chưa?
- Service key có chỉ nằm server-side không?

## Nguồn triển khai

- `backend/migrations/versions/20260831_0022_data_api_boundary.py`
- `backend/src/services/database_access_policy.py`
- `scripts/assert_database_security.py`
- `backend/src/services/security.py`
- `backend/src/services/storage.py`
- `backend/src/services/qa_validation.py`
