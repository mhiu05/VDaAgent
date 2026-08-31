# Phát triển và kiểm thử local

## Điều kiện cần

Sử dụng Python 3.11, Node.js 22, pnpm 11.0.8 và PostgreSQL. PostgreSQL bắt buộc cả ở local; backend không có SQLite fallback. Provider key là tùy chọn nếu muốn chạy LLM, embedding hoặc Google Drive.

## Cài đặt và cấu hình

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Sửa DATABASE_URL trong .env để trỏ tới PostgreSQL local trước bước migration.
cd frontend
pnpm install
cd ..
alembic upgrade head
```

Đặt ít nhất `DATABASE_URL` trong `.env`. Với file local, dùng `APP_ENV=development`, `AUTH_MODE=dual`, `STORAGE_PROVIDER=local` và frontend API URL phù hợp. Chỉ thêm LLM key khi cần test path dùng model.

## Chạy ba process

```powershell
# API
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Profiling Worker (từ repository root)
Set-Location <repo-root>
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe -m src.workers.profiling_worker

# Frontend
Set-Location frontend
pnpm dev --port 3000
```

Nếu đã cài GNU Make, Makefile có shortcut `backend`, `worker`, `frontend`, `dev`, `health`, `frontend-check` và `frontend-build`. Kiểm tra `http://localhost:8000/health` và `http://localhost:3000/health` trước khi debug job queued.

## Lệnh kiểm chứng

Backend command phụ thuộc môi trường repository; chạy focused pytest trước rồi chạy toàn bộ suite khi phù hợp. Frontend script nằm trong `frontend/package.json`:

```powershell
cd frontend
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

CI còn chạy Ruff, backend pytest, Playwright browser setup, offline/dry-run evaluation và production-style frontend build với Command Center bật. Khi đổi contract, tìm test theo feature (`profile`, `analysis`, `qa`, `report`, `workspace`, `connector`, `drift`).

## Quy tắc phát triển an toàn

- Giữ `.env` và mọi provider/database credential ngoài commit.
- Dùng fixture có workspace scope và assert behavior 401/403/404 cho cross-tenant access.
- Giữ `is_approximate`, source hash, context version id và evidence status trong API/UI code mới.
- Thay đổi PostgreSQL schema phải có migration; không tạo path chỉ chạy trên SQLite.
- Coi test và tài liệu là consumer của contract trong `backend/src/` và `frontend/src/`.

Xem [configuration](../operations/configuration.md), [evaluation](./evaluation.md) và [deployment](../operations/deployment.md).
