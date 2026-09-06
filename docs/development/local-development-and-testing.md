# Phát triển và kiểm thử local

> Đã đối chiếu với Makefile, package scripts, test harness và CI hiện tại ngày 2026-09-06.

> **Trạng thái working tree:** source đã chuyển vào `src/backend` và `src/frontend`, nhưng Makefile, Alembic, test bootstrap, nhiều script, Docker và CI vẫn dùng layout cũ. Vì vậy clean local workflow đang bị chặn cho tới khi hoàn tất migration đường dẫn. Các lệnh dưới đây là contract mục tiêu theo layout mới; xem [giới hạn hiện tại](../architecture/known-limitations.md).

## Yêu cầu

- Python 3.11;
- Node.js 22;
- pnpm 11.0.8;
- PostgreSQL;
- Chromium cho Playwright/PDF khi chạy các test tương ứng.

## Cài đặt

Từ repository root trên PowerShell:

```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Set-Location src/frontend
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
Set-Location ../..
```

Sửa `.env` cho local:

```dotenv
APP_ENV=development
AUTH_MODE=dual
AUTH_ALLOW_GUEST=true
AUTH_REQUIRE_EMAIL_CONFIRMED=false
CANONICAL_STORAGE_PROVIDER=local
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/p170
```

Không dùng nguyên các placeholder production trong `.env.example`.

## Chuẩn bị database

```powershell
.\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
```

Production schema phải đi qua Alembic. Local/test có compatibility bootstrap trong repository, nhưng không nên dựa vào nó để thay migration.

Khi máy dev có worker khác dùng test DB cấu hình sẵn, chạy suite trong database disposable để tránh race:

```powershell
.\.venv\Scripts\python.exe scripts\run_isolated_pytest.py -q
```

Harness chỉ dùng server/credential từ `P170_TEST_DATABASE_URL`, không sửa database đó; nó tạo, migrate và drop một database tên `p170_test_*` trong `finally`.

## Chạy ba process sau khi hoàn tất migration layout

Terminal API:

```powershell
Set-Location src/backend
..\..\.venv\Scripts\python.exe -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Terminal worker:

```powershell
Set-Location src/backend
..\..\.venv\Scripts\python.exe -m src.workers.profiling_worker
```

Terminal frontend:

```powershell
Set-Location src/frontend
pnpm dev
```

Frontend mặc định ở `http://localhost:3000`, API ở `http://localhost:8000`. Kiểm tra `/health` trước khi thử upload/profile. Worker là process bắt buộc cho profiling bất đồng bộ.

## Kiểm thử

Backend từ repository root:

```powershell
ruff check src/backend/src tests
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
Set-Location src/frontend
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

Trước khi coi các lệnh trên là hợp lệ, `src/backend/src/config.py` và `src/backend/migrations/env.py` phải resolve `.env`/`config.yaml` về repository root; `tests/conftest.py`, `alembic.ini` và các script phải thêm `src/backend` vào import path. Không copy `.env` vào source tree như một workaround lâu dài.

Playwright config có thể khởi động frontend test server ở port 3010; backend test target vẫn phải sẵn sàng theo cấu hình E2E.

## Kiểm tra mục tiêu

Migration và database boundary:

```powershell
.\.venv\Scripts\python.exe scripts/migration_smoke.py
.\.venv\Scripts\python.exe scripts/assert_database_security.py
```

Evaluation contract:

```powershell
.\.venv\Scripts\python.exe tests/evaluations/run_evaluation.py --dry-run
.\.venv\Scripts\python.exe tests/evaluations/run_evaluation.py --offline
```

AI latency synthetic local:

```powershell
.\.venv\Scripts\python.exe scripts/benchmark_ai_latency.py
```

Dry-run/offline chỉ kiểm tra fixture và evaluator wiring; benchmark local không phải production SLO.

## Trước khi gửi thay đổi

1. xem `git status`, `git diff`, `git diff --staged`;
2. không ghi đè thay đổi không liên quan;
3. chạy test phù hợp với phạm vi;
4. kiểm tra secret, file sinh tự động và artifact lớn;
5. chia commit theo một chức năng logic, gồm cả frontend/backend/test cần thiết cho chức năng đó.
