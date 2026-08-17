---
name: answer-business-question
description: Answer a business question from bounded profile evidence and approved retrieval. Use when a user asks for an interpretation, metric, risk explanation, or decision support about a profiled dataset.
---

# Answer business question

Use `POST /api/v1/qa`. For quantitative claims, use the read-only tool catalog and cite the returned evidence; do not invent numbers. For qualitative claims, use scoped retrieval and cite sources.

Respect guardrails, profile status, PII masking, tool budgets, and the active workspace. Ask for clarification rather than guessing an unnamed column.
