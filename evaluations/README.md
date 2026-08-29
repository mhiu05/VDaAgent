# Evaluation artifacts

Thư mục này chỉ chứa report và scorecard đã sinh. Code, fixture và pytest ở
tests/evaluations; phương pháp, metric và giới hạn ở docs/eval_v1.md.

Scorecard offline có runtime offline_harness_contract chỉ kiểm tra evaluator.
Chỉ staging_synthetic_api, chạy trên Profile Run synthetic, mới là kết quả
model/API có thể dùng làm baseline v2.

Không đưa raw row, PII, prompt, output đầy đủ, credential hoặc workspace ID
vào artifact này.
