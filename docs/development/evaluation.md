# Đánh giá và release evidence

## Bộ đánh giá đo điều gì

Artifact trong [`evaluations/`](../../evaluations/) đo behavior của harness, xử lý API/status, artifact an toàn với privacy, telemetry assertion và hard gate. Đây không phải model-quality evaluation và không nên được đọc như accuracy score production.

Scenario có thể so sánh là staging synthetic API run. Offline v2 và dry-run kiểm tra harness mà không gọi provider/network. Artifact judge/baseline v1 lịch sử không comparable với scorecard hiện tại.

## Lệnh và artifact

Dùng script được nêu trong [`evaluations/README.md`](../../evaluations/README.md) và CI workflow:

```powershell
python tests/evaluations/run_evaluation.py --dry-run
python tests/evaluations/run_evaluation.py --offline
```

Artifact không được chứa raw row, PII, prompt, model output, credential hoặc workspace identifier. Synthetic fixture nằm cùng evaluation test. Harness pass vẫn cần review authz, migration state, source availability và provider configuration.

## Diễn giải khi release

Dùng staging synthetic API scorecard để so sánh behavior HTTP/evidence. Ghi lại commit, nhóm effective configuration (không ghi secret), database/migration level và run là offline hay staging. Không so sánh score giữa các harness version khác nhau; việc quality job bị skip trên push `main` cũng không chứng minh application đúng vì workflow hiện tại chủ ý skip chúng.

## Vị trí source code và kiểm chứng

- Evaluation README/benchmark/report: [`evaluations/README.md`](../../evaluations/README.md), [`benchmark.md`](../../evaluations/benchmark.md), [`report.md`](../../evaluations/report.md).
- Harness: [`tests/evaluations/run_evaluation.py`](../../tests/evaluations/run_evaluation.py) và fixture/test kế cận.
- CI integration: [workflow deployment](../operations/deployment.md).
