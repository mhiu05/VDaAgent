# Artifact đánh giá

Thư mục này chỉ chứa report và scorecard đã sinh. Code, fixture và pytest nằm ở
`tests/evaluations`; phương pháp, metric và limit được giải thích trong [tài liệu đánh giá](../docs/development/evaluation.md).

Chạy kiểm tra hợp đồng harness mà không gọi provider/network:

```powershell
python tests/evaluations/run_evaluation.py --dry-run
python tests/evaluations/run_evaluation.py --offline
```

Scorecard offline với runtime `offline_harness_contract` chỉ kiểm tra evaluator.
Chỉ `staging_synthetic_api`, chạy trên Profile Run synthetic, mới là kết quả
model/API có thể dùng làm baseline v2.

Không đưa raw row, PII, prompt, full output, credential hoặc workspace ID vào artifact.
