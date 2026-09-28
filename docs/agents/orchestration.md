# Điều phối agent

```mermaid
flowchart TB
  CO[Coordinator invocation] --> D[Data stage]
  D --> C[Comparison]
  D --> H[Chart]
  D --> A[Analyst]
  C --> I[Insight]
  H --> I
  A --> I
  I --> R[Report draft]
  R --> V[Reviewer]
  V -->|REVISION_REQUIRED, draft 1| R2[Report revision 2]
  R2 --> V2[Reviewer lần 2]
  V -->|PASS| P[Publication]
  V2 -->|PASS| P
```

`TeamRuntime` đăng ký agent từ `ANALYSIS_AGENT_DEFINITIONS`, kiểm input schema, giới hạn số invocation/delegation/độ sâu và cấm cycle. `requestAgent()` tạo child invocation, message request/result và tool call có correlation key. Coordinator là agent có quyền gọi các specialist trong full run. Insight có thể gọi Data để lấy evidence đã xác minh; các stage ghi checkpoint/artifact, không chỉ trả text.

`agent-v1` có DAG stage cố định. Sau Data, Comparison/Chart/Analyst được chạy song song và Insight chờ đủ kết quả. Reviewer có tối đa hai lần review gắn với draft revision 1/2. Nếu lần hai vẫn yêu cầu sửa, run thất bại với `REVIEW_REVISION_LIMIT`; publication chỉ chạy khi `PASS`. Câu hỏi chat ban đầu được Agent Runtime định tuyến theo policy/plan và có thể tạo run qua capability `create_analysis`.

Code mapping: `src/backend/packages/agents/src/analysis-v1/dag.ts`, `src/backend/packages/agents/src/analysis-v1/team-workflow.ts`, `src/backend/packages/agents/src/runtime/team/runtime.ts`, `src/backend/packages/agents/src/analysis-v1/workflow.ts`. Xem [analysis workflow](../workflows/analysis-workflow.md).
