# Đề xuất cải tiến visualization và business logic từ Data Formulator

## 1. Mục tiêu và phạm vi

Tài liệu này đối chiếu VDaAgent với thư mục tham khảo `data-formulator/`, tập
trung vào hai chủ đề:

- trực quan hóa kết quả phân tích;
- business logic của quá trình khám phá, xác nhận và tái sử dụng insight.

`data-formulator/` không được xem là một phần của kiến trúc VDaAgent. Các ý bên
dưới chỉ nên được áp dụng sau khi điều chỉnh theo các invariant hiện có của
VDaAgent: workspace scope, không lộ raw row/PII, Preview khác Official, và chỉ
Official result mới là evidence có thể ghim vào báo cáo.

## 2. Kết luận ngắn

VDaAgent đã có nền tảng business logic tốt hơn cho một sản phẩm phân tích có
kiểm soát: `QuerySpec` có cấu trúc, compute deterministic, context version,
quality gate, `result_hash`, report draft và snapshot bất biến. Khoảng trống lớn
nhất hiện nay là lớp trình bày và tương tác:

- mọi kết quả Explorer gần như được vẽ thành cùng một bar chart CSS;
- query, visualization và narrative chưa có contract/version độc lập;
- người dùng chưa được gợi ý chart theo analytical intent và semantic type;
- chưa có cơ chế lưu một hướng khám phá, tạo biến thể hoặc quay lại một nhánh
  trước đó mà vẫn giữ provenance;
- Agent có thể giải thích một execution nhưng chưa tham gia vào một quy trình
  “đề xuất chart -> validate -> người dùng xác nhận”.

Hướng phù hợp không phải là đưa toàn bộ Data Formulator vào VDaAgent. Nên xây
một lớp `VisualizationSpec` nhỏ, deterministic và có whitelist trên chính
Official execution hiện tại; sau đó mới bổ sung recommendation, clarification
và branching ở mức insight.

## 3. Hiện trạng VDaAgent liên quan đến đề xuất

### Điểm mạnh nên giữ nguyên

- `QuerySpec` chỉ cho phép aggregate, dimension, filter, limit và sort; browser
  và Agent không gửi raw SQL.
- Engine kiểm tra cột hợp lệ, PII, semantic context và giới hạn kết quả trước
  khi chạy DuckDB.
- Preview dùng sample, được đánh dấu approximate và có limitations; promote
  kiểm tra context version trước khi tạo Official result.
- `query_executions` đã lưu `query_spec`, `result`, `result_hash`,
  `execution_kind`, quality gate và provenance.
- Report chỉ nhận Official execution cùng Profile Run, lưu bản sao result và
  `result_hash`, sau đó đóng băng thành snapshot.
- Agent answer chỉ được xem là verified khi có evidence đúng workspace và
  Profile Run.

### Khoảng trống hiện tại

- `ResultTable` trong Explorer giả định cột metric tên `value`, lấy dimension
  đầu tiên và luôn dựng horizontal bar; trường hợp không dimension cũng không
  có KPI view riêng.
- Frontend chưa có chart engine dependency và chưa có renderer abstraction.
- `AnalysisExecution` chưa có metadata về display name, unit, semantic visual
  type, chart recommendation hoặc visualization version.
- Report item loại `chart` hiện lưu result/query nhưng không lưu một chart spec
  có version. Vì vậy “cùng evidence, khác cách trình bày” chưa được mô hình hóa
  rõ.
- Query contract hiện chưa đủ dữ liệu cho histogram, box plot, scatter hai
  measure hoặc confidence interval. Không nên giả lập các chart này từ aggregate
  result đang có.

## 4. Những ý nên học từ Data Formulator

| Ý từ dự án tham khảo | Giá trị đối với VDaAgent | Cách áp dụng phù hợp |
| --- | --- | --- |
| Chart type và encoding là dữ liệu có cấu trúc | Có thể validate, version, cache và export nhất quán | Tạo `VisualizationSpec` whitelist thay vì JSX cố định hoặc Vega spec tự do |
| Chọn chart theo analytical intent và data shape | Tránh dùng bar chart cho mọi câu hỏi | Recommendation deterministic trước; Agent chỉ đề xuất trong tập hợp hợp lệ |
| Semantic type quyết định visual type và sort | Thời gian, ordinal, percentage và identifier được hiển thị đúng | Mở rộng semantic context hiện có bằng `visual_type`, `unit`, `display_name`, `ordinal_order` |
| Chart template có channel contract | Không thể gán nhầm field vào x/y/color | Mỗi chart type khai báo channel bắt buộc, kiểu field, cardinality và giới hạn row |
| Chart title/subtitle tách khỏi encoding | Style/narrative đổi mà không làm đổi evidence | Lưu presentation metadata trong visualization spec, không đưa vào `result_hash` |
| Insight bị invalid khi encoding/aggregate đổi | Tránh giữ lại diễn giải cũ cho chart mới | Tạo `spec_hash`/`insight_key` từ execution hash và semantic encoding |
| Clarification là trạng thái nghiệp vụ | Không để Agent tự đoán goal, time scope hoặc baseline | Dùng câu hỏi có cấu trúc, tối đa vài lựa chọn, rồi lưu quyết định cùng context |
| Thread/branch giữ lịch sử khám phá | Người dùng so sánh các hướng mà không mất provenance | Bắt đầu bằng Saved Insight có `parent_insight_id`; chưa cần sao chép toàn bộ Data Thread UI |
| Render cache và thumbnail | Có ích khi report/Explorer có nhiều chart | Thêm sau MVP, key theo `result_hash + spec_hash + theme_version` |
| Report tái sử dụng chart đã có | Không compute hoặc diễn giải lại khi xuất báo cáo | Snapshot lưu đúng spec và result đã xác nhận, renderer PDF dùng cùng contract |

Data Formulator dùng giấy phép MIT, nhưng nếu sao chép một phần mã thay vì chỉ
tham khảo thiết kế thì vẫn cần giữ copyright/license notice theo điều kiện của
giấy phép và rà soát dependency tương ứng.

## 5. Kiến trúc visualization đề xuất

### 5.1 Tách ba lớp identity

```text
QuerySpec
  -> AnalysisExecution (result_hash, Preview/Official, quality/provenance)
      -> VisualizationSpec (spec_hash, encoding, format, theme)
          -> Insight (title, interpretation, evidence bindings)
              -> Report Draft -> immutable Snapshot -> PDF
```

- `result_hash` trả lời: “số liệu này là gì?”. Nó chỉ đổi khi query/result hoặc
  nguồn evidence đổi.
- `spec_hash` trả lời: “số liệu này được trình bày thế nào?”. Đổi màu, chart type,
  channel hoặc format làm đổi hash này nhưng không làm thay đổi evidence.
- `insight_key` có thể là hash của `result_hash + semantic encoding + insight
  text version`. Khi metric/encoding thay đổi, narrative cũ phải được đánh dấu
  stale thay vì âm thầm tái sử dụng.

### 5.2 Contract `VisualizationSpec` tối thiểu

Ví dụ contract nội bộ; tên renderer chỉ là implementation detail và cần được
quyết định bằng một ADR/dependency spike:

```json
{
  "schema_version": 1,
  "chart_type": "bar",
  "data_binding": {
    "execution_id": "exe_...",
    "result_hash": "sha256..."
  },
  "encoding": {
    "x": { "field": "region", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative", "format": ",.2f" }
  },
  "sort": { "field": "value", "direction": "desc" },
  "presentation": {
    "title": "Doanh thu theo khu vực",
    "subtitle": null,
    "show_legend": false,
    "theme": "workspace-default"
  },
  "accessibility": {
    "description": "So sánh doanh thu giữa các khu vực",
    "table_fallback": true
  }
}
```

Contract phải dùng `extra = forbid`/Zod strict, chỉ chấp nhận field có trong
execution result, và không chứa inline JavaScript, expression, URL hoặc query.
Backend phải validate lại trước khi lưu/pin; validation ở frontend chỉ phục vụ
UX.

### 5.3 Bộ chart MVP

Không nên bắt đầu bằng hơn 30 chart type. Bộ nhỏ dưới đây bao phủ output hiện có
mà không cần raw rows:

| Data shape của Official/Preview result | Chart mặc định | Điều kiện |
| --- | --- | --- |
| Không dimension, một `value` | KPI card | Hiển thị aggregate và format/unit |
| Một categorical/ordinal dimension, một `value` | Bar hoặc lollipop | Giới hạn top N; table giữ toàn bộ bounded result |
| Một temporal dimension, một `value` | Line | Sort theo thời gian, không sort theo magnitude |
| Hai dimension cardinality thấp, một `value` | Grouped/stacked bar | Chỉ khi legend và số mark dưới ngưỡng |
| Hai dimension tạo ma trận nhỏ | Heatmap | Chỉ khi cả hai trục có cardinality thấp |
| Không thỏa rule hoặc quá nhiều category | Table | Fallback bắt buộc, không cố vẽ chart khó đọc |

Histogram, box plot, density, scatter, regression và range/uncertainty nên nằm
ở giai đoạn sau. Mỗi loại cần một query operation có contract bounded riêng
(ví dụ histogram bins, quantile summary, paired aggregate), không lấy raw rows
về frontend và không cho Agent chạy code tùy ý.

### 5.4 Recommendation deterministic

Recommendation nên là pure function nhận:

- query aggregate và dimensions;
- semantic type/time column đã review;
- result row count, cardinality và dấu của metric;
- unit/display metadata;
- mục đích phân tích có cấu trúc nếu người dùng đã cung cấp.

Output gồm `recommended`, `allowed_alternatives` và `reasons`. Ví dụ:

```json
{
  "recommended": "line",
  "allowed_alternatives": ["bar", "table"],
  "reasons": ["dimension_is_temporal", "single_measure"],
  "warnings": []
}
```

Agent có thể gọi hoặc dùng kết quả của hàm này để đề xuất chart, nhưng không
được tự mở rộng whitelist. Nếu đề xuất không hợp lệ, backend trả reason code ổn
định và UI fallback về table.

### 5.5 Visual guardrails

- Không encode cột PII/pending PII vào label, tooltip, legend hoặc title.
- Mọi chart luôn có data table tương ứng và dùng cùng result object.
- Category quá ngưỡng phải top-N có nhãn “Khác” nếu phép tổng hợp cho phép,
  hoặc chuyển sang table; không cắt im lặng.
- Temporal dùng chronological sort. Month/quarter/weekday dùng semantic order,
  không sort alphabetic.
- Trục quantitative có zero baseline cho bar; giá trị âm/dương dùng scale và
  màu phù hợp, không cắt baseline gây hiểu sai.
- Pie/donut chưa cần trong MVP; nếu bổ sung, chỉ dùng part-to-whole với ít
  category và tổng có ý nghĩa.
- Unit, percentage và currency format đến từ metadata đã review; không để LLM
  tự đoán.
- Màu phải đạt contrast, không chỉ dùng màu để truyền đạt trạng thái, hỗ trợ
  keyboard/focus và screen-reader description.
- Preview và Official có thể dùng cùng recommendation, nhưng Preview luôn giữ
  badge/limitation và không thể trở thành report evidence.

## 6. Business logic đề xuất

### 6.1 Dùng “Insight” làm đơn vị nghiệp vụ

Hiện tại report pin trực tiếp execution dưới tên item `chart`. Nên xem một
Insight là tổ hợp:

- một Official execution;
- một visualization spec đã validate;
- title và interpretation tùy chọn;
- evidence/quality/limitation hiện có;
- trạng thái `draft`, `verified`, `stale` hoặc `archived`.

Việc đổi theme hay format không làm insight mất verified. Việc đổi query,
context version hoặc binding field phải tạo version mới và làm narrative cũ
stale. Report chỉ pin version cụ thể, không tham chiếu “latest” động.

### 6.2 Clarification trước recommendation mơ hồ

Chỉ hỏi lại khi lựa chọn làm thay đổi ý nghĩa phân tích, ví dụ:

- “doanh thu theo thời gian” nhưng có nhiều time column;
- yêu cầu “tăng trưởng” nhưng chưa có baseline/period;
- có thể dùng tổng hoặc trung bình và hai lựa chọn trả lời câu hỏi khác nhau;
- category có quá nhiều giá trị và cần người dùng chọn top-N/grouping.

Clarification nên là event có schema và trạng thái `awaiting_user`, lưu câu hỏi,
lựa chọn, câu trả lời và context version. Không dùng một chuỗi chat tự do làm
nguồn sự thật duy nhất.

### 6.3 Saved Insight và branching nhẹ

Không nên phục hồi route `/notebooks` hoặc `/analyses` đã chủ động loại bỏ.
Thay vào đó, có thể thêm Saved Insight trong Explorer:

- “Tạo biến thể” sao chép QuerySpec/VisualizationSpec sang draft mới;
- `parent_insight_id` ghi lại nguồn của biến thể;
- branch chỉ được promote thành Official bằng quy trình Preview -> Promote hiện
  có;
- UI ban đầu chỉ cần danh sách/timeline gọn, chưa cần canvas đa cột phức tạp.

Cách này lấy được giá trị của Data Thread (không mất đường suy luận) mà không
đưa raw transformation graph hoặc multi-table execution vào sản phẩm.

### 6.4 Report và export

Trong MVP có thể lưu `visualization_spec` đã validate vào
`report_items.content_json` cùng result snapshot hiện tại. Khi nhu cầu chỉnh
sửa/version tăng, tách bảng `visualization_specs` và để report item tham chiếu
một version cụ thể.

Snapshot cần đóng băng tối thiểu:

- `query_spec`, `result`, `result_hash`;
- visualization spec và `spec_hash`;
- title/note/interpretation đã chọn;
- limitations, quality status, export policy và theme version.

Renderer trên web và renderer PDF phải dùng cùng normalized spec. Nếu PDF không
hỗ trợ một chart type, export phải fallback về table có nhãn rõ ràng thay vì
bỏ mất nội dung.

### 6.5 Cache và invalidation

Cache key đề xuất:

```text
result_hash + spec_hash + theme_version + renderer_version + viewport_class
```

Không dùng execution ID đơn lẻ làm cache key vì hai execution có thể cùng result
nhưng khác cách trình bày. Không dùng title làm evidence identity; title chỉ ảnh
hưởng `spec_hash`/render cache.

## 7. Phần không nên mang từ Data Formulator sang lúc này

- Agent chạy Python/pandas/DuckDB tùy ý trên raw dataset.
- Raw SQL, raw-row visualization hoặc tooltip chứa giá trị nhạy cảm.
- Multi-table join/cleaning và connector graph; các tính năng này vượt khỏi
  deliberate limits hiện tại.
- Toàn bộ Data Thread canvas, autosave workspace và state migration phức tạp
  trước khi Saved Insight đơn giản chứng minh được giá trị.
- Hơn 30 chart type ngay ở phiên bản đầu; chi phí validation, accessibility,
  PDF parity và test sẽ lớn hơn lợi ích.
- Cho LLM sinh Vega/Vega-Lite spec tự do hoặc code renderer.
- Cho phép ghim Preview, hoặc promote chỉ bằng cách đổi badge phía frontend.
- Copy trực tiếp component/state architecture của dự án tham khảo vào Next.js
  hiện tại; hai sản phẩm có trust boundary và data model khác nhau.

## 8. Lộ trình triển khai đề xuất

### Giai đoạn 0 — ADR và contract

1. Chọn renderer qua spike nhỏ: bundle size, SSR/React 19, accessibility,
   export PDF và CSP. Vega-Lite là ứng viên hợp lý vì spec declarative, nhưng
   không nên chốt chỉ vì Data Formulator đang dùng Flint/Vega.
2. Định nghĩa `VisualizationSpecV1`, whitelist chart/channel và validator dùng
   chung về mặt contract giữa Pydantic và Zod.
3. Định nghĩa rule recommendation cùng reason code ổn định.
4. Chốt cách lưu MVP trong `report_items.content_json` hay bảng riêng.

### Giai đoạn 1 — Visualization MVP, không cần LLM

1. Tách `ResultTable` thành `ResultView`, `ChartRenderer` và `DataTable`.
2. Hỗ trợ KPI, bar, line và table fallback.
3. Recommendation deterministic từ QuerySpec + semantic context + result.
4. Cho người dùng chuyển giữa các alternative hợp lệ; chart choice không chạy
   lại compute.
5. Khi pin Official result, lưu normalized spec cùng report item.
6. Dùng cùng spec cho report web và PDF, kèm fallback table.

### Giai đoạn 2 — Semantic UX và insight lifecycle

1. Bổ sung display name, unit, visual type và ordinal order vào context đã
   review.
2. Thêm title/subtitle, format và theme có kiểm soát.
3. Tạo `spec_hash`, invalidation test và cache render.
4. Đổi UI “chart pin” thành Saved Insight/report item có trạng thái rõ ràng.

### Giai đoạn 3 — Agent-assisted exploration

1. Cho Agent đề xuất analytical intent và một `VisualizationSpecV1` trong
   whitelist; deterministic validator là bên quyết định cuối.
2. Thêm clarification event cho time scope, measure, aggregate và baseline.
3. Thêm “Tạo biến thể” với `parent_insight_id` và timeline đơn giản.
4. Agent narrative bind vào `insight_key`; tự đánh dấu stale khi query/encoding
   đổi.

### Giai đoạn 4 — Query operation nâng cao

Chỉ thêm chart mới cùng một bounded compute contract tương ứng:

- `histogram` trả bins/count;
- `distribution_summary` trả quartiles/outlier counts đã redact;
- `paired_measure` trả aggregate pair để scatter ở grain an toàn;
- `time_series` hỗ trợ period/baseline và missing-period policy;
- `confidence_interval` trả lower/upper và phương pháp tính.

Mỗi operation phải có row/result/time budget, PII guard, quality gate,
provenance và test promote giống aggregate hiện tại.

## 9. Tiêu chí nghiệm thu quan trọng

- Một Official execution có thể đổi giữa các chart alternative mà không đổi
  `result_hash` hoặc chạy lại compute.
- Chart/spec không thể tham chiếu field ngoài result hay field PII.
- Time dimension luôn sort chronological; categorical ranking sort theo metric;
  ordinal dùng thứ tự semantic.
- Zero-dimension aggregate hiển thị KPI, không phải một bar vô nghĩa.
- Quá nhiều category tự fallback/table hoặc hiển thị cảnh báo rõ; không cắt dữ
  liệu im lặng.
- Preview luôn hiển thị approximate/limitations và không pin được.
- Report snapshot giữ nguyên chart khi draft, theme mặc định hoặc source thay
  đổi về sau.
- Web, PDF và accessible table thể hiện cùng số liệu đã hash.
- Narrative cũ bị stale khi aggregate/channel/result binding thay đổi.
- Backend từ chối spec/version/hash không khớp dù frontend đã validate.

## 10. Test nên bổ sung

### Unit

- recommendation matrix theo data shape và semantic type;
- validator chart/channel/cardinality/PII;
- canonicalization và `spec_hash` ổn định;
- chronological/ordinal sort, unit/percentage formatting;
- `insight_key` đổi khi aggregate/encoding đổi, không đổi khi chỉ reorder JSON
  key.

### Integration

- Preview -> chọn chart -> Promote -> pin Official -> snapshot;
- stale context không tạo visualization/report item mới;
- report item không nhận spec bind sang execution/Profile Run khác;
- snapshot giữ spec/version cũ sau khi draft được chỉnh sửa;
- PDF fallback table cho chart chưa được renderer hỗ trợ.

### E2E và accessibility

- keyboard chọn alternative, mở data table và đọc limitation;
- screen reader nhận title/description và trạng thái Preview/Official;
- responsive layout với label dài, giá trị âm, null và locale tiếng Việt;
- chart và table có số liệu khớp nhau.

## 11. Các file đã dùng để đối chiếu

### VDaAgent

- `README.md`, `docs/summary.md`, `ARCHITECTURE.md`: product flow, invariant và
  deliberate limits.
- `frontend/src/components/command-center/explorer-tab.tsx`: query builder và
  bar renderer hiện tại.
- `frontend/src/lib/analysis-types.ts`: contract QuerySpec/AnalysisExecution.
- `backend/src/models/analysis_schemas.py`: whitelist aggregate/filter và giới
  hạn query.
- `backend/src/services/analysis_engine.py`: bounded deterministic compute,
  sampling, PII guard và result hash.
- `backend/src/services/report_draft_repository.py`: điều kiện pin Official
  evidence và snapshot data.
- `backend/src/services/repository.py`: schema execution/report/provenance.

### Thư mục tham khảo Data Formulator

- `data-formulator/README.md`: Data Thread, chart refinement và report workflow.
- `data-formulator/src/app/chartRecommendation.ts`: mapping recommendation vào
  chart type/encoding có cấu trúc.
- `data-formulator/src/components/ChartTemplates.tsx`: template/channel catalog.
- `data-formulator/src/views/ChartRenderService.tsx`: render/cache tách khỏi UI
  thread.
- `data-formulator/py-src/data_formulator/workflows/chart_semantics.py`: semantic
  visual type, temporal conversion và ordinal order.
- `data-formulator/py-src/data_formulator/analyst/skills/core/SKILL.md`: quy tắc
  chọn chart theo intent/data shape và metadata hiển thị.
- `data-formulator/src/app/clarification.ts`: clarification có cấu trúc.
- `data-formulator/src/dataOperations/models.ts`: operation state, plan hash và
  schema version.
- `data-formulator/src/views/DataThread.tsx`: provenance/branching của các hướng
  khám phá.
- `data-formulator/tests/frontend/unit/app/chartInsightContract.test.ts`: ý
  tưởng invalidation insight khi encoding/aggregate đổi.

