---
name: diagnose-data-quality
description: Diagnose deterministic data-quality and governance signals for one profile run. Use when the user asks about missingness, duplicates, outliers, readiness, PII, or data-quality risks.
---

# Diagnose data quality

Use only the declared read-only bundle: `get_profile_readiness`, `get_profile_overview`, `list_quality_issues`, `get_missingness_patterns`, `get_duplicate_analysis`, and `get_governance_summary`.

Lead with evidence and limitations. Treat pending PII as sensitive; never return raw values. A readiness result does not replace the Analysis Workspace quality gate.
