"""Run the versioned semantic judge on synthetic calibration or online traces.

The output is intentionally redacted: prompts, answers, rows, and evidence are
used in memory only and are never written to the scorecard.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
FIXTURE = ROOT / "fixtures" / "v1.json"
CALIBRATION = ROOT / "fixtures" / "judge_calibration_v1.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "evaluations" / "results" / "judge_scorecard.json"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from judge_rubric import JudgeResult, RUBRIC_VERSION, judge_prompt  # noqa: E402


def _load_environment() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    if not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY is required for the semantic judge.")
    # Keep judge traces separate from the application project and allow cost
    # accounting to read provider-reported metadata from LangSmith.
    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGCHAIN_TRACING_V2"] = "true"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _make_judge(project_name: str) -> Any:
    from langchain_google_genai import ChatGoogleGenerativeAI

    os.environ["LANGSMITH_PROJECT"] = project_name
    os.environ["LANGCHAIN_PROJECT"] = project_name
    model = os.getenv("LLM_MODEL", "gemini-3.6-flash")
    llm = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=os.environ["GEMINI_API_KEY"],
        temperature=0.0,
        max_retries=2,
    )
    return llm.with_structured_output(JudgeResult)


def _invoke(judge: Any, item: dict[str, Any], *, tag: str) -> JudgeResult:
    result = judge.invoke(
        judge_prompt(
            question=str(item.get("question", "")),
            reference=str(item.get("reference", "")),
            evidence=str(item.get("evidence", "")),
            answer=str(item.get("answer", "")),
        ),
        config={"run_name": "p170_semantic_judge", "tags": [RUBRIC_VERSION, tag]},
    )
    return result if isinstance(result, JudgeResult) else JudgeResult.model_validate(result)


def _score_calibration(item: dict[str, Any], result: JudgeResult) -> dict[str, Any]:
    expected_decision = item["expected_decision"]
    decision_ok = result.decision == expected_decision
    minimums = item.get("minimum_scores", {})
    scores_ok = all(getattr(result, key) >= value for key, value in minimums.items())
    return {
        "id": item["id"],
        "expected_decision": expected_decision,
        "actual_decision": result.decision,
        "scores": result.model_dump(),
        "calibration_pass": decision_ok and scores_ok,
    }


def _fixture_cases() -> dict[str, dict[str, Any]]:
    return {case["id"]: case for case in _load_json(FIXTURE)["cases"]}


def _experiment_items(experiment: str) -> list[dict[str, Any]]:
    from langsmith import Client

    client = Client()
    cases = _fixture_cases()
    items: list[dict[str, Any]] = []
    for run in client.list_runs(project_name=experiment, is_root=True, limit=100):
        inputs = run.inputs or {}
        outputs = run.outputs or {}
        case_id = inputs.get("id")
        case = cases.get(case_id)
        if not case:
            continue
        body = outputs.get("body", outputs) if isinstance(outputs, dict) else {}
        if not isinstance(body, dict):
            body = {}
        evidence = body.get("evidence") or body.get("sources") or body.get("evidence_ids") or []
        items.append(
            {
                "id": case_id,
                "question": case.get("input", {}).get("question", ""),
                "reference": json.dumps(case.get("expected", {}), ensure_ascii=False),
                "evidence": json.dumps(evidence, ensure_ascii=False),
                "answer": body.get("answer") or body.get("detail") or "",
            }
        )
    return sorted(items, key=lambda item: item["id"])


def _provider_usage(project_name: str, started_at: datetime) -> dict[str, Any]:
    from langsmith import Client

    client = Client()
    try:
        spans = list(
            client.list_runs(
                project_name=project_name,
                run_type="llm",
                start_time=started_at - timedelta(seconds=5),
                limit=100,
            )
        )
    except Exception as exc:
        return {
            "status": "unavailable",
            "provider": "gemini",
            "provider_span_count": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "estimated_cost_usd": 0,
            "pricing_source": f"LangSmith unavailable: {type(exc).__name__}",
            "currency": "USD",
        }
    input_tokens = sum(run.prompt_tokens or 0 for run in spans)
    output_tokens = sum(run.completion_tokens or 0 for run in spans)
    total_tokens = sum(run.total_tokens or 0 for run in spans)
    cost = sum(float(run.total_cost or 0) for run in spans)
    return {
        "status": "available" if spans else "unavailable",
        "provider": "gemini",
        "provider_span_count": len(spans),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_usd": round(cost, 9),
        "pricing_source": "LangSmith provider-reported total_cost",
        "currency": "USD",
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    _load_environment()
    started_at = datetime.now(UTC)
    run_id = started_at.strftime("%Y%m%dT%H%M%SZ")
    project_name = args.langsmith_project or f"p170-llm-judge-{run_id}"
    judge = _make_judge(project_name)
    calibration_items = _load_json(CALIBRATION)["cases"]
    calibration_results = []
    for item in calibration_items:
        calibration_results.append(_score_calibration(item, _invoke(judge, item, tag="calibration")))

    judged_items = _experiment_items(args.experiment) if args.experiment else []
    judged_results = []
    for item in judged_items:
        result = _invoke(judge, item, tag="online_baseline")
        judged_results.append({"id": item["id"], "scores": result.model_dump()})

    usage = _provider_usage(project_name, started_at)
    dimensions = ("helpfulness", "groundedness", "tone", "uncertainty_calibration", "safety")
    semantic_metrics = {}
    for dimension in dimensions:
        values = [entry["scores"][dimension] for entry in judged_results]
        if values:
            semantic_metrics[f"{dimension}_mean"] = round(statistics.fmean(values), 4)
    semantic_metrics["semantic_pass_rate"] = round(
        sum(entry["scores"]["decision"] == "pass" for entry in judged_results) / len(judged_results), 4
    ) if judged_results else None

    scorecard = {
        "schema_version": "p170-llm-judge-scorecard-v1",
        "rubric_version": RUBRIC_VERSION,
        "runtime": "online_gemini_native",
        "generated_at": started_at.isoformat(),
        "data_classification": "synthetic_only",
        "judge_model": os.getenv("LLM_MODEL", "gemini-3.6-flash"),
        "judge_model_role": "semantic_quality_judge",
        "pricing_metadata": {
            "file": "tests/evaluations/judge_pricing_v1.json",
            "version": "p170-judge-pricing-v1",
            "status": "provider_reported_cost_accounting",
        },
        "calibration": {
            "fixture": "tests/evaluations/fixtures/judge_calibration_v1.json",
            "case_count": len(calibration_results),
            "passed_count": sum(item["calibration_pass"] for item in calibration_results),
            "results": calibration_results,
        },
        "online_baseline": {
            "experiment": args.experiment,
            "case_count": len(judged_results),
            "metrics": semantic_metrics,
            "results": judged_results,
        },
        "provider_usage": usage,
        "privacy": {
            "raw_inputs_outputs_written": False,
            "raw_inputs_outputs_sent_to_judge": True,
            "scope": "synthetic calibration and synthetic online baseline only",
        },
        "approval": {
            "status": "approved_for_synthetic_evaluation" if all(item["calibration_pass"] for item in calibration_results) and usage["status"] == "available" else "ready_for_project_owner_review",
            "owner_role": "project_owner",
            "pricing_owner": "project_owner",
            "pricing_owner_required": False,
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(scorecard, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return scorecard


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--experiment", help="Existing LangSmith online experiment to judge.")
    result.add_argument("--langsmith-project", help="Project used for judge traces and cost accounting.")
    result.add_argument("--output", default=str(DEFAULT_OUTPUT))
    return result


if __name__ == "__main__":
    parsed_args = parser().parse_args()
    scorecard = run(parsed_args)
    print(json.dumps({
        "output": str(Path(parsed_args.output)),
        "rubric_version": scorecard["rubric_version"],
        "calibration": scorecard["calibration"],
        "online_case_count": scorecard["online_baseline"]["case_count"],
        "provider_usage": scorecard["provider_usage"],
    }, ensure_ascii=False))
