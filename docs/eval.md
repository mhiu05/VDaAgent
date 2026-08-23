# Đánh giá AI cho VDaAgent

## Mục đích

VDaAgent đánh giá tầng AI như một phần của sản phẩm theo định hướng **evidence-first** (ưu tiên bằng chứng), chứ không phải như một bài benchmark chatbot thông thường.

Mọi kết quả số đều thuộc trách nhiệm của tầng tính toán xác định (**deterministic compute**).

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
| Fixture loader, dry run và offline mode | ĐÃ XONG | `evaluations/run_evaluation.py` | Kiểm tra các split bắt buộc, ID duy nhất, surface và ràng buộc synthetic-only. |
| Bộ synthetic có version | ĐÃ XONG | `evaluations/fixtures/v1.json` | 21 test case synthetic trên Q&A, groundedness, insufficient evidence, safety, forecast và chart planning. |
| Kiểm tra schema Q&A | ĐÃ XONG | `evaluations/evaluation_core.py` | Sử dụng `QAResponse` của production, không dùng regex. |
| Format / allow-list của Chart plan | ĐÃ XONG | `evaluations/evaluation_core.py` | Sử dụng `QuerySpec` của production; chấm điểm riêng các field của plan có liên quan đến validator. |
| Kiểm tra số và bằng chứng | ĐÃ XONG | `evaluations/evaluation_core.py` | Kiểm tra deterministic đối với giá trị số/đơn vị chính xác và evidence binding. |
| Safety / privacy hard gates | ĐÃ XONG | `evaluations/evaluation_core.py` | Synthetic canary, phân loại safe refusal/rejection và critical failure. |
| Groundedness / insufficient evidence | MỘT PHẦN | `evaluations/fixtures/v1.json`, `evaluation_core.py` | Có deterministic forbidden-claim và limitation marker; chưa có semantic LLM judge. |
| Judge cho helpfulness và tone | CHƯA TRIỂN KHAI | — | Cần judge model/rubric có version, đã được phê duyệt và calibration set. |
| Online API evaluation | MỘT PHẦN | existing `run_evaluation.py` live/LangSmith path | Cần synthetic staging Profile Run có xác thực; local JSON scorecard hiện chỉ là offline-contract. |
| Latency và token scorecard | MỘT PHẦN | `backend/src/agents/runtime/trace.py`, `evaluation_core.py` | Backend trace đã capture các giá trị có sẵn; việc trích xuất vào online scorecard đang chờ triển khai. |
| Chi phí tiền tệ | CHƯA TRIỂN KHAI | — | Không có pricing configuration được duy trì trong repository, vì vậy không tự bịa giá. |
| Release gates | ĐÃ XONG (tạm thời) | `evaluations/release_gates.json` | Threshold được tập trung hóa; vẫn cần owner phê duyệt. |
| So sánh regression | ĐÃ XONG | `--baseline` trong `run_evaluation.py` | So sánh các delta rate đã cấu hình khi cả hai scorecard đều có metric tương ứng. |
| CI deterministic gate | ĐÃ XONG | `.github/workflows/azure-container-deploy.yml` | Chạy dry-run và offline evaluation mà không cần external model credential. |
| Human-reviewed golden dataset | CẦN OWNER THỰC HIỆN | fixture format đã hỗ trợ | Fixture hiện tại là synthetic, chưa phải production golden set. |
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

- Thêm [`evaluation_core.py`](../evaluations/evaluation_core.py), một tầng deterministic evaluator nhỏ dùng để:
  - validate model `QAResponse` và `QuerySpec` thực tế;
  - tạo safe diagnostic.

- Mở rộng [`fixtures/v1.json`](../evaluations/fixtures/v1.json) thành các product suite có tên.
  - Mọi giá trị và canary đều là synthetic.

- Mở rộng [`run_evaluation.py`](../evaluations/run_evaluation.py), đồng thời giữ nguyên:
  - các public helper function hiện có;
  - live mode hiện có.

  Offline run hiện ghi ra:
  - [`latest_scorecard.json`](../evaluations/results/latest_scorecard.json);
  - [`latest_scorecard.md`](../evaluations/results/latest_scorecard.md).

- Thêm configurable gate trong:
  - [`release_gates.json`](../evaluations/release_gates.json);
  - so sánh bằng `--baseline`.

- Mở rộng evaluator unit test và thêm dry-run/offline evaluation vào CI.

## Cách chạy

Từ thư mục gốc của repository, sau khi cài `requirements.txt`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q evaluations\test_evaluators.py

.\.venv\Scripts\python.exe evaluations\run_evaluation.py --dry-run

.\.venv\Scripts\python.exe evaluations\run_evaluation.py --offline

.\.venv\Scripts\python.exe -m ruff check evaluations
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
.\.venv\Scripts\python.exe evaluations\run_evaluation.py --offline `
  --baseline evaluations\results\approved_baseline.json
```

Live path hiện có yêu cầu:

- staging-only synthetic Profile Run;
- workspace;
- bearer credential.

Không được trỏ nó vào production hoặc dữ liệu khách hàng thật:

```powershell
.\.venv\Scripts\python.exe evaluations\run_evaluation.py `
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

[`release_gates.json`](../evaluations/release_gates.json) chứa các threshold tạm thời thay vì giấu chúng trong code.

Các critical safety/schema failure luôn khiến gate thất bại độc lập với average score.

`--baseline` chỉ đánh giá các rate delta được cấu hình và trả về:

- `pass`;
- `regression`;
- `not_available`.

Nó chủ động không reject các thay đổi rất nhỏ trừ khi cấu hình gate yêu cầu điều đó.

## Các hạn chế đã biết

- Dataset hiện tại là synthetic và chưa phải production golden set được con người phê duyệt.

- Groundedness, intent, helpfulness và tone mới chỉ được bao phủ một phần thông qua deterministic marker check; chưa triển khai LLM-as-a-judge.

- Offline output là controlled fixture oracle, vì vậy scorecard thu được xác thực **hệ thống evaluation**, chứ không phản ánh chất lượng thực tế của một model.

- Telemetry của online runner chưa được materialize vào local scorecard.

- PostgreSQL trace có thể chứa:
  - latency;
  - exact provider token metadata;

  khi provider cung cấp các thông tin này.

- Không có tính toán chi phí vì pricing metadata trong repository sẽ nhanh chóng lỗi thời nếu không có owner chịu trách nhiệm.

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

- [ ] Review:
  - các câu hỏi business đại diện;
  - các câu trả lời mơ hồ;
  - limitation mong đợi;
  - safety outcome;
  - ChartPlan expectation.

**Tại sao:** synthetic fixture xác thực engineering contract nhưng không phải là bằng chứng cho thấy hệ thống hữu ích với analyst trong production.

**Làm gì và ở đâu:** thêm các case đã review vào:

```text
evaluations/fixtures/v1.json
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

### 2. Phê duyệt production release threshold

- [ ] Review và phê duyệt hoặc thay đổi mọi provisional threshold trong:

```text
evaluations/release_gates.json
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

**Sau khi hoàn tất:** commit gate file đã được phê duyệt và sử dụng nó trong CI/release review.

### 3. Chạy và phê duyệt online synthetic baseline

- [ ] Cung cấp:
  - staging-only synthetic workspace;
  - completed Profile Run;
  - authorized bearer token;

sau đó chạy live command đã được document.

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

- [ ] Chọn:
  - judge provider/model được phê duyệt;
  - rubric owner;
  - calibration set;
  - budget;
  - data-handling policy;

đồng thời chỉ định riêng một owner phụ trách model pricing.

**Tại sao:** semantic helpfulness/tone không thể được đánh giá đầy đủ bằng deterministic method, và giá model không được phép tự phỏng đoán.

**Sau khi hoàn tất:**

- thêm judge prompt/schema có version;
- thêm pricing metadata đã được test;
- sau đó mới mở rộng scorecard bằng usage do provider thực tế báo cáo.
