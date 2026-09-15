# Đánh giá AI và agent

> Đã đối chiếu với evaluation harness, benchmark artifact và workflow quality gate trong working tree ngày 2026-09-15.

Có hai bộ đánh giá khác nhau: harness evaluation v2 ở `tests/evaluations/` (mặc định **ghi output khi chạy** vào `evaluations/results/`, thư mục này chưa có trong checkout), và benchmark 83 case vi-VN ở `tests/benchmark/` (artifact đã có trong `evaluations/runs/<run_id>/`, alias `evaluations/report.md`). Không dùng scorecard của bộ này thay cho release decision của bộ kia.

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

Chỉ mode gọi authenticated staging API mới đánh giá release gate của harness này. Token/header tạm không được commit. Dataset và profile run phải synthetic. Truyền `--output-dir evaluations/results/<timestamp-or-sha>` để giữ lịch sử khi chạy lại, thay vì ghi đè file `latest_scorecard.*` mặc định.

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

Checkout không có `evaluations/results/latest_scorecard.md` hay `evaluations/results/repeats/`; các nhận định từ đường dẫn lịch sử đó không phải bằng chứng hiện tại. [Benchmark report mới nhất](../../evaluations/report.md) trỏ đến run `run-20260905T001300-full-openai-final-r3`: 83 case/125 request synthetic **LOCAL**; deterministic assertion đạt 83/83, nhưng Focused RAG Context Recall dùng cận dưới Wilson 95% chỉ đạt 77,0% so với gate 80%, nên acceptance **FAIL**. Release status vẫn `DRAFT_NOT_APPROVED`; không suy từ các điểm deterministic sang tuyên bố readiness production. Run này cũng cũ hơn các thay đổi trong working tree ngày 2026-09-15, cần chạy lại và review trên đúng SHA/môi trường mục tiêu.

CI chạy harness `--dry-run` và `--offline`, không chạy benchmark authenticated staging/production; một quality job xanh không phải release evidence cho AI.

## Quy trình release evidence

1. ghi SHA, config provider/model và dataset version;
2. provision synthetic full/sample runs;
3. chạy evaluation staging và/hoặc [benchmark vi-VN](../../tests/benchmark/README.md) phù hợp gate được chọn; chạy lặp khi thay agent/model;
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
- `evaluations/runs/` và `evaluations/report.md` (benchmark đã ghi trong checkout); `evaluations/results/` là output mặc định của evaluation v2 **sau khi chạy**, không phải artifact đang tồn tại
- `tests/benchmark/README.md`
- `.github/workflows/azure-container-deploy.yml`
