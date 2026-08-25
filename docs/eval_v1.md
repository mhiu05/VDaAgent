# Đánh giá AI cho VDaAgent

## Mục đích

VDaAgent đánh giá tầng AI như một phần của sản phẩm theo định hướng **evidence-first** (ưu tiên bằng chứng), chứ không phải như một bài benchmark chatbot thông thường.

Mọi kết quả số đều thuộc trách nhiệm của tầng tính toán xác định (**deterministic compute**).

Bảng benchmark tổng hợp: [`docs/benchmark.md`](benchmark.md).

Bộ đánh giá kiểm tra rằng các phản hồi của Agent và kế hoạch biểu đồ:

- tuân thủ ranh giới này;
- sử dụng bằng chứng hiện có;
- bảo toàn sự không chắc chắn;
- không làm lộ dữ liệu hoặc các khả năng mà sản phẩm chủ động không cung cấp.

## Kiến trúc đánh giá

```text
Synthetic, versioned fixtures
            |
            v

Offline oracle or authenticated staging API
            |
            v

Safe response envelope / chart plan
            |
            +--> deterministic safety and privacy checks
            +--> QAResponse / QuerySpec Pydantic validation
            +--> numeric, evidence, intent and calibration checks
            +--> configured release gates and optional baseline comparison
            |
            v

Redacted diagnostics + JSON / Markdown scorecard
            |
            +--> optional LangSmith live experiment (existing opt-in path)
```

Scorecard không bao giờ lưu:

- nội dung câu trả lời được sinh ra;
- prompt;
- dữ liệu hàng thô;
- PII;
- secret;
- chain-of-thought;
- workspace identifier.

## Phạm vi

Hiện được bao phủ bởi các fixture và evaluator xác định:

- định tuyến Q&A, tham chiếu số trong phạm vi cho phép, liên kết bằng chứng và đơn vị;
- marker cho groundedness và câu trả lời khi không đủ bằng chứng;
- marker cho instruction/intent trong những trường hợp có thể mô tả khách quan;
- từ chối an toàn đối với:
  - raw export;
  - PII;
  - secret;
  - prompt injection;
  - arbitrary SQL;
  - tool budget;
  - cross-workspace rejection envelope;
- allow-list cho chart plan;
- schema `QuerySpec`;
- analysis kind;
- aggregation;
- time grain;
- chart type;
- kiểm tra unknown-field;
- ngôn ngữ thể hiện độ không chắc chắn của forecast;
- tính toàn vẹn của fixture;
- release gate;
- so sánh delta với baseline.

Implementation của production trace hiện đã ghi nhận:

- model latency;
- token metadata từ provider khi có sẵn.

Offline scorecard báo cáo trung thực các giá trị này là `not_available`; nó không ước lượng chúng từ text.

## Trạng thái triển khai hiện tại

| Khu vực | Trạng thái | Triển khai | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| Fixture loader, dry run và offline mode | ĐÃ XONG | `tests/evaluations/run_evaluation.py` | Kiểm tra các split bắt buộc, ID duy nhất, surface và ràng buộc synthetic-only. |
| Bộ synthetic có version | ĐÃ XONG | `tests/evaluations/fixtures/v1.json` | 26 test case synthetic trên Q&A, groundedness, insufficient evidence, safety, forecast và chart planning. |
| Kiểm tra schema Q&A | ĐÃ XONG | `tests/evaluations/evaluation_core.py` | Sử dụng `QAResponse` của production, không dùng regex. |
| Format / allow-list của Chart plan | ĐÃ XONG | `tests/evaluations/evaluation_core.py` | Sử dụng `QuerySpec` của production; chấm điểm riêng các field của plan có liên quan đến validator. |
| Kiểm tra số và bằng chứng | ĐÃ XONG | `tests/evaluations/evaluation_core.py` | Kiểm tra deterministic đối với giá trị số/đơn vị chính xác và evidence binding. |
| Safety / privacy hard gates | ĐÃ XONG | `tests/evaluations/evaluation_core.py` | Synthetic canary, phân loại safe refusal/rejection và critical failure. |
| Groundedness / insufficient evidence | MỘT PHẦN | `tests/evaluations/fixtures/v1.json`, `tests/evaluations/evaluation_core.py` | Có deterministic forbidden-claim và limitation marker; chưa có semantic LLM judge. |
| Judge cho helpfulness và tone | ĐÃ XONG (synthetic) | `tests/evaluations/judge_rubric.py`, `evaluations/results/judge_scorecard.json` | Rubric v1, calibration 5/5 và online judge 26 case bằng native Gemini; semantic pass rate 69.23%. |
| Online API evaluation | MỘT PHẦN | `tests/evaluations/run_evaluation.py` live/LangSmith path | Cần synthetic staging Profile Run có xác thực; local JSON scorecard hiện chỉ là offline-contract. |
| Latency và token scorecard | ĐÃ XONG (baseline) | `backend/src/agents/runtime/trace.py`, `evaluations/results/approved_baseline.json` | Experiment native Gemini đủ 26/26 HTTP 200; p95 64.640s và 148,473 total tokens, vượt threshold production hiện tại. |
| Chi phí tiền tệ | ĐÃ XONG (baseline) | `evaluations/results/approved_baseline.json` | LangSmith ghi nhận $0.181903 từ 45 native Gemini provider spans; được lưu làm baseline nhưng chưa đạt budget release $0.06. |
| Release gates | ĐÃ XONG (tạm thời) | `tests/evaluations/release_gates.json` | Threshold được tập trung hóa; vẫn cần owner phê duyệt. |
| So sánh regression | ĐÃ XONG | `--baseline` trong `run_evaluation.py` | So sánh các delta rate đã cấu hình khi cả hai scorecard đều có metric tương ứng. |
| CI deterministic gate | ĐÃ XONG | `.github/workflows/azure-container-deploy.yml` | Chạy dry-run và offline evaluation mà không cần external model credential. |
| Human-reviewed golden dataset | ĐÃ XONG | `tests/evaluations/fixtures/v1.json` | 26/26 synthetic cases đã được review và approve; không chứa customer row hoặc PII. |
| LangSmith experiment tracking | TÙY CHỌN | existing `run_live()` và redacted adapter | PostgreSQL vẫn là source of truth; không export raw content. |

## Những gì đã tồn tại trước công việc này

- synthetic fixture file;
- hard-gate scorer;
- unit test;
- `--dry-run`;
- `--offline` runner mode;
- một live API target dạng opt-in thông qua LangSmith `aevaluate()`;
- redacted LangSmith observability;
- PostgreSQL trace persistence;
- baseline Markdown report;
- CI workflow đã chạy backend test.

## Những gì được triển khai trong task này

- Thêm [`evaluation_core.py`](../tests/evaluations/evaluation_core.py), một tầng deterministic evaluator nhỏ dùng để:
  - validate model `QAResponse` và `QuerySpec` thực tế;
  - tạo safe diagnostic.

- Mở rộng [`fixtures/v1.json`](../tests/evaluations/fixtures/v1.json) thành các product suite có tên.
  - Mọi giá trị và canary đều là synthetic.

- Mở rộng [`run_evaluation.py`](../tests/evaluations/run_evaluation.py), đồng thời giữ nguyên:
  - các public helper function hiện có;
  - live mode hiện có.

  Offline run hiện ghi ra:
  - [`latest_scorecard.json`](../evaluations/results/latest_scorecard.json);
  - [`latest_scorecard.md`](../evaluations/results/latest_scorecard.md).

- Thêm configurable gate trong:
  - [`release_gates.json`](../tests/evaluations/release_gates.json);
  - so sánh bằng `--baseline`.

- Mở rộng evaluator unit test và thêm dry-run/offline evaluation vào CI.

## Cách chạy

Từ thư mục gốc của repository, sau khi cài `requirements.txt`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests\evaluations\test_evaluators.py

.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py --dry-run

.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py --offline

.\.venv\Scripts\python.exe -m ruff check tests\evaluations
```

Một offline run đánh giá:

- fixture oracle;
- evaluator contract.

Nó **không có nghĩa là một external LLM đã đạt được các điểm số đó**.

Nó ghi một redacted scorecard vào:

```text
evaluations/results/
```

Để so sánh một lần chạy sau này với một JSON baseline đã được phê duyệt:

```powershell
.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py --offline `
  --baseline evaluations\results\approved_baseline.json
```

Live path hiện có yêu cầu:

- staging-only synthetic Profile Run;
- workspace;
- bearer credential.

Không được trỏ nó vào production hoặc dữ liệu khách hàng thật:

```powershell
.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py `
  --base-url http://localhost:8000/api/v1 `
  --workspace-id <synthetic-workspace-id> `
  --profile-run-id <synthetic-profile-run-id>
```

Chỉ thêm:

```text
--upload-results
```

sau khi:

- privacy review đã hoàn tất;
- LangSmith credential đã được cấu hình.

CI chỉ chạy:

- dry-run;
- offline evaluation.

CI không bao giờ gọi:

- paid model;
- external evaluator.

## Tham chiếu metric

| Metric | Ý nghĩa / phạm vi | Evaluator | Offline | Release gate |
| --- | --- | --- | --- | --- |
| `hard_gate_pass_rate` | Các case vượt qua mọi hard check, 0–1; càng cao càng tốt | deterministic aggregate | có | có |
| `schema_contract_rate` | Output QA/Chart thành công và hợp lệ theo Pydantic contract, 0–1 | deterministic | có | có |
| `privacy_safe_rate` | Không làm lộ synthetic PII/secret/raw-data marker, 0–1 | deterministic | có | có |
| `evidence_binding_rate` | Bằng chứng mà case yêu cầu đã được gắn vào, 0–1 | deterministic | có | có |
| `numeric_grounding_rate` | Giá trị số kỳ vọng chính xác được giữ nguyên, 0–1 | deterministic | có | có |
| `groundedness_rate` | Không có explicit unsupported-claim marker, 0–1 | deterministic partial | có | chỉ provisional regression |
| `insufficient_evidence_rate` | Có ngôn ngữ limitation bắt buộc, 0–1 | deterministic | có | có |
| `intent_match_rate` | Các intent term bắt buộc đã được xử lý, 0–1 | deterministic partial | có | không |
| `planner_allowlist_rate` | Plan chỉ sử dụng column được fixture cho phép, 0–1 | deterministic | có | có |
| `planner_kind_rate` | Query analysis kind thuộc loại được phép, 0–1 | deterministic | có | có |
| `forecast_calibration_rate` | Forecast answer có uncertainty marker, 0–1 | deterministic | có | không |
| `latency_ms` | mean/p50/p95/max tổng API latency tính bằng ms | API telemetry | chỉ online | chưa cấu hình |
| `input_tokens` / `output_tokens` | Tổng token do provider báo cáo | provider metadata | chỉ online | chưa cấu hình |
| `estimated_cost` | Chi phí tiền tệ ước tính | pricing + exact usage | không khả dụng | không |

`privacy_leak` là một per-case check nội bộ có score bằng `1` khi an toàn.

Scorecard công khai alias ít gây nhầm lẫn hơn:

```text
privacy_safe_rate
```

## Release gate và regression

[`release_gates.json`](../tests/evaluations/release_gates.json) chứa các threshold tạm thời thay vì giấu chúng trong code.

Các critical safety/schema failure luôn khiến gate thất bại độc lập với average score.

`--baseline` chỉ đánh giá các rate delta được cấu hình và trả về:

- `pass`;
- `regression`;
- `not_available`.

Nó chủ động không reject các thay đổi rất nhỏ trừ khi cấu hình gate yêu cầu điều đó.

## Các hạn chế đã biết

- Dataset hiện tại là synthetic và chưa phải production golden set được con người phê duyệt.

- Groundedness, intent, helpfulness và tone hiện có cả deterministic marker check và semantic LLM-as-a-judge trên synthetic baseline; judge không thay thế hard gate.

- Offline output là controlled fixture oracle, vì vậy scorecard thu được xác thực **hệ thống evaluation**, chứ không phản ánh chất lượng thực tế của một model.

- Telemetry online đã được materialize vào [`approved_baseline.json`](../evaluations/results/approved_baseline.json); baseline đủ coverage 26/26, nhưng quality/token/cost chưa đạt production release gates.

- PostgreSQL trace có thể chứa:
  - latency;
  - exact provider token metadata;

  khi provider cung cấp các thông tin này.

- Chi phí trong baseline chỉ là provider-reported `total_cost` từ LangSmith; chưa coi đó là pricing policy cố định cho release gate.

- Safety test cung cấp regression coverage, chứ không phải bằng chứng rằng mọi prompt injection hoặc data-exfiltration attack đều không thể xảy ra.

## Bảo mật và quyền riêng tư

Evaluation fixture và report không được chứa:

- raw data row;
- PII thật;
- secret;
- API key thật;
- nội dung source file;
- system prompt;
- file path;
- cross-workspace data;
- chain-of-thought.

Diagnostic được thiết kế để chỉ chứa:

- case ID;
- suite;
- surface;
- tên score;
- safe comment.

LangSmith vẫn là tùy chọn và sử dụng metadata-only/redacted observability adapter hiện có.

## Các hành động Project Owner cần thực hiện

### 1. Phê duyệt human-reviewed golden dataset

- [x] Review:
  - các câu hỏi business đại diện;
  - các câu trả lời mơ hồ;
  - limitation mong đợi;
  - safety outcome;
  - ChartPlan expectation.

**Tại sao:** synthetic fixture xác thực engineering contract nhưng không phải là bằng chứng cho thấy hệ thống hữu ích với analyst trong production.

**Làm gì và ở đâu:** thêm các case đã review vào:

```text
tests/evaluations/fixtures/v1.json
```

hoặc một fixture file mới có version.

Đánh dấu chúng là:

- synthetic;
- hoặc approved;

theo data policy.

Không thêm:

- customer row;
- PII.

**Sau khi hoàn tất:** commit version của fixture đã được phê duyệt và ghi version đó trong release baseline scorecard.

**Đã hoàn tất (2026-08-24):** 26/26 case trong `p170-ai-eval-v1` được Project Owner review theo rubric `rubric_v1_case_by_case` và approve.

### 2. Phê duyệt production release threshold

- [x] Review và phê duyệt hoặc thay đổi mọi provisional threshold trong:

```text
tests/evaluations/release_gates.json
```

**Tại sao:** trade-off có thể chấp nhận giữa:

- answer quality;
- safety;
- latency;
- cost;

là quyết định về sản phẩm; code không thể tự lựa chọn một cách trung thực.

**Cần quyết định:**

- groundedness/intent rate tối thiểu;
- liệu mọi safety failure có block release hay không — khuyến nghị là **có**;
- mục tiêu p95 latency;
- token budget;
- cost budget nếu có.

**Quyết định đã phê duyệt (2026-08-24):**

- `hard_gate_pass_rate`, `schema_contract_rate`, `privacy_safe_rate`, `planner_allowlist_rate` và `planner_kind_rate`: tối thiểu `100%`; mọi lỗi safety/schema/privacy/allow-list đều block release.
- `evidence_binding_rate`, `numeric_grounding_rate` và `insufficient_evidence_rate`: tối thiểu `95%`.
- `groundedness_rate` và `intent_match_rate`: tối thiểu `90%`; đây là các metric deterministic một phần nên chừa dư địa cải tiến.
- Regression cho groundedness/intent: cho phép giảm tối đa `5%` so với baseline.
- Đã đặt gate khởi điểm: `latency_p95_ms <= 25000`, `total_tokens_per_run <= 90000` và `estimated_cost_usd_per_run <= 0.06`. Đây là ngưỡng có dư địa so với baseline LangSmith; cần siết lại sau khi có nhiều lần chạy đủ 26/26.

**Sau khi hoàn tất:** commit gate file đã được phê duyệt và sử dụng nó trong CI/release review.

### 3. Chạy và phê duyệt online synthetic baseline

Đã materialize redacted telemetry baseline tại [`evaluations/results/approved_baseline.json`](../evaluations/results/approved_baseline.json) từ experiment `p170-evidence-first-3995e435` đủ 26/26 case. Native Gemini runtime đã được chuyển sang `ChatGoogleGenerativeAI`, lỗi `thought_signature` trong tool call không còn xuất hiện, và toàn bộ request đều HTTP 200. Baseline được **approve để theo dõi regression online**, nhưng chưa phải production-release candidate vì 14/26 case không qua hard gate và các budget latency/token/cost đều vượt threshold hiện tại.

- [x] Cung cấp:
  - staging-only synthetic workspace;
  - completed Profile Run;
  - authorized bearer token;

sau đó chạy live command đã được document.

**Kết quả (2026-08-24):** experiment `p170-evidence-first-3995e435` đã được upload lên LangSmith và lưu redacted metadata. `release_gate_evaluation` trong baseline ghi rõ các gate chưa đạt; việc approve baseline không tự động approve production release.

**Tại sao:** offline mode không gọi LLM và không thể đo:

- chất lượng model;
- provider latency;
- provider token usage.

**Sau khi hoàn tất:**

- privacy-review experiment;
- export redacted baseline scorecard/metadata;
- lưu thành:

```text
evaluations/results/approved_baseline.json
```

- sử dụng `--baseline` cho các lần so sánh sau.

### 4. Quyết định có thêm LLM judge và cost accounting hay không

- [x] Chọn:
  - judge provider/model: native Gemini `gemini-3.6-flash`;
  - rubric owner: Project Owner;
  - calibration set: 5 case synthetic tại `tests/evaluations/fixtures/judge_calibration_v1.json`;
  - budget: provider-reported usage, không tự phỏng đoán giá;
  - data-handling: chỉ synthetic/redacted, không ghi raw prompt/answer vào scorecard;

owner phụ trách model pricing: Project Owner.

**Tại sao:** semantic helpfulness/tone không thể được đánh giá đầy đủ bằng deterministic method, và giá model không được phép tự phỏng đoán.

**Sau khi hoàn tất:**

- [x] thêm judge prompt/schema có version tại `tests/evaluations/judge_rubric.py`;
- [x] thêm pricing metadata đã được test tại `tests/evaluations/judge_pricing_v1.json`;
- [x] mở rộng scorecard bằng usage do provider thực tế báo cáo tại `evaluations/results/judge_scorecard.json`.

**Kết quả (2026-08-24):** calibration đạt `5/5`; online baseline đạt semantic pass rate `69.23%`, điểm trung bình helpfulness `3.9615/5`, groundedness `4.0385/5`, tone `4.3846/5`, uncertainty calibration `4.0/5`, safety `5.0/5`. Judge sử dụng 31 provider spans, 72,791 tokens và cost `$0.09253725` theo LangSmith.

Chạy lại judge:

```powershell
.\.venv\Scripts\python.exe tests\evaluations\run_judge.py `
  --experiment p170-evidence-first-3995e435 `
  --output evaluations\results\judge_scorecard.json
```
