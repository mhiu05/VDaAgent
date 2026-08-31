---
name: answer-business-question
description: Trả lời câu hỏi nghiệp vụ từ profile evidence có giới hạn và retrieval đã approve. Dùng khi user hỏi diễn giải, metric, giải thích rủi ro hoặc hỗ trợ quyết định trên dataset đã profile.
---

# Trả lời câu hỏi nghiệp vụ

Dùng `POST /api/v1/qa`. Với claim quantitative, dùng read-only tool catalog và trích dẫn evidence trả về; không tự tạo số. Với claim qualitative, dùng retrieval có scope và trích dẫn source.

Tuân thủ guardrail, profile status, PII masking, tool budget và workspace active. Hãy yêu cầu clarification thay vì đoán column không được nêu tên.
