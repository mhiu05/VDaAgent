# VDaAgent

> VDaAgent là 1 nền tảng dành cho Data Analyst, giúp họ dễ dàng, thuận tiện hơn trong quá trình profiling bằng cách xây dựng workflow hoàn chỉnh và agent giúp insight data dễ dàng.

## Thành viên Team

| Member | Role |
|--------|------|
| Nguyễn Minh Hiếu | AI Engineer - Lead Team |
| Vũ Nguyễn Bảo Sơn | Product Manager |
| Phạm Thế Đăng | Web Developer |
| Phạm Thị Thùy Linh | Data Engineer, DevOps |

## Vấn đề

Analyst thường phải nối nhiều bước thủ công trước khi có thể trả lời một câu hỏi dữ liệu: kiểm tra schema/data type, missing values, uniqueness/duplicates, distribution/outliers, correlation và PII. Workflow này dài, lặp lại và khó chuẩn hóa.

Ngay cả khi đã có metric, vẫn còn khoảng cách từ profile đến insight: người dùng phải tự đặt câu hỏi, chọn phép phân tích, tạo visualization rồi diễn giải và kiểm chứng kết quả. Chat AI tự do có thể rút ngắn thao tác nhưng tạo rủi ro hallucination, lộ dữ liệu nhạy cảm và khó truy nguyên.

Theo các survey từ Anaconda (2022) và Alteryx (2026), data preparation/cleansing chiếm 37,75% thời gian của Data Professional; Analyst được khảo sát dành khoảng 5,7 giờ/tuần cho chuẩn bị dữ liệu và 3,7 giờ/tuần để kiểm tra/sửa AI output. 46% ưu tiên Human-in-the-Loop, trong khi chỉ 3% ưu tiên AI hoàn toàn tự động. Điều đó cho thấy automation cần đáng tin cậy, grounded và reviewable.

## Giải pháp

VDaAgent kết hợp compute deterministic, LangGraph và các quality gate để rút ngắn workflow nhưng vẫn giữ quyền kiểm soát cho con người:

- **Profiling đa nguồn và chuyên sâu:** upload CSV/TSV/Parquet/JSON hoặc import MySQL, MongoDB, DuckDB và Google Drive; tính missingness, cardinality, uniqueness, distribution, outlier, correlation, duplicate, PII, quasi-identifier, candidate key và semantic type.
- **Workflow bất đồng bộ có HITL:** PostgreSQL queue và worker có lease, heartbeat, retry, stale-job recovery; AI đề xuất metadata để Analyst confirm, reject, edit hoặc yêu cầu kiểm định sâu.
- **AI Q&A evidence-first:** Chat Agent dùng tool/retrieval có scope theo Profile Run và workspace; validator deterministic kiểm tra artifact, citation và numeric grounding; thiếu evidence thì abstain thay vì đoán.
- **Biểu đồ an toàn:** planner deterministic hoặc structured-output tạo `QuerySpec` allow-list; Preview bị giới hạn để khám phá, Official chạy lại trên nguồn đầy đủ trong quality gate và mới đủ điều kiện làm evidence/report.
- **Drift và báo cáo tái lập:** so sánh drift từ statistic đã lưu, ghim profile/chart/answer/note vào Report Draft, tạo snapshot SHA-256 bất biến và export PDF PII-safe.

## Target User

- **Primary:** Analyst và Data Engineer cần kiểm tra chất lượng, hiểu nhanh dataset và tạo insight có thể giải thích.
- **Secondary:** Product/Operations lead, nhóm BI và reviewer cần theo dõi drift, kiểm duyệt metadata và xuất báo cáo có provenance.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Agent | LangGraph + LLM cấu hình được (OpenAI/Gemini hoặc provider tương thích) |
| Backend | FastAPI + Python 3.11 + Pydantic + SQLAlchemy/Alembic |
| Compute | DuckDB file-backed + pandas/NumPy/SciPy/statsmodels/scikit-learn |
| Frontend | Next.js 15 + React 19 + TypeScript + TanStack Query |
| Database | PostgreSQL 16-compatible (bắt buộc; không có SQLite fallback) |
| Storage | Supabase Storage (production), local adapter (development/test), Google Drive import |
| DevOps | Docker + Azure App Service + Azure Container Registry + GitHub Actions |

## Quick Start



## Project Structure

```text

```

## API Endpoints

Tất cả router nghiệp vụ dùng prefix `/api/v1`; các endpoint dưới đây là bề mặt chính:


## License

MIT
