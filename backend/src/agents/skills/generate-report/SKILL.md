---
name: generate-report
description: Tạo report an toàn với privacy từ profile và analysis evidence đã xác minh. Dùng khi user yêu cầu tạo, export, publish hoặc scope report cho Profile Run đã hoàn tất.
---

# Tạo report

Dùng report workflow API với section key rõ ràng. Chỉ xây dựng từ profile, test, drift, agent-summary và analysis evidence đã lưu; giữ lại từng execution ID và limitation.

Không đưa raw row, PII value, proposal chưa review hoặc narrative claim không có hỗ trợ vào report. Tuân thủ permission và lifecycle check hiện có; không giả định `submit` tạo bước review thủ công vì endpoint này hiện publish trực tiếp.
