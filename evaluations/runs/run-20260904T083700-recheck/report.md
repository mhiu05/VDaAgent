# Báo cáo Benchmark VDaAgent — Bộ đánh giá chất lượng Production chạy trên Local

- Run ID: `run-20260904T083700-recheck`
- Ngôn ngữ: **Tiếng Việt (vi-VN)**
- Môi trường: **LOCAL**
- Azure Production Execution: **Không**
- Production Deployment Evidence: **Không**

## 1. Tóm tắt điều hành

Đã thực thi 8/83 case với 12 request từ raw vi-VN của run này. VTC là **62.5%** (5/8); kết luận local: **DRAFT_NOT_APPROVED** theo ngưỡng 80%.

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
| VTC | 62.5% |
| Numeric Accuracy gốc / tái chấm | 57.1% / 57.1% |
| Evidence Binding | 100.0% |
| PII Leakage | 0.0% |
| P95 local | 38549.364 ms |
| Shared release gates | FALSE |

## 10. Độ tin cậy grader

Audit deterministic: **PARTIAL_INSUFFICIENT_OBSERVED_CASES**, agreement 100.0%; mẫu {'edge_safety_tool': 3, 'fail': 3, 'pass': 5, 'unique_audited': 8}.

## 11. Tỷ lệ hoàn thành tác vụ có xác minh

VTC = 5/8 = **62.5%**. Case chỉ đạt khi deterministic, evidence và safety cùng đạt ở lần thử đầu.

## 12. Audit độ chính xác số liệu

Original Numeric Accuracy: **57.1%**; Corrected Numeric Accuracy: **57.1%**.
| Chỉ số numeric | Kết quả |
| --- | ---: |
| Numeric Task Success Rate | 57.1% (4/7) |
| Numeric Answer Accuracy Given Successful Execution | 57.1% |
| Numeric Extraction Coverage | 100.0% |
| Numeric Exact / Tolerance Match Rate | 57.1% / 57.1% |
| Numeric-Evidence Consistency | 100.0% (4/4) |

| Nguyên nhân | Số request |
| --- | ---: |
| Agent thực sự trả sai số | 3 |
| Parser/format lỗi | 0 |
| Percentage/unit normalization | 0 / 0 |
| Không có số trong answer | 0 |
| SSE execution | 0 |
| Wrong binding | 0 |

## 13. Vietnamese Numeric Normalizer

Grader có normalizer đã kiểm thử cho dấu phân cách Việt Nam/quốc tế, phần trăm, đồng/VNĐ, nghìn, triệu, tỷ; giữ ambiguity thay vì normalize mù quáng. Tái chấm không thay đổi 13,3%, cho thấy run này không có parser/format false-negative.

## 14. Deterministic profiling

Task completion rate: 58.3%. Ground truth số dùng policy riêng cho count, percentage, correlation, currency/amount và aggregate.

## 15. Evidence và provenance

Evidence Binding Accuracy: **100.0%**. Unsupported Quantitative Claim Rate: **KHÔNG ĐÁNH GIÁ** vì chưa có claim-level verifier độc lập.

## 16. Abstention và clarification

Correct Abstention: **75.0%**; Clarification Accuracy: **0.0%**.

## 17. Đánh giá RAG và Groundedness

- Answer Relevancy: **EVALUATED**; điểm 42.3%. Lý do: Đo semantic alignment trực tiếp giữa question và answer; không cần retrieved context.
- Evidence Source Coverage: **EVALUATED**; điểm 58.3%. Lý do: Tỷ lệ answer trace có ít nhất một tool/evidence source; đây là coverage, không phải faithfulness.
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

Tool observability request-level: **100.0%** (7/7). Case-level observable: 5/65. Tool success khi đã quan sát: **100.0%**. Khả năng quan sát tên tham số: **28.6%**; chỉ thấy tên, không thấy giá trị. Tool Selection Accuracy: **100.0%** (7/7); parameter accuracy: **100.0%** (2 eligible).

## 20. Routing / Trajectory

Trace mapping: **EXACT_AGENT_RUN_ID_MAPPING**. Route observability: **83.3%** (10/12). Routing Accuracy: **70.0%** (10 eligible); trajectory efficiency: **KHÔNG ĐÁNH GIÁ**.

## 21. Safety / Privacy

PII Leakage: 0.0%; refusal: 0.0%; jailbreak success: KHÔNG ĐÁNH GIÁ; prompt injection success: KHÔNG ĐÁNH GIÁ. Over-refusal: KHÔNG ĐÁNH GIÁ; safe-request completion: KHÔNG ĐÁNH GIÁ.

## 22. Hiệu năng local

LOCAL PERFORMANCE: P50 33655.113 ms; P95 38549.364 ms; mean TTFT 32586.064 ms; error rate 16.7%. Không suy diễn trực tiếp sang Azure.

## 23. Audit SSE

Có 2 SSE failure: {'TIMEOUT': 2}. Phân loại dựa trên lỗi công khai quan sát được, không suy diễn root cause model/tool khi trace không công bố error detail.

## 24. Repeated runs

Chính sách: Các case khó hoặc đối kháng chạy ba lần; case xác định chạy một lần.. Request lặp thêm: 4.

## 25. Độ tin cậy thống kê

VTC CI 95%: {'ci95': [0.28952, 0.96048], 'mean': 0.625, 'n': 8, 'std': 0.484123}.

## 26. Kết quả theo capability

- An toàn, riêng tư và prompt tấn công: 0/1 đạt (0.0%)
- Bằng chứng và provenance: 1/1 đạt (100.0%)
- Câu hỏi mơ hồ cần làm rõ: 0/1 đạt (0.0%)
- Dữ liệu thiếu: 1/1 đạt (100.0%)
- So sánh và drift dữ liệu: 0/1 đạt (0.0%)
- Thiếu bằng chứng / cần abstention: 1/1 đạt (100.0%)
- Tổng hợp số liệu: 1/1 đạt (100.0%)
- Tổng quan profiling: 1/1 đạt (100.0%)

## 27. Kết quả theo độ khó

- Dễ: 3/3 đạt (100.0%)
- Khó: 1/4 đạt (25.0%)
- Trung bình: 1/1 đạt (100.0%)

## 28. Failure Analysis

Có 5 failure attempt trong artifact; SSE được tách khỏi wrong numeric answer trong numeric audit.

## 29. Các nhóm lỗi chính

- Câu trả lời sai: 3
- Lỗi thực thi SSE: 2

## 30. Phân tích nguyên nhân gốc

- Câu trả lời sai: Kết quả không khớp ground truth xác định hoặc không hoàn thành yêu cầu.
- Lỗi thực thi SSE: Luồng QA công khai phát sự kiện lỗi dù HTTP đã mở thành công.

## 31. Năm cụm cải tiến quan trọng

- Khắc phục lỗi SSE trước: 32/45 request numeric và 33/125 request tổng thể dừng ở SSE.
- Chuẩn hóa đường số liệu: 3 request trả nhầm metric và 4 request không trả số.
- Sửa cấu hình Gemini: Judge gọi thật một lần nhưng nhận GEMINI_AUTH_FAILED.
- Xuất retrieved context an toàn: Trace đã map chính xác về case nhưng chỉ có tool/route metadata, không có chunk nội dung.
- Giảm latency local: P95 38549.364 ms vượt ngưỡng 30.000 ms.

## 32. Năm cải tiến ưu tiên

### 1. Khắc phục lỗi SSE trước
- Bằng chứng: 32/45 request numeric và 33/125 request tổng thể dừng ở SSE.
- Tác động: Giảm thất bại end-to-end và tăng VTC.
- Ưu tiên: P0

### 2. Chuẩn hóa đường số liệu
- Bằng chứng: 3 request trả nhầm metric và 4 request không trả số.
- Tác động: Tăng Numeric Answer Accuracy khi thực thi thành công.
- Ưu tiên: P0

### 3. Sửa cấu hình Gemini
- Bằng chứng: Judge gọi thật một lần nhưng nhận GEMINI_AUTH_FAILED.
- Tác động: Mở khóa Judge khi credential hợp lệ.
- Ưu tiên: P0

### 4. Xuất retrieved context an toàn
- Bằng chứng: Trace đã map chính xác về case nhưng chỉ có tool/route metadata, không có chunk nội dung.
- Tác động: Đo được Faithfulness, Context Recall và Context Precision theo case.
- Ưu tiên: P1

### 5. Giảm latency local
- Bằng chứng: P95 38549.364 ms vượt ngưỡng 30.000 ms.
- Tác động: Giảm thời gian phản hồi và rủi ro timeout.
- Ưu tiên: P1

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
python tests/benchmark/extract_langsmith_traces.py
python tests/benchmark/audit_numeric_accuracy.py
python tests/benchmark/grade_benchmark.py
python tests/benchmark/audit_grader.py
python tests/benchmark/build_report.py
```

## 38. Kết luận cuối cùng

1. VTC local: **62.5%** (5/8).
2. Numeric Accuracy gốc/tái chấm: **57.1% / 57.1%**; tốc độ đúng có điều kiện execution thành công: **57.1%**.
3. Gemini Judge: **FAILED** (GEMINI_AUTH_FAILED); Models API FAILED; selected model `None`. Chưa có điểm Judge hoặc calibration hợp lệ.
4. Answer Relevancy (Voyage cosine): **42.3%**; Evidence Source Coverage: **58.3%**. Bốn metric groundedness còn lại không đủ context để chấm hợp lệ.
5. Tool success khi quan sát: **100.0%**; Tool Selection **100.0%**; parameter **100.0%**; Routing **70.0%**; route observability: **83.3%**.
6. Safety: PII leakage 0.0%; refusal 0.0%; safe completion KHÔNG ĐÁNH GIÁ.
7. P50/P95 local: 33655.113 / 38549.364 ms.
8. Không rerun agent; mọi tái chấm dùng raw result vi-VN hiện hành.
9. Shared release gates: **FALSE**; policy **draft_requires_project_owner_approval**; decision **DRAFT_NOT_APPROVED**.
