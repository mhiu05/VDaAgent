# Đánh giá AI

Bộ đánh giá theo hướng evidence-first cho VDaAgent. Fixture chỉ dùng dữ liệu tổng hợp; không chứa định danh tenant, raw row, PII thật, đường dẫn nguồn, system prompt hay secret.

## Thành phần

- `fixtures/v1.json`: bộ dữ liệu `p170-ai-eval-v1` với các split `dev`, `test`, `security`, `regression`.
- `run_evaluation.py`: kiểm tra cấu trúc, scorecard offline và target API thật qua `LangSmith aevaluate()`.
- `test_evaluators.py`: unit test cho các hard gate.
- `results/`: báo cáo baseline và kết quả chạy đánh giá.

## Hard gate

Các gate sau phải đạt 100%: schema response, không lộ PII/secret/raw data, chặn prompt injection/raw export, evidence binding, số liệu và cờ approximate, tool budget, chart planner allow-list.

LLM-as-judge chỉ là lớp đánh giá bổ sung trên fixture tổng hợp; không được thay deterministic gate hoặc tự quyết định release.

## Chạy

Tại thư mục gốc repository:

```powershell
.\.venv\Scripts\python.exe evaluations\run_evaluation.py --dry-run
.\.venv\Scripts\python.exe evaluations\run_evaluation.py --offline
.\.venv\Scripts\python.exe -m pytest -q evaluations\test_evaluators.py
```

Live mode gọi API staging/test với một Profile Run synthetic:

```powershell
.\.venv\Scripts\python.exe evaluations\run_evaluation.py --base-url http://localhost:8000/api/v1 --workspace-id <workspace-synthetic> --profile-run-id <profile-run-synthetic>
```

Mặc định không upload experiment. Chỉ thêm `--upload-results` sau privacy review. Lỗi API/model là `infra_error`, không được tính là pass chất lượng.

## Quy tắc CI

- PR: dry-run, unit test evaluator và security split; không dùng network.
- Nightly: live synthetic suite với repetition và budget cố định.
- Staging/release: regression split phải pass trước khi promote.