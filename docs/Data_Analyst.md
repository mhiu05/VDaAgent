# Xây dựng Data Analyst Agent cho P-170

## 1. Định hướng tổng thể

P-170 hiện tại chủ yếu là một **Data Profiling Agent**: kiểm tra cấu trúc, chất lượng, PII, thống kê cơ bản và trả lời Q&A.

Để trở thành **Data Analyst Agent**, hệ thống cần hỗ trợ Analyst đi từ:

```text
Mục tiêu kinh doanh
    → Hiểu dữ liệu
    → Kiểm tra chất lượng
    → Lập kế hoạch phân tích
    → Tính toán có bằng chứng
    → Kiểm tra kết quả
    → Kết luận và đề xuất hành động
```

Nguyên tắc quan trọng nhất:

> Tính toán phải deterministic và có thể kiểm tra; LLM chỉ lập kế hoạch, đặt giả thuyết, giải thích và viết narrative dựa trên evidence.

---

## 2. Quy trình thực tế của Data Analyst

Quy trình có thể dựa trên CRISP-DM. Đây không phải quy trình tuyến tính cứng; Analyst thường quay lại các bước trước khi phát hiện dữ liệu chưa đủ hoặc giả định sai. CRISP-DM gồm business understanding, data understanding, data preparation, modeling, evaluation và deployment.

Tham khảo: [IBM CRISP-DM](https://www.ibm.com/docs/en/spss-modeler/saas?topic=dm-crisp-help-overview)

### 2.1. Hiểu câu hỏi kinh doanh

DA cần biết:

- Vấn đề cần giải quyết là gì?
- Ai sẽ dùng kết quả?
- Quyết định nào sẽ được đưa ra?
- Metric chính là gì?
- Phạm vi thời gian và đối tượng nào?
- So sánh với baseline nào?
- Kết quả cần là report, dashboard, bảng số liệu hay recommendation?

Ví dụ “Doanh thu tháng này giảm, nguyên nhân là gì?” cần làm rõ:

- Doanh thu là gross revenue hay net revenue?
- Có trừ refund và cancellation không?
- Tháng hiện tại đã đủ dữ liệu chưa?
- So với tháng trước hay cùng kỳ năm trước?
- Sụt giảm nằm ở sản phẩm, khu vực, channel hay customer segment nào?
- Có thay đổi cách ghi nhận dữ liệu không?

P-170 cần bổ sung phần này dưới dạng `analysis_intent` hoặc `analysis_session`.

### 2.2. Hiểu dữ liệu

DA cần xác định:

- Dataset đại diện cho cái gì?
- Một dòng là một giao dịch, người dùng, sự kiện hay snapshot?
- Grain của dữ liệu là gì?
- Cột nào là dimension và cột nào là measure?
- Cột thời gian nào dùng cho phân tích?
- Các bảng liên kết bằng khóa nào?
- Dữ liệu được thu thập qua quy trình nào?

Nếu không biết một dòng đại diện cho gì, các phép `SUM`, `COUNT` và `AVG` đều có thể sai.

Data context nên có dạng:

```text
Dataset: orders
Grain: một dòng = một order item
Primary key candidate: order_item_id
Time column: order_created_at
Measures: quantity, gross_amount, discount, net_amount
Dimensions: product, region, channel, customer_type
Potential issue: một order có thể xuất hiện nhiều dòng
```

### 2.3. Chất lượng dữ liệu

Sáu chiều thường dùng:

- Completeness — đầy đủ
- Uniqueness — không trùng lặp
- Consistency — nhất quán
- Timeliness — kịp thời/cập nhật
- Validity — hợp lệ về kiểu, format và range
- Accuracy — chính xác so với thực tế

Tham khảo [GOV.UK Data Quality Framework](https://www.gov.uk/government/publications/the-government-data-quality-framework/the-government-data-quality-framework) và [IBM Data Quality Dimensions](https://www.ibm.com/think/topics/data-quality-dimensions).

Không có ngưỡng “tốt” áp dụng cho mọi dataset. Ngưỡng phụ thuộc vào mục đích sử dụng và mức độ quan trọng của từng cột.

```text
Completeness ≠ Accuracy
```

Một cột có 100% giá trị nhưng tất cả đều sai thì vẫn không chính xác. Accuracy không thể suy ra chắc chắn chỉ từ một file; cần nguồn đối chiếu hoặc reference data.

### 2.4. Chuẩn bị dữ liệu và EDA

DA có thể cần chuẩn hóa category, parse ngày giờ, xử lý missing, deduplicate, filter, join, tạo derived columns và aggregate.

EDA gồm hai hướng:

- **Deductive**: bắt đầu từ câu hỏi hoặc giả thuyết rồi truy vấn dữ liệu.
- **Inductive**: tìm pattern bất ngờ từ summary statistics, distribution và segmentation.

DA cần kết hợp cả hai. Chỉ hỏi đúng câu hỏi ban đầu có thể bỏ sót pattern quan trọng; chỉ khám phá tự do thì report dễ lan man.

### 2.5. Truyền đạt kết quả

Report nên có:

1. Executive summary
2. Business question
3. Data scope và định nghĩa metric
4. Data quality warnings
5. Methodology
6. Key findings
7. Charts/tables
8. Limitations
9. Recommended next actions
10. Appendix chứa query và evidence

---

## 3. Metrics cần có

### 3.1. Dataset-level

- Row count, column count, file size
- Scan mode: sample/full và sampling ratio
- Data coverage, earliest/latest timestamp
- Duplicate row count/rate
- Empty rows, fully-null columns
- Constant và near-constant columns
- Type inference confidence
- Encoding/parse errors
- PII columns và candidate keys
- Quality summary theo từng dimension

Không nên chỉ tạo một quality score duy nhất. Nên phân loại:

```text
Critical: không thể phân tích an toàn nếu chưa xử lý
Warning: cần kiểm tra trước khi dùng
Info: bất thường nhưng chưa chắc là lỗi
```

### 3.2. Numeric columns

- Count, missing count/rate, distinct count
- Min/max, mean, median
- Standard deviation, variance
- Quantiles: p01, p05, p25, p50, p75, p95, p99
- IQR, skewness, kurtosis
- Zero rate, negative rate
- Outlier count/rate
- Confidence interval khi dùng sample

Histogram giúp quan sát center, spread, skewness, outlier và nhiều mode. Tham khảo [NIST Histogram](https://www.itl.nist.gov/div898/handbook/eda/section3/eda33d8.htm).

Outlier không được tự động xóa:

```text
IQR outlier:
x < Q1 - 1.5 × IQR
hoặc
x > Q3 + 1.5 × IQR

Robust z-score:
(x - median) / MAD
```

NIST khuyến nghị điều tra outlier trước khi loại bỏ vì chúng có thể là lỗi hoặc tín hiệu quan trọng. Tham khảo [NIST Outliers](https://www.itl.nist.gov/div898/handbook/prc/section1/prc16.htm).

### 3.3. Categorical columns

- Distinct count và cardinality ratio
- Top-k values, frequency và percentage
- Unknown/other rate
- Rare category rate
- Empty string rate
- Category entropy
- Top-1 concentration
- Category drift giữa các run
- Category mapping gần giống nhau, ví dụ `Hanoi`, `Ha Noi`, `HN`

Top-k của cột PII phải được mask hoặc không lưu.

### 3.4. Datetime columns

- Min/max timestamp
- Số ngày có dữ liệu
- Missing timestamp rate
- Frequency thực tế: daily/weekly/monthly
- Missing periods/gaps
- Duplicate timestamps
- Future dates
- Weekend/weekday và hour-of-day distribution
- Freshness
- Partial-period flag
- Timezone consistency

Agent cần cảnh báo khi tháng hiện tại mới có một phần dữ liệu hoặc timestamp UTC bị đọc thành giờ địa phương.

### 3.5. Text columns

- Empty rate
- Character length: min/median/p95/max
- Word count
- Pattern detection
- Email/phone/ID pattern
- Duplicate text rate
- Normalization issues
- PII risk
- Text category candidates

### 3.6. Relationship metrics

- Pearson, Spearman và Kendall correlation
- Mutual information
- Cross-tabulation
- Conditional missingness
- Segment comparison
- Numeric by category
- Category by time
- Duplicate keys
- Referential integrity
- Arithmetic invariants

Ví dụ:

```text
net_amount = gross_amount - discount
end_time >= start_time
quantity >= 0
country_code phải tồn tại trong reference table
```

Correlation chỉ mô tả mối quan hệ, không chứng minh quan hệ nhân quả.

### 3.7. Data quality formulas

```text
Completeness = non-null values / expected values
Duplicate rate = duplicate rows / total rows
Validity = valid values / evaluated values
Consistency = rows passing business rules / evaluated rows
Timeliness = current time - latest expected data timestamp
Accuracy = values matching trusted reference / checked values
```

Accuracy cần nguồn tin cậy để đối chiếu; không nên giả định rằng profile đơn lẻ có thể đo được accuracy.

---

## 4. Metrics phân tích cho DA

### 4.1. Aggregation và comparison

Các phép cơ bản:

- Count, distinct count, sum, mean, median
- Min/max, quantiles, standard deviation
- Missing rate
- Share of total
- Contribution percentage
- Weighted average
- Absolute difference
- Relative difference
- Percentage change
- Ratio, lift, share change, rank change

Cần cảnh báo khi denominator gần bằng 0. Tăng từ 1 lên 10 là 900% nhưng giá trị tuyệt đối vẫn nhỏ.

### 4.2. Time-series

- MoM, WoW, YoY
- Rolling average
- Trend slope
- Growth rate
- Seasonality
- Period-over-period change
- Change-point candidates
- Missing periods
- Partial-period normalization

### 4.3. Statistical tests

| Câu hỏi | Test thường dùng |
| --- | --- |
| Hai nhóm numeric độc lập | Welch t-test hoặc Mann–Whitney U |
| Hai nhóm numeric paired | Paired t-test hoặc Wilcoxon |
| Nhiều nhóm numeric | ANOVA/Welch ANOVA hoặc Kruskal–Wallis |
| Hai categorical | Chi-square hoặc Fisher exact |
| Hai tỷ lệ | Two-proportion test |
| Numeric với numeric | Pearson/Spearman |
| Hai phân phối | KS test, Wasserstein |
| Trước và sau thay đổi | Paired analysis hoặc interrupted time series |

SciPy mô tả Mann–Whitney U là test phi tham số cho hai mẫu độc lập; chi-square dùng để kiểm tra tính độc lập giữa các biến categorical. Tham khảo [Mann–Whitney U](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.mannwhitneyu.html) và [Chi-square](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.contingency.chi2_contingency.html).

Mỗi test nên trả về:

- Hypothesis
- Test name
- Sample size
- Statistic
- p-value và adjusted p-value
- Effect size
- Confidence interval
- Assumptions
- Missing-data handling
- Interpretation
- Limitations

Không nên chỉ trả `p-value = 0.03 → có tác động`. Cần trả cả effect size, confidence interval, sample size và cảnh báo rằng association không chứng minh causal effect.

Khi chạy nhiều test, cần correction cho multiple testing, ví dụ Benjamini–Hochberg FDR. Tham khảo [Statsmodels Multiple Testing](https://www.statsmodels.org/stable/generated/statsmodels.stats.multitest.multipletests.html).

### 4.4. Drift

Numeric drift:

- KS statistic/p-value
- Wasserstein distance
- PSI
- Quantile shift
- Mean/median shift
- Variance shift
- Missingness shift
- Outlier-rate shift

Categorical drift:

- Chi-square
- Jensen–Shannon divergence
- PSI
- Category appearance/disappearance
- Top-category share change

Tham khảo [Evidently Data Drift](https://docs.evidentlyai.com/metrics/explainer_drift).

Drift report cần trả lời: cột nào thay đổi, thay đổi bao nhiêu, thay đổi ở thời điểm nào, có ảnh hưởng metric chính không, đây là drift hay seasonal pattern và có cần điều tra pipeline không.

---

## 5. Workflow agent đề xuất

```text
User question
    ↓
Clarify business goal and metric definitions
    ↓
Build data context and semantic model
    ↓
Profile + data quality assessment
    ↓
Generate analysis plan
    ↓
Planner proposes questions
    ↓
Executor runs safe deterministic tools
    ↓
Summarize result + uncertainty
    ↓
Consistency check
    ↓
Insight bank
    ↓
Analyst review
    ↓
Report / chart / recommendation
    ↓
Save analysis and monitor later
```

### 5.1. Intake node

Agent hỏi mục tiêu, định nghĩa metric, phạm vi thời gian, population/segment, baseline và output mong muốn.

Nên có hai chế độ:

```text
Quick Answer:
- dùng profile/metrics đã có;
- ít tool calls;
- trả lời nhanh.

Deep Analysis:
- lập kế hoạch;
- chạy nhiều vòng;
- tìm insight;
- tạo report có evidence.
```

### 5.2. Semantic context node

Tạo metadata gồm dataset description, row grain, column roles, dimensions/measures, time columns, candidate keys, joins, business definitions và known limitations.

Analyst phải chỉnh sửa được metric quan trọng:

```text
net_revenue = gross_revenue - discount - refund
```

LLM không nên tự quyết định định nghĩa metric có ảnh hưởng tới business conclusion.

### 5.3. Quality gate

Trước khi phân tích, kiểm tra missingness, time range, partial period, duplicate, join multiplication và representativeness. Nếu lỗi nghiêm trọng, Agent phải dừng và nói rõ lý do thay vì cố kết luận.

### 5.4. Planner–Executor

Planner tạo kế hoạch cấp cao, Executor thực hiện phép tính deterministic. Ví dụ:

```text
Question: Tại sao doanh thu tháng 8 giảm?

Plan:
1. Kiểm tra coverage tháng 8.
2. So sánh với tháng 7 và cùng kỳ.
3. Phân rã theo region, product, channel.
4. Kiểm tra số order và average order value.
5. Kiểm tra refund/cancellation.
6. Kiểm tra thay đổi phân bố khách hàng.
```

DataSTORM là tham khảo quan trọng: tách Planner và Executor, thêm query consistency module, summary statistics, insight bank và thesis-driven exploration. Tham khảo [DataSTORM](https://arxiv.org/abs/2604.06474) và [PDF trong project](/E:/VDuAgents/P-170/documents/DataSTORM.pdf).

Các tool nên có:

```text
get_data_context()
get_quality_summary()
aggregate()
compare_periods()
segment_analysis()
trend_analysis()
distribution_summary()
correlation()
run_statistical_test()
compute_drift()
register_insight()
render_chart()
```

Executor phải chỉ dùng allowlisted tools, query read-only, giới hạn output, không trả raw PII, lưu query/filter/time/sample/result và có timeout.

### 5.5. Insight bank

Mỗi insight nên lưu:

```json
{
  "claim": "Doanh thu khu vực North giảm 18% MoM",
  "metric": "net_revenue",
  "value": -0.18,
  "baseline": "previous_month",
  "filters": {"region": "North"},
  "time_window": ["2026-07", "2026-08"],
  "evidence_query_id": "query-123",
  "sample_size": 18342,
  "uncertainty": {},
  "limitations": ["August is partial period"],
  "status": "needs_review"
}
```

LLM chỉ viết narrative dựa trên insight bank, không tự phát sinh con số trong bước viết report.

### 5.6. Query consistency check

Agent phải phát hiện:

- `COUNT(*)` và `COUNT(DISTINCT order_id)` bị trộn
- Gross revenue và net revenue bị trộn
- Filter completed orders không nhất quán
- Timezone khác nhau
- Join làm nhân bản records
- Baseline giữa các đoạn không giống nhau

### 5.7. Report generation

Nên chia thành outline, gán evidence, viết section, kiểm tra claim không có evidence, kiểm tra số liệu với query và xuất report/chart.

---

## 6. Chức năng nên có trong P-170

### Ưu tiên cao

- Business question intake
- Metric glossary
- Dataset grain detection
- Multi-table schema và join preview
- Quality gate
- Group-by/pivot analysis
- Period comparison
- Trend analysis
- Segment decomposition
- Safe chart generation
- Insight bank
- Evidence-linked answers
- Query consistency checker
- Cleaning suggestion nhưng không sửa raw data
- Reusable analysis session

### Ưu tiên trung bình

- Data cleaning recipe có preview và rollback
- Reference data validation
- Statistical test recommendation
- Confidence interval và effect size
- Cohort, funnel và retention analysis
- Contribution decomposition
- Automatic anomaly investigation
- Scheduled drift monitoring
- Export SQL/notebook/report

### Ưu tiên sau

- Database connectors
- Business knowledge base
- Shared metric layer
- External web research
- Causal analysis
- Experiment/A-B test analysis
- Automated alerting
- Team collaboration và approval workflow

External web research nên là chế độ tùy chọn. Với câu hỏi nội bộ như “doanh thu giảm vì sao”, dữ liệu nội bộ phải là evidence chính; web chỉ dùng khi cần bối cảnh bên ngoài.

---

## 7. Gaps hiện tại của P-170

P-170 đã có profiling deterministic, PII detection, candidate key, proposal review, statistical test, drift, read-only QA tools, audit và masking.

Các lớp còn thiếu:

### 7.1. Business understanding

Thêm `analysis_session` hoặc `analysis_intent`:

```text
goal
decision
metric_definitions
time_scope
population
baseline
output_format
```

### 7.2. Data preparation

DataSTORM giả định input đã được làm sạch và xem data cleaning là ngoài scope. P-170 nên hỗ trợ cleaning recipe có preview, lý do, version và rollback.

### 7.3. Hypothesis-driven exploration

Thêm planner/executor loop và insight bank. RAG từ report cũ không đủ để tự tạo phân tích mới.

### 7.4. Visualization

Nên hỗ trợ histogram, box plot, time-series line, bar chart, stacked bar, scatter plot, heatmap và cohort/funnel chart. LLM chọn chart và giải thích; compute engine tạo dữ liệu chart.

---

## 8. Đánh giá chất lượng DA Agent

Nên xây benchmark nội bộ gồm dataset và câu hỏi có đáp án kiểm chứng được.

Các metric đánh giá Agent:

- Numeric accuracy
- Filter correctness
- Join correctness
- SQL correctness
- Grounded claim rate
- Unsupported claim rate
- Insight recall và precision
- Summary quality
- Evidence coverage
- Reproducibility
- Tool failure rate
- Latency
- Token/cost
- Human acceptance rate

DataSTORM đánh giá riêng insight-level recall, summary-level score và mức độ sử dụng database; đây là cách phù hợp hơn so với chỉ đánh giá câu trả lời có vẻ tự nhiên.

---

## 9. Roadmap đề xuất

### Phase 1 — DA Copilot cơ bản

- Business question
- Data context
- Quality gate
- Aggregation
- Comparison
- Trend
- Segmentation
- Chart
- Evidence-linked answer

### Phase 2 — Deep Analysis

- Planner/executor
- Hypothesis loop
- Insight bank
- Consistency checker
- Statistical tests
- Confidence intervals
- Effect sizes
- Report pipeline

### Phase 3 — Data Preparation và Monitoring

- Reversible cleaning recipes
- Multi-table joins
- Reference validation
- Scheduled profiling
- Drift alerts
- Dataset version comparison

### Phase 4 — Research-grade Agent

- Business knowledge base
- External web research
- Cross-source verification
- Thesis-driven report
- Experiment/causal analysis
- Team review và collaboration

## 10. Nguyên tắc thiết kế

1. Không để LLM là nguồn sự thật cho con số.
2. Mọi kết luận phải truy ngược được về query, filter, thời gian và dataset version.
3. Không tự động xóa outlier hoặc sửa dữ liệu gốc.
4. Metric business quan trọng phải có định nghĩa và Analyst approval.
5. Phân biệt rõ association và causation.
6. Hiển thị uncertainty, sample size và limitations.
7. Simple question dùng quick mode; deep analysis chỉ chạy khi cần.
8. Ưu tiên evidence nội bộ; external research là nguồn bổ sung.
9. Mọi tool của Agent phải read-only, bounded và audit được.
10. Report phải được fact-check trước khi hiển thị như kết luận cuối.

