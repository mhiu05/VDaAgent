# Benchmark production-grade vi-VN

Pipeline này tái sử dụng bộ 83 case tiếng Việt, chạy qua API/SSE thật của
VDaAgent và lưu artifact bất biến theo `run_id`. Dữ liệu đầu vào hoàn toàn tổng
hợp; ground truth được tính độc lập với output của hệ thống.

## Phạm vi

- 83 case bao phủ profiling, numeric, quality, PII, drift, evidence,
  clarification, abstention, multi-turn, tool use và safety.
- Case khó hoặc đối kháng chạy 3 lần; case còn lại chạy 1 lần.
- Local run không phải bằng chứng production/Azure và mọi release scorecard luôn
  ở trạng thái draft cho đến khi project owner phê duyệt.
- Metric thiếu evidence quan sát được giữ `NOT_EVALUATED`, không quy đổi thành 0.

## Chuẩn bị

Backend và frontend local phải sẵn sàng ở các endpoint mặc định:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8000
```

```powershell
pnpm --dir frontend dev
```

Giữ secret trong `.env`. Không truyền mật khẩu/token trực tiếp trên command line
và không đưa chúng vào artifact. Local benchmark dùng guest identity ổn định,
được lưu dưới dạng pseudonym không phải credential.

## Chạy benchmark

Smoke đại diện cho 8 capability:

```powershell
.venv\Scripts\python.exe tests\benchmark\run_production_benchmark.py `
  --execute `
  --environment local `
  --api-url http://127.0.0.1:8000/api/v1 `
  --run-id run-YYYYMMDDTHHMMSS-smoke `
  --smoke `
  --qa-concurrency 1 `
  --case-timeout 60 `
  --timeout 60
```

Chạy một hoặc nhiều case:

```powershell
.venv\Scripts\python.exe tests\benchmark\run_production_benchmark.py `
  --execute --environment local `
  --case-id P170-VI-064 `
  --case-id P170-VI-067
```

Chạy đủ 83 case bằng cách bỏ `--smoke`, `--case-id`, `--category` và
`--max-cases`. Có thể dùng:

- `--reuse-provision-from RUN_ID`: tạo run mới nhưng tái sử dụng các Profile Run
  local đã hoàn tất và đúng workspace.
- `--resume RUN_ID`: tiếp tục đúng run còn thiếu request; không ghi đè record đã
  hoàn tất.
- `--baseline PATH`: so sánh regression với một `benchmark_summary.json` trước.
- `--no-postprocess`: chỉ thực thi; hữu ích khi muốn hậu xử lý riêng.
- `--judge-only --resume RUN_ID`: chấm lại Judge/artifact hiện có, không chạy lại
  agent.

Runner áp deadline cứng theo case. SSE treo hoặc chỉ phát heartbeat không thể làm
pipeline chờ vô hạn.

## Hậu xử lý một run

```powershell
$runId = 'run-YYYYMMDDTHHMMSS-smoke'
.venv\Scripts\python.exe tests\benchmark\normalize_results.py --run-id $runId
.venv\Scripts\python.exe tests\benchmark\extract_langsmith_traces.py --run-id $runId
.venv\Scripts\python.exe tests\benchmark\grade_benchmark.py --run-id $runId
.venv\Scripts\python.exe tests\benchmark\audit_numeric_accuracy.py --run-id $runId
.venv\Scripts\python.exe tests\benchmark\audit_grader.py --run-id $runId
.venv\Scripts\python.exe tests\benchmark\build_report.py --run-id $runId
.venv\Scripts\python.exe tests\benchmark\validate_benchmark_artifacts.py --run-id $runId
```

Gemini Judge cần API key hợp lệ và model được phát hiện qua Models API. Nếu auth,
quota hoặc model discovery thất bại, deterministic/RAG/tool scores vẫn được giữ
nguyên và Judge ghi trạng thái thất bại rõ ràng; pipeline không tạo điểm giả.

## Artifact

Mỗi run nằm trong `evaluations/runs/<run_id>/`:

- `raw_results.jsonl`: SSE/API response gốc của đúng run.
- `normalized_results.jsonl`: projection dùng chung cho graders.
- `langsmith_trace_mapping.json`: map trace chính xác bằng `agent_run_id`.
- `scores/`: deterministic, evidence, safety, RAG, agentic, performance, Judge
  và release-gate scorecard.
- `audit/`, `audits/`, `failures/`: audit numeric/SSE/grader và root-cause.
- `benchmark_summary.json`, `report.md`, `validation_results.json`: bàn giao cuối.
- `stages/`: trạng thái từng bước để resume và điều tra lỗi.

Alias mới nhất được publish về `evaluations/report.md`,
`evaluations/benchmark_summary.json` và các thư mục score/audit tương ứng chỉ sau
khi stage liên quan hoàn tất. Thư mục run cũ không bị sửa hoặc xóa.

## Kiểm thử contract

```powershell
.venv\Scripts\python.exe -m pytest tests\benchmark -q
pnpm --dir frontend test:e2e
```

