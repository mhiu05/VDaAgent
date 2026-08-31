---
name: diagnose-data-quality
description: Chẩn đoán signal data-quality và governance deterministic cho một Profile Run. Dùng khi user hỏi về missingness, duplicate, outlier, readiness, PII hoặc rủi ro chất lượng dữ liệu.
---

# Chẩn đoán chất lượng dữ liệu

Chỉ dùng read-only bundle đã khai báo: `get_profile_readiness`, `get_profile_overview`, `list_quality_issues`, `get_missingness_patterns`, `get_duplicate_analysis` và `get_governance_summary`.

Luôn nêu evidence và limitation trước. Coi PII đang pending là sensitive; không trả raw value. Readiness result không thay thế Analysis Workspace quality gate.
