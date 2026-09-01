# Migration cơ sở dữ liệu

> Đã kiểm tra theo chuỗi migration hiện có ngày 2026-09-01.

Alembic là nguồn sự thật schema cho production. Migration hiện là một chuỗi tuyến tính từ baseline `20260812_0000` đến head `20260901_0026`.

## Quy tắc

- Mọi thay đổi schema production phải có revision Alembic.
- Không dùng `create_all` hoặc ALTER tự phát trong production runtime.
- Revision phải nâng cấp được từ head trước và tạo được database mới từ rỗng.
- Downgrade phải rõ ràng; migration `20260901_0026` cố ý dùng no-op downgrade để không xóa artifact/provenance, nên rollback schema phải theo kế hoạch archive/restore riêng.
- Dùng `DATABASE_MIGRATION_URL` cho release khi migration cần connection khác app; nếu trống, Alembic dùng `DATABASE_URL`.

Repository local/test hiện vẫn gọi `create_all` và một số additive compatibility migration để hỗ trợ test/legacy. Hành vi đó không phải chiến lược triển khai production.

## Lệnh thường dùng

Từ repository root:

```powershell
alembic -c alembic.ini current
alembic -c alembic.ini heads
alembic -c alembic.ini upgrade head
alembic -c alembic.ini check
```

Tạo revision sau khi đã thiết kế và review SQL:

```powershell
alembic -c alembic.ini revision -m "describe logical change"
```

Không autogenerate rồi merge mù quáng; kiểm tra constraint, index, RLS, grant, lock và đường rollback.

## Kiểm thử migration

CI/workflow hiện chạy:

```powershell
python scripts/migration_smoke.py
python -m pytest -q tests/test_database_security.py
```

Smoke test bao gồm database mới và đường upgrade từ revision cũ được hỗ trợ. Trước release, chạy `alembic check` và kiểm tra chỉ có một head.

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

Revision `20260831_0022`:

- bật RLS cho toàn bộ app table được inventory;
- không tạo policy cho `anon` hoặc `authenticated`;
- revoke quyền bảng/sequence/function của `PUBLIC`, `anon`, `authenticated`;
- siết default privilege để table mới không tự mở qua Data API.

`backend/src/services/database_access_policy.py` là inventory dùng chung. `scripts/assert_database_security.py` kiểm tra các role frontend bị từ chối và backend role vẫn CRUD được:

```powershell
python scripts/assert_database_security.py
```

Đây là kiểm tra trên database thực, không thay thế bằng việc chỉ đọc catalog hoặc migration text.

## Quy trình release

1. backup và xác nhận revision hiện tại;
2. chạy image backend bất biến với `alembic upgrade head`;
3. dừng release nếu migration lỗi;
4. deploy API/worker/frontend cùng SHA;
5. kiểm tra health và các security assertion phù hợp;
6. giữ image SHA trước để rollback app; rollback schema phải theo migration/restore plan riêng.
