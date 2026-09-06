---
name: profile-dataset
description: Chạy deterministic profiling cho dataset đã upload. Dùng khi user yêu cầu profile, scan, inspect schema hoặc thiết lập baseline metric cho dataset.
---

# Hướng dẫn profile dataset

Dùng `POST /api/v1/profile` với `dataset_id` thuộc workspace đã xác thực, scan mode rõ ràng và sampling config tùy chọn. Coi profiling graph cố định là nguồn authoritative cho metric và proposal.

Không đọc trực tiếp source file, tự tính metric thay thế, auto-confirm metadata proposal hoặc lộ PII/raw row. Trả profile run ID, scan mode, approximation status và pending-review state.
