# VDaAgent AI Evaluation Report

The current generated scorecard is [latest_scorecard.md](latest_scorecard.md)
with its machine-readable peer [latest_scorecard.json](latest_scorecard.json).
The semantic judge artifact is [judge_scorecard.json](judge_scorecard.json).

## Latest verified offline run

- Dataset: `p170-ai-eval-v1`
- Cases: 26 synthetic cases
- Hard-gate failures: 0
- Critical failures: 0
- Result: PASS for the offline fixture-contract gate

This result validates fixture integrity, evaluator logic, real Pydantic contract
checks, and configured release gates. The separate synthetic online judge run
uses rubric `p170-llm-judge-rubric-v1`, passed calibration 5/5, and scored the
26-case baseline with semantic pass rate 69.23%.

Run `python tests/evaluations/run_evaluation.py --offline` to regenerate the latest
artifacts. See [docs/eval.md](../../docs/eval.md) for scope, limitations, and
required owner actions before treating any online result as a release baseline.
