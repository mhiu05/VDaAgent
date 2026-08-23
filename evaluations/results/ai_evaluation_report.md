# VDaAgent AI Evaluation Report

The current generated scorecard is [latest_scorecard.md](latest_scorecard.md)
with its machine-readable peer [latest_scorecard.json](latest_scorecard.json).

## Latest verified offline run

- Dataset: `p170-ai-eval-v1`
- Cases: 21 synthetic cases
- Hard-gate failures: 0
- Critical failures: 0
- Result: PASS for the offline fixture-contract gate

This result validates fixture integrity, evaluator logic, real Pydantic contract
checks, and configured release gates. It is **not** an online-model quality
score: no provider, staging API, latency, token usage, monetary cost, or
LLM-as-a-judge metric was executed.

Run `python evaluations/run_evaluation.py --offline` to regenerate the latest
artifacts. See [docs/eval.md](../../docs/eval.md) for scope, limitations, and
required owner actions before treating any online result as a release baseline.
