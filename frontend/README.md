# Profiling Platform Frontend

React/Vite UI cho agent profiling: chọn CSV/Excel/database, chạy profiling, xem report, biểu đồ correlation/top values, chạy kiểm định thống kê và chat với agent.

## Chạy local

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Frontend chạy tại `http://localhost:5173` và gọi backend mặc định tại `http://localhost:8000/api/v1`.

## Cấu trúc module

- `auth`: login/logout/session placeholder cho bước thêm auth.
- `layout`: sidebar, topbar, chat agent panel.
- `dashboard`: trang tổng quan workspace.
- `data-sources`: upload CSV/Excel, cấu hình SQL Server/PostgreSQL.
- `datasets`: chọn file/table/schema và xem schema preview.
- `profiling`: cấu hình profiling và statistical tests.
- `results`: report profiling, bảng metrics, findings, biểu đồ.
- `history`: lịch sử job profiling trong phiên làm việc.
- `settings`: cấu hình API base URL.
- `shared`: component dùng chung.
- `services`: gọi backend API.
- `hooks`, `types`, `utils`, `store`: state/helper/type notes dùng chung.

## Backend

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn src.main:app --reload --port 8000
```
