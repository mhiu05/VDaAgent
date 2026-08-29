# VDaAgent benchmark v2

## Trạng thái

| Artifact | Ý nghĩa |
| --- | --- |
| latest_scorecard.json | Kết quả benchmark v2 mới nhất, redacted |
| approved_baseline.json | Lịch sử v1, không comparable với v2 |
| judge_scorecard.json | Semantic judge v1, không comparable với v2 |

Lần chạy offline v2 xác nhận harness hoạt động; không xác nhận chất lượng
model. Đã có observed authenticated staging run v2 ngày 2026-08-29, với 17/17
HTTP 200 nhưng release gate vẫn fail, vì vậy nó chưa phải approved baseline v2. Xem
results/ai_evaluation_report.md và results/latest_scorecard.md.

## Decision rule

Chỉ một run có runtime staging_synthetic_api và dữ liệu synthetic mới được:

- đánh giá release gates;
- so sánh với approved_baseline_v2.json;
- đưa vào review của project owner.

Chi tiết fixture, metric, threshold draft, cách chạy và giới hạn nằm ở
docs/eval_v1.md.
