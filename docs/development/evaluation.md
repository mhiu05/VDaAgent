# Đánh giá AI và agent

> Đã đối chiếu với evaluation harness, fixtures và workflow quality gate hiện tại ngày 2026-09-06.

Evaluation v2 dùng dữ liệu synthetic và tập case có version để đo contract, evidence, planner, privacy, latency và regression. Harness chuẩn nằm trong `tests/evaluations/`; artifact chạy nằm trong `evaluations/results/`.

## Ba chế độ

### Dry-run

```powershell
python tests/evaluations/run_evaluation.py --dry-run
```

Chỉ validate fixture/schema, không gọi mạng và không đo chất lượng model.

### Offline

```powershell
python tests/evaluations/run_evaluation.py --offline
```

Chạy mock output để kiểm tra evaluator wiring. Kết quả `offline_harness_contract` không phải release decision.

### Staging synthetic

```powershell
$env:P170_EVAL_BEARER_TOKEN = "<temporary-token>"
python tests/evaluations/run_evaluation.py `
  --base-url "https://<api>/api/v1" `
  --workspace-id "<workspace-id>" `
  --profile-run-id "<full-run-id>" `
  --sample-profile-run-id "<sample-run-id>"
```

Chỉ mode gọi authenticated staging API mới đánh giá release gate. Token/header tạm không được commit. Dataset và profile run phải synthetic.

`scripts/run_evaluation_v2_staging.py` tự provision guest workspace/dataset, chạy profiling/evaluation và dọn tài nguyên. `scripts/run_evaluation_repeats.py` chạy lặp trên workspace/run đã chuẩn bị để đo tính ổn định. Xem tùy chọn trợ giúp trước khi chạy vì cả hai có thao tác lên môi trường mục tiêu.

## Chỉ số chính

- schema/answer contract;
- groundedness và numeric grounding;
- evidence binding/source/status;
- insufficient-evidence behavior;
- privacy/safety;
- planner allow-list, kind, aggregation, chart/time grain;
- forecast calibration;
- API success;
- latency p95 và telemetry availability;
- critical failure count.

Hard gate được định nghĩa trong fixture/config evaluation, không sửa scorecard bằng tay. Baseline phải cùng schema/dataset version và điều kiện chạy có thể so sánh.

## Trạng thái artifact hiện tại

`evaluations/results/latest_scorecard.md` là staging run ở commit `67172545e54b616d82cee3e3c161afd7d4e136c4`, không phải code hiện tại. Run có 17/17 response HTTP thành công nhưng release decision là **FAIL**:

- hard-gate pass 82,35%;
- evidence binding/source/status 50%;
- numeric grounding 50%;
- planner allow-list 75%;
- latency p95 86.012 ms;
- 8 critical failures.

Ba lần lặp trong `evaluations/results/repeats/account-20260829/` cùng thất bại ở candidate-key evidence, quality evidence và PII planner; hai run vượt latency gate 30 giây. Các thay đổi mới hơn đã sửa đường evidence/planning, nhưng chưa có staging rerun mới trong repository. Vì vậy không được tuyên bố hệ thống hiện “pass evaluation” trước khi chạy lại trên SHA mới.

## Quy trình release evidence

1. ghi SHA, config provider/model và dataset version;
2. provision synthetic full/sample runs;
3. chạy staging benchmark ít nhất một lần, chạy lặp khi thay agent/model;
4. giữ JSON và Markdown artifact có timestamp, không ghi đè lịch sử;
5. so với baseline tương thích;
6. review diagnostic đã redact;
7. chỉ chấp nhận khi mọi hard gate pass và không có regression bị cấm.

## Judge

`tests/evaluations/run_judge.py` và rubric versioned hỗ trợ semantic judge/calibration. Judge output phải ghi model, token/cost availability và trạng thái calibration. Judge không thay thế các deterministic hard gate về privacy, schema hoặc evidence.

## Nguồn sự thật

- `tests/evaluations/run_evaluation.py`
- `tests/evaluations/evaluation_core.py`
- `tests/evaluations/fixtures/`
- `tests/evaluations/judge_rubric.py`
- `evaluations/results/`
- `.github/workflows/azure-container-deploy.yml`
