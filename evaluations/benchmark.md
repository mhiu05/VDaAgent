# Benchmark v2 của P-170

## Trạng thái artifact

| Artifact | Ý nghĩa |
| --- | --- |
| [`results/latest_scorecard.json`](results/latest_scorecard.json) | Kết quả benchmark v2 mới nhất, redacted |
| [`results/approved_baseline.json`](results/approved_baseline.json) | Lịch sử v1, không comparable với v2 |
| [`results/judge_scorecard.json`](results/judge_scorecard.json) | Semantic judge v1, không comparable với v2 |

Lần chạy offline v2 xác nhận harness hoạt động; không xác nhận chất lượng
model. Đã có authenticated staging run v2 ngày 2026-08-29, với 17/17
HTTP 200 nhưng release gate vẫn fail, vì vậy nó chưa phải approved baseline v2. Xem
[`results/ai_evaluation_report.md`](results/ai_evaluation_report.md) và [`results/latest_scorecard.md`](results/latest_scorecard.md).

## Quy tắc quyết định

Chỉ một run có runtime staging_synthetic_api và dữ liệu synthetic mới được:

- đánh giá release gates;
- so sánh với `approved_baseline_v2.json` sau khi artifact này được phê duyệt; hiện repository chưa có file đó;
- đưa vào review của project owner.

Chi tiết fixture, metric, threshold draft, cách chạy và giới hạn nằm trong
[docs/development/evaluation.md](../docs/development/evaluation.md).
