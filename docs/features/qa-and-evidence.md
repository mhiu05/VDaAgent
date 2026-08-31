# QA và evidence

QA trả lời câu hỏi về profiling run theo nguyên tắc evidence-first: câu trả lời định lượng chỉ hợp lệ khi số liệu có thể truy về artifact hoặc tool result đúng workspace/run.

## API

- `POST /api/v1/qa`: trả JSON hoàn chỉnh.
- `POST /api/v1/qa/stream`: SSE cho tiến trình và token.
- `GET /api/v1/agent-runs/{run_id}`: trạng thái agent run.
- `GET /api/v1/agent-runs/{run_id}/trace`: trace event.
- `GET /api/v1/agent-runs/{run_id}/evidence`: evidence chuẩn hóa.
- `GET /api/v1/agent-runs/{run_id}/plan`: kế hoạch tool.
- `GET /api/v1/agent-runs/{run_id}/trace-summary`: tóm tắt trace.

Câu hỏi tối đa 2.000 ký tự, lịch sử tối đa 20 message; graph hiện chỉ dùng 12 message gần nhất.

## Luồng xử lý

1. kiểm tra workspace, run và trạng thái profile;
2. phân loại ý định;
3. với câu hỏi candidate key hoặc quality issue rộng, prefetch tool xác định;
4. retrieval profile và nguồn ngoài chạy song song khi phù hợp;
5. model soạn câu trả lời từ context đã giới hạn;
6. validator kiểm tra evidence, con số, citation và nguồn;
7. chỉ sau validation mới phát event trả lời cuối.

Retrieval ngoài phải được bật rõ ràng. Hybrid retrieval kết hợp sparse/dense; khi embedding provider không khả dụng, hệ thống hạ về sparse thay vì tạo evidence giả. Provider hỗ trợ gồm local, OpenAI, Voyage hoặc none theo cấu hình.

## Validator fail-closed

`qa_validation.py` kiểm tra:

- run có thật, đúng workspace và đúng artifact;
- tool/source thành công;
- evidence có nội dung hỗ trợ kết luận;
- mọi giá trị số trong câu trả lời xuất hiện trong evidence hợp lệ;
- citation trỏ đúng evidence.

Nếu không đủ bằng chứng, response phải abstain ổn định thay vì suy đoán. Trạng thái evidence được phân biệt:

- `verified`: có tool/artifact trực tiếp;
- `profile_only`: chỉ dựa trên artifact profiling;
- `no_evidence`: không đủ căn cứ, phải abstain.

Citation là liên kết provenance có cấu trúc, không chỉ là văn bản do model tự chèn.

## Quy tắc với biểu đồ

Insight từ biểu đồ chỉ được dùng khi execution là Official. Preview không được coi là evidence định lượng. Cột PII chưa bị reject không được gửi sang model hoặc dùng trong truy vấn.

## Quan sát và đánh giá

AI latency được ghi theo router, planner, retrieval, tools, evidence, final LLM, validation, TTFT, số call và token. Benchmark local chỉ kiểm tra wiring/performance trong môi trường đó, không phải production SLO.

## Nguồn triển khai

- `backend/src/api/routes.py`
- `backend/src/api/agent_routes.py`
- `backend/src/agents/nodes/qa_nodes.py`
- `backend/src/services/qa_validation.py`
- `backend/src/services/retrieval.py`
- `backend/src/agents/runtime/trace.py`
