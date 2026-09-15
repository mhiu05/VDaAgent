# Migration cơ sở dữ liệu

> Đã kiểm tra theo chuỗi migration trong working tree ngày 2026-09-15; trạng thái database đã deploy phải được xác nhận riêng bằng `alembic current`.

> **Path contract:** `alembic.ini` dùng `src/backend/migrations` và thêm `src/backend` vào import path. Alembic env, `config.py` và script migration đọc `.env` tại repository root.

Alembic là nguồn sự thật schema cho production. Working tree có chuỗi tuyến tính từ baseline `20260812_0000` đến head `20260915_0029`. Hai revision `0028` và `0029` hiện là file chưa được commit; không suy ra production đã chạy chúng.

## Quy tắc

- Mọi thay đổi schema production phải có revision Alembic.
- Không dùng `create_all` hoặc ALTER tự phát trong production runtime.
- Revision phải nâng cấp được từ head trước và tạo được database mới từ rỗng.
- Downgrade phải rõ ràng: `20260901_0026` dùng no-op để không xóa artifact/provenance; `20260915_0028` từ chối downgrade vì credential có thể đã purge vĩnh viễn; `20260915_0029` không đảo ngược việc sửa pointer. Rollback schema phải theo kế hoạch archive/restore riêng.
- Dùng `DATABASE_MIGRATION_URL` cho release khi migration cần connection khác app; nếu trống, Alembic dùng `DATABASE_URL`.

Repository local/test hiện vẫn gọi `create_all` và một số additive compatibility migration để hỗ trợ test/legacy. Hành vi đó không phải chiến lược triển khai production.

## Lệnh thường dùng

Từ repository root:

```powershell
.\.venv\Scripts\python.exe -m alembic -c alembic.ini current
.\.venv\Scripts\python.exe -m alembic -c alembic.ini heads
.\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
.\.venv\Scripts\python.exe -m alembic -c alembic.ini check
```

Tạo revision sau khi đã thiết kế và review SQL:

```powershell
.\.venv\Scripts\python.exe -m alembic -c alembic.ini revision -m "describe logical change"
```

Không autogenerate rồi merge mù quáng; kiểm tra constraint, index, RLS, grant, lock và đường rollback.

## Kiểm thử migration

CI/workflow chạy `python scripts/migration_smoke.py` và toàn bộ `python -m pytest -q`. Từ repository root với dependencies đã cài, có thể chạy các kiểm tra gần migration/rollout:

```powershell
python scripts/migration_smoke.py
python -m pytest -q tests/test_database_access_policy.py tests/test_workspace_role_migration.py tests/test_services/test_retire_database_connectors.py
```

Smoke test kiểm tra database mới và đường upgrade từ revision cũ được hỗ trợ. Các test policy/role/rollout trên không thay thế assertion trực tiếp trên database thực. Trước release, chạy `alembic check` và kiểm tra chỉ có một head.

## Nhận database legacy

`scripts/adopt_legacy_database.py` chỉ audit cấu trúc mặc định. Chỉ dùng `--stamp` khi script xác nhận database tương thích và đã có backup:

```powershell
python scripts/adopt_legacy_database.py
python scripts/adopt_legacy_database.py --stamp
```

Stamp không chạy DDL; nó chỉ ghi version. Không dùng để bỏ qua một schema chưa tương thích.

## Ranh giới Supabase Data API

Các revision bảo mật và dữ liệu gần nhất:

- `20260831_0022`: đóng ranh giới Supabase Data API;
- `20260831_0023`–`20260901_0025`: idempotency và metadata cho Chat Agent P2;
- `20260901_0026`: canonical `dataset_artifacts`/`dataset_ingestions` và bind artifact vào profile run.
- `20260915_0027`: khôi phục Owner/Analyst workspace role, với preflight từ chối active tenant thiếu Owner hợp lệ.
- `20260915_0028`: cho phép `datasource_connections.config_encrypted` nullable để CLI riêng có thể purge credential legacy; schema migration không tự xóa dữ liệu.
- `20260915_0029`: sửa pointer published report chỉ khi có version `published` cùng report, rồi từ chối các row không thể sửa an toàn.

Revision `20260831_0022`:

- bật RLS cho toàn bộ app table được inventory;
- không tạo policy cho `anon` hoặc `authenticated`;
- revoke quyền bảng/sequence/function của `PUBLIC`, `anon`, `authenticated`;
- siết default privilege để table mới không tự mở qua Data API.

`src/backend/src/services/database_access_policy.py` là inventory dùng chung. `scripts/assert_database_security.py` kiểm tra các role frontend bị từ chối và backend role vẫn CRUD được:

```powershell
python scripts/assert_database_security.py
```

Đây là kiểm tra trên database thực, không thay thế bằng việc chỉ đọc catalog hoặc migration text.

## Quy trình release

1. backup và xác nhận revision hiện tại;
2. trước khi upgrade, audit active tenant/legacy connector/published pointer và review backup; chạy image backend bất biến với `alembic upgrade head` (revision `0027`/`0029` có thể chặn release nếu dữ liệu legacy chưa được xử lý);
3. dừng release nếu migration lỗi;
4. deploy API/worker/frontend cùng SHA;
5. kiểm tra health, database connectivity, published read invariant và các security assertion phù hợp; rollout credential riêng theo [hướng dẫn triển khai](deployment.md) sau `0028`;
6. giữ image SHA trước để rollback app; rollback schema phải theo migration/restore plan riêng.
