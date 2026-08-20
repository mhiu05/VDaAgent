---
name: compare-profile-drift
description: Inspect persisted profile drift evidence. Use when the user asks how a dataset changed, wants schema or distribution drift findings, or compares compatible profiling runs.
---

# Compare profile drift

Create drift through `POST /api/v1/profile/{run_id}/drift` only after the API validates same-dataset compatibility. Inspect persisted evidence only with `get_drift_summary`, `get_drift_findings`, and `get_schema_diff`.

Never infer drift from raw rows or compare runs across workspaces. State when no persisted report exists.
