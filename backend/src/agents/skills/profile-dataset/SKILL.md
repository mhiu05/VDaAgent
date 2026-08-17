---
name: profile-dataset
description: Run deterministic profiling for an uploaded dataset. Use when the user asks to profile, scan, inspect schema, or establish baseline metrics for a dataset.
---

# Profile dataset

Use `POST /api/v1/profile` with an authenticated `dataset_id`, an explicit scan mode, and optional sampling config. Treat the fixed profiling graph as authoritative for metrics and proposals.

Do not read source files directly, calculate replacement metrics, auto-confirm metadata proposals, or expose PII/raw rows. Return the profile run ID, scan mode, approximation status, and pending-review state.
