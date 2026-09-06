# Báo cáo Benchmark VDaAgent — Bộ đánh giá chất lượng Production chạy trên Local

- Run ID: `run-20260904T204800-full-c1-v8`
- Ngôn ngữ: **Tiếng Việt (vi-VN)**
- Môi trường: **LOCAL**
- Azure Production Execution: **Không**
- Production Deployment Evidence: **Không**

## 1. Tóm tắt điều hành

Đã thực thi 83/83 case với 123 request từ raw vi-VN của run này. VTC là **89.2%** (74/83); kết luận local: **DRAFT_NOT_APPROVED** theo ngưỡng 80%.

## 2. Môi trường đánh giá

- Frontend local: 200
- Backend health: 200
- Xác thực/workspace: PASS / PASS

## 3. Phạm vi benchmark

Bao phủ profiling, chất lượng dữ liệu, numeric aggregation, drift, evidence, clarification, abstention, tool, recovery và an toàn. Không sửa hành vi sản phẩm để tăng điểm.

## 4. Phương pháp

Dữ liệu, ground truth và 83 case giữ nguyên. Tái chấm chỉ dùng normalized/raw result thuộc run hiện hành; không rerun 83 case.

## 5. Dữ liệu tổng hợp

Datasets: profiling_base, profiling_edge_cases, profiling_pii, drift_v1, drift_v2. Toàn bộ là dữ liệu tổng hợp ngữ cảnh Việt Nam.

## 6. Ground truth độc lập

Ground truth được tính bằng thư viện xác định từ CSV, không dùng LLM để tính số liệu.

## 7. Cấu trúc case

Đúng 83 case, tất cả câu hỏi/đáp án kỳ vọng dùng vi-VN.

## 8. Tính toàn vẹn raw run

Raw/normalized result chỉ chứa case P170-VI, `language=vi-VN`, `environment=local`; raw tiếng Anh cũ không được dùng để chấm.

## 9. Scorecard tổng quan

| Chỉ số | Kết quả |
| --- | ---: |
| VTC | 89.2% |
| Numeric Accuracy gốc / tái chấm | 91.8% / 91.8% |
| Evidence Binding | 98.9% |
| PII Leakage | 0.0% |
| P95 local | 20907.549 ms |
| Shared release gates | FALSE |

## 10. Độ tin cậy grader

Audit deterministic: **PARTIAL_INSUFFICIENT_OBSERVED_CASES**, agreement 100.0%; mẫu {'edge_safety_tool': 5, 'fail': 9, 'pass': 10, 'unique_audited': 23}.

## 11. Tỷ lệ hoàn thành tác vụ có xác minh

VTC = 74/83 = **89.2%**. Case chỉ đạt khi deterministic, evidence và safety cùng đạt ở lần thử đầu.

## 12. Audit độ chính xác số liệu

Original Numeric Accuracy: **91.8%**; Corrected Numeric Accuracy: **91.8%**.
| Chỉ số numeric | Kết quả |
| --- | ---: |
| Numeric Task Success Rate | 91.8% (45/49) |
| Numeric Answer Accuracy Given Successful Execution | 93.8% |
| Numeric Extraction Coverage | 98.0% |
| Numeric Exact / Tolerance Match Rate | 89.8% / 91.8% |
| Numeric-Evidence Consistency | 100.0% (45/45) |

| Nguyên nhân | Số request |
| --- | ---: |
| Agent thực sự trả sai số | 3 |
| Parser/format lỗi | 0 |
| Percentage/unit normalization | 0 / 0 |
| Không có số trong answer | 0 |
| SSE execution | 1 |
| Wrong binding | 0 |

## 13. Vietnamese Numeric Normalizer

Grader có normalizer đã kiểm thử cho dấu phân cách Việt Nam/quốc tế, phần trăm, đồng/VNĐ, nghìn, triệu, tỷ; giữ ambiguity thay vì normalize mù quáng. Tái chấm không thay đổi 13,3%, cho thấy run này không có parser/format false-negative.

## 14. Deterministic profiling

Task completion rate: 86.2%. Ground truth số dùng policy riêng cho count, percentage, correlation, currency/amount và aggregate.

## 15. Evidence và provenance

Evidence Binding Accuracy: **98.9%**. Unsupported Quantitative Claim Rate: **KHÔNG ĐÁNH GIÁ** vì chưa có claim-level verifier độc lập.

## 16. Abstention và clarification

Correct Abstention: **100.0%**; Clarification Accuracy: **66.7%**.

## 17. Đánh giá RAG và Groundedness

- Answer Relevancy: **EVALUATED**; điểm 45.3%. Lý do: Đo semantic alignment trực tiếp giữa question và answer; không cần retrieved context.
- Evidence Source Coverage: **EVALUATED**; điểm 87.9%. Lý do: Tỷ lệ response bắt buộc evidence có nguồn công khai và evidence_status=verified; case abstain/clarify/guardrail không nằm trong mẫu số.
- Faithfulness: **NOT_EVALUATED**; điểm KHÔNG ĐÁNH GIÁ. Lý do: Trace đã map chính xác theo agent_run_id nhưng không công bố retrieved chunks/context content; không thể chấm claim-to-context fidelity hoặc relevance của chunk.
- Context Recall: **NOT_EVALUATED**; điểm KHÔNG ĐÁNH GIÁ. Lý do: Trace đã map chính xác theo agent_run_id nhưng không công bố retrieved chunks/context content; không thể chấm claim-to-context fidelity hoặc relevance của chunk.
- Context Precision: **NOT_EVALUATED**; điểm KHÔNG ĐÁNH GIÁ. Lý do: Trace đã map chính xác theo agent_run_id nhưng không công bố retrieved chunks/context content; không thể chấm claim-to-context fidelity hoặc relevance của chunk.
- Evidence-Grounded Faithfulness: **NOT_EVALUATED**; điểm KHÔNG ĐÁNH GIÁ. Lý do: answer_sources chỉ có tool metadata, không có nội dung evidence đã dùng để tạo claim; không coi metadata là grounding context.

## 18. Đánh giá bằng LLM-as-Judge

Gemini Judge: **FAILED**; model `None`; configured=true; temperature 0; model-list calls 1; judge calls 0; judge cases 0.
Model catalog: **FAILED**; 0 model generate metadata. Selection: Discover generateContent models; prefer stable Pro, then stable Flash, then highest version.. Models: Không lấy được danh sách model.
Lý do: GEMINI_AUTH_FAILED. Rubric gồm correctness, relevance, completeness, coherence, conciseness và limitation quality; Judge không xem deterministic verdict và không override numeric result.
Calibration: NOT_EVALUATED; agreement KHÔNG ĐÁNH GIÁ.

## 19. Agentic / Tool Evaluation

Tool observability request-level: **92.8%** (77/83). Case-level observable: 59/65. Tool success khi đã quan sát: **100.0%**. Khả năng quan sát tên tham số: **18.2%**; chỉ thấy tên, không thấy giá trị. Tool Selection Accuracy: **100.0%** (77/77); parameter accuracy: **97.8%** (45 eligible).

## 20. Routing / Trajectory

Trace mapping: **EXACT_AGENT_RUN_ID_MAPPING**. Route observability: **99.2%** (122/123). Routing Accuracy: **86.1%** (122 eligible); trajectory efficiency: **KHÔNG ĐÁNH GIÁ**.

## 21. Safety / Privacy

PII Leakage: 0.0%; refusal: 100.0%; jailbreak success: 0.0%; prompt injection success: 0.0%. Over-refusal: 0.0%; safe-request completion: 100.0%.

## 22. Hiệu năng local

LOCAL PERFORMANCE: P50 11937.439 ms; P95 20907.549 ms; mean TTFT 11394.66 ms; error rate 0.8%. Không suy diễn trực tiếp sang Azure.

## 23. Audit SSE

Có 1 SSE failure: {'PRODUCT_SSE_ERROR': 1}. Phân loại dựa trên lỗi công khai quan sát được, không suy diễn root cause model/tool khi trace không công bố error detail.

## 24. Repeated runs

Chính sách: Các case khó hoặc đối kháng chạy ba lần; case xác định chạy một lần.. Request lặp thêm: 40.

## 25. Độ tin cậy thống kê

VTC CI 95%: {'ci95': [0.824674, 0.958459], 'mean': 0.891566, 'n': 83, 'std': 0.310927}.

## 26. Kết quả theo capability

- An toàn, riêng tư và prompt tấn công: 4/4 đạt (100.0%)
- Bản ghi trùng lặp: 2/2 đạt (100.0%)
- Bằng chứng và provenance: 3/3 đạt (100.0%)
- Cardinality và tính duy nhất: 4/4 đạt (100.0%)
- Chất lượng dữ liệu: 1/5 đạt (20.0%)
- Câu hỏi mơ hồ cần làm rõ: 2/3 đạt (66.7%)
- Dữ liệu thiếu: 5/5 đạt (100.0%)
- Giá trị bất thường: 2/2 đạt (100.0%)
- Khóa định danh tiềm năng: 4/4 đạt (100.0%)
- Khôi phục và xử lý lỗi: 1/1 đạt (100.0%)
- Ngoài phạm vi: 1/1 đạt (100.0%)
- Ngữ cảnh nhiều lượt: 1/2 đạt (50.0%)
- PII và kiểu ngữ nghĩa: 12/12 đạt (100.0%)
- Phân tích và insight: 3/3 đạt (100.0%)
- So sánh và drift dữ liệu: 4/7 đạt (57.1%)
- Sử dụng công cụ: 2/2 đạt (100.0%)
- Thiếu bằng chứng / cần abstention: 3/3 đạt (100.0%)
- Tương quan: 4/4 đạt (100.0%)
- Tổng hợp số liệu: 9/9 đạt (100.0%)
- Tổng quan profiling: 4/4 đạt (100.0%)
- Yêu cầu biểu đồ: 3/3 đạt (100.0%)

## 27. Kết quả theo độ khó

- Dễ: 18/18 đạt (100.0%)
- Khó: 16/21 đạt (76.2%)
- Trung bình: 40/44 đạt (90.9%)

## 28. Failure Analysis

Có 17 failure attempt trong artifact; SSE được tách khỏi wrong numeric answer trong numeric audit.

## 29. Các nhóm lỗi chính

- Câu trả lời sai: 16
- Lỗi thực thi SSE: 1

## 30. Phân tích nguyên nhân gốc

- Câu trả lời sai: Kết quả không khớp ground truth xác định hoặc không hoàn thành yêu cầu.
- Lỗi thực thi SSE: Luồng QA công khai phát sự kiện lỗi dù HTTP đã mở thành công.

## 31. Năm cụm cải tiến quan trọng

- Khắc phục lỗi SSE: Run hiện tại có 1 SSE failure, error rate 0.8% và VTC 89.2%.
- Khắc phục đường số liệu: Numeric Accuracy của run hiện tại là 91.8% trên mẫu số công khai.
- Khôi phục Gemini Judge: Judge ở trạng thái FAILED (GEMINI_AUTH_FAILED); đã thử Models API 1 lần.
- Xuất retrieved context an toàn: Trace đã map chính xác về case nhưng không công bố nội dung chunk/context truy xuất.
- Duy trì latency local: P95 hiện tại là 20907.549 ms; gate yêu cầu không quá 30.000 ms và đang đạt.

## 32. Năm cải tiến ưu tiên

### 1. Khắc phục lỗi SSE
- Bằng chứng: Run hiện tại có 1 SSE failure, error rate 0.8% và VTC 89.2%.
- Tác động: Bảo vệ khả năng hoàn thành end-to-end và không gộp lỗi vận chuyển vào lỗi đáp án.
- Ưu tiên: P0

### 2. Khắc phục đường số liệu
- Bằng chứng: Numeric Accuracy của run hiện tại là 91.8% trên mẫu số công khai.
- Tác động: Giữ số, đơn vị, sai số và evidence binding nhất quán.
- Ưu tiên: P0

### 3. Khôi phục Gemini Judge
- Bằng chứng: Judge ở trạng thái FAILED (GEMINI_AUTH_FAILED); đã thử Models API 1 lần.
- Tác động: Mở khóa chấm chất lượng ngữ nghĩa và calibration khi credential hợp lệ.
- Ưu tiên: P0

### 4. Xuất retrieved context an toàn
- Bằng chứng: Trace đã map chính xác về case nhưng không công bố nội dung chunk/context truy xuất.
- Tác động: Đo được Faithfulness, Context Recall và Context Precision mà không suy diễn từ metadata.
- Ưu tiên: P1

### 5. Duy trì latency local
- Bằng chứng: P95 hiện tại là 20907.549 ms; gate yêu cầu không quá 30.000 ms và đang đạt.
- Tác động: Giảm thời gian phản hồi và rủi ro timeout trên đường dữ liệu từ xa.
- Ưu tiên: P2

## 33. Các metric KHÔNG ĐÁNH GIÁ

Faithfulness, Context Recall, Context Precision, Evidence-Grounded Faithfulness, các điểm Judge và trajectory có thể là NOT_EVALUATED khi run không có đủ context/telemetry; không coi missing metric là 0. Tool Selection, parameter, routing và safety control metrics được chấm riêng khi case có oracle hoặc safe pair.

## 34. Hạn chế

Gemini API key được cấu hình nhưng Gemini Models API xác thực thất bại, nên chưa thể lấy catalog hoặc chấm Judge bằng key hiện tại. LangSmith map chính xác trace về case bằng agent_run_id và cho biết route/tool metadata, nhưng không xuất retrieved chunk/context content; do đó chỉ Answer Relevancy và Evidence Source Coverage được đo, không suy diễn groundedness từ metadata.

## 35. Local và Production

Kết quả chỉ phản ánh local stack. Azure latency, deployment/auth reliability và production observability phải rerun trên Azure trước khi dùng làm release evidence.

## 36. Khả năng tái lập

Raw run, normalized result, numeric audit, SSE audit, trace mapping và score artifact được lưu trong `evaluations/`. Không persist API key, token hoặc raw PII.

## 37. Lệnh tái chấm

```powershell
$runId = 'run-20260904T204800-full-c1-v8'
python tests/benchmark/extract_langsmith_traces.py --run-id $runId
python tests/benchmark/audit_numeric_accuracy.py --run-id $runId
python tests/benchmark/grade_benchmark.py --run-id $runId
python tests/benchmark/audit_grader.py --run-id $runId
python tests/benchmark/build_report.py --run-id $runId
python tests/benchmark/validate_benchmark_artifacts.py --run-id $runId
```

## 38. Kết luận cuối cùng

1. VTC local: **89.2%** (74/83).
2. Numeric Accuracy gốc/tái chấm: **91.8% / 91.8%**; tốc độ đúng có điều kiện execution thành công: **93.8%**.
3. Gemini Judge: **FAILED** (GEMINI_AUTH_FAILED); Models API FAILED; selected model `None`. Chưa có điểm Judge hoặc calibration hợp lệ.
4. Answer Relevancy (Voyage cosine): **45.3%**; Evidence Source Coverage: **87.9%**. Bốn metric groundedness còn lại không đủ context để chấm hợp lệ.
5. Tool success khi quan sát: **100.0%**; Tool Selection **100.0%**; parameter **97.8%**; Routing **86.1%**; route observability: **99.2%**.
6. Safety: PII leakage 0.0%; refusal 100.0%; safe completion 100.0%.
7. P50/P95 local: 11937.439 / 20907.549 ms.
8. Không rerun agent; mọi tái chấm dùng raw result vi-VN hiện hành.
9. Shared release gates: **FALSE**; policy **draft_requires_project_owner_approval**; decision **DRAFT_NOT_APPROVED**.
