# Evaluation artifacts

Thư mục này chỉ lưu report và benchmark đã sinh ra từ evaluation. Không đặt mã
nguồn evaluator, fixture hay test tại đây.

- Mã chạy evaluation, fixture, release gate và unit test: [`tests/evaluations/`](../tests/evaluations/)
- Tài liệu kiến trúc, cách chạy và các việc owner cần duyệt: [`docs/eval.md`](../docs/eval.md)
- Scorecard gần nhất: [`results/latest_scorecard.md`](results/latest_scorecard.md)

Chạy evaluation từ thư mục gốc:

```powershell
.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py --dry-run
.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py --offline
```
