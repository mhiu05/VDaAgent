# P-170 — Nền tảng profiling và phân tích dữ liệu

P-170 là ứng dụng phân tích dữ liệu nhiều workspace theo nguyên tắc evidence-first: profiling dữ liệu dạng bảng, phân tích có giới hạn, hỏi đáp có nguồn, so sánh drift và tạo report.

## Chức năng hiện có

- Upload file CSV/TSV/Parquet/JSON hoặc kết nối MySQL, MongoDB và DuckDB.
- Đưa Profile Run vào PostgreSQL queue và xử lý bằng Profiling Worker.
- Review proposal về schema/chất lượng, tín hiệu PII, thống kê, correlation, outlier và narrative.
- Tạo chart trong Command Center qua Preview và Official execution riêng biệt.
- Hỏi QA dựa trên profile và execution qua JSON hoặc SSE.
- So sánh các run đã hoàn thành bằng drift signal từ thống kê đã lưu.
- Biên soạn Report Draft có thể sửa, tạo snapshot bất biến và export PDF an toàn với PII.
- Cô lập dữ liệu theo workspace và kiểm tra capability ở API boundary.

## Bắt đầu nhanh

Yêu cầu: Python 3.11, Node.js 22, pnpm 11.0.8 và PostgreSQL. PostgreSQL là dependency bắt buộc; backend không có SQLite fallback.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Sửa DATABASE_URL trong .env để trỏ tới PostgreSQL local trước bước migration.
alembic upgrade head
cd frontend
pnpm install
cd ..
```

Đặt tối thiểu `DATABASE_URL` trong `.env`. Với luồng file local, dùng `APP_ENV=development`, `AUTH_MODE=dual` và local storage theo [hướng dẫn phát triển và kiểm thử local](docs/development/local-development-and-testing.md). Nếu môi trường đã có GNU Make, có thể chạy ba process bằng các shortcut:

```text
make backend     # FastAPI trên :8000
make worker      # Profiling Worker dùng queue bền vững
make frontend    # Next.js trên :3000
make health
```

## Tài liệu kỹ thuật

Xem [docs/README.md](docs/README.md) để tìm tài liệu theo lộ trình.

- [Tổng quan hệ thống](docs/architecture/system-overview.md) — topology, request path và source map.
- [Profiling Job bất đồng bộ](docs/architecture/async-profiling-jobs.md) — queue, state, lease và SSE.
- [Phân tích có giới hạn](docs/architecture/bounded-execution.md) — QuerySpec, Preview/Official và quality gate.
- [Agent system](docs/architecture/agent-system.md) — LangGraph, QA, retrieval, trace và evidence.
- [Reports](docs/features/reports.md) — draft, snapshot, export và lifecycle hiện tại.
- [Cấu hình](docs/operations/configuration.md) — cấu hình hiệu lực và bộ kiểm tra production.
- [Triển khai Azure](docs/operations/deployment.md) — CI/CD đang dùng.
- [Đánh giá](docs/development/evaluation.md) — phạm vi harness và cách diễn giải kết quả.

[ARCHITECTURE.md](ARCHITECTURE.md) là chỉ mục kiến trúc ngắn. [docs/summary.md](docs/summary.md) là handover snapshot và sổ đăng ký điểm còn thiếu.

## Cấu trúc repository

```text
backend/src/        FastAPI router, agent, service, worker và persistence
backend/migrations/  Lịch sử Alembic cho PostgreSQL
frontend/src/       Next route, component, API client và PDF route
tests/              Test backend, frontend, integration và evaluation
evaluations/        Scorecard và report của harness
config.yaml         Default không chứa secret
.env.example        Danh sách key môi trường
.github/workflows/   Workflow build/deploy Azure
```

README root chỉ giữ vai trò entry point. Hợp đồng chi tiết cần được cập nhật tại tài liệu gần implementation sở hữu nó.
