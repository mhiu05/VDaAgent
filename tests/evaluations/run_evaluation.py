"""Bộ đánh giá synthetic, evidence-first cho VDaAgent.

Chế độ offline không gọi model hoặc LangSmith. Chế độ live gọi API
đã xác thực; việc upload là opt-in.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from evaluation_core import (
    hard_gate_pass as evaluation_hard_gate_pass,
    redact_diagnostics,
    score_case as evaluation_score_case,
    summarize,
)

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
load_dotenv(PROJECT_ROOT / ".env")
FIXTURE = ROOT / "fixtures" / "v1.json"
CANARY = "PII_CANARY_9471"
GATES = ROOT / "release_gates.json"


@dataclass(frozen=True)
class Score:
    key: str
    score: float
    comment: str
    hard_gate: bool = False


def load_cases(split: str | None = None) -> tuple[str, list[dict[str, Any]]]:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    cases = payload["cases"]
    if split:
        cases = [case for case in cases if case["split"] == split]
    if not cases:
        raise ValueError("Không có case evaluation cho split đã chọn.")
    return payload["dataset_version"], cases


def validate_fixture(version: str, cases: list[dict[str, Any]]) -> None:
    if not version or not {"dev", "test", "security", "regression"}.issubset(
        {case.get("split") for case in cases}
    ):
        raise ValueError("Fixture thiếu phiên bản hoặc split bắt buộc.")
    ids: set[str] = set()
    for case in cases:
        if (
            not case.get("id")
            or case["id"] in ids
            or not case.get("input")
            or not case.get("expected")
            or not case.get("suite")
            or case.get("surface") not in {"qa", "chart_planner", "profile_narrative"}
        ):
            raise ValueError(f"Case không hợp lệ: {case}")
        text = json.dumps(case, ensure_ascii=False).casefold()
        if "workspace_id" in text or "actor_user_id" in text:
            raise ValueError(f"Fixture chứa định danh tenant: {case['id']}")
        ids.add(case["id"])


def _body(output: dict[str, Any]) -> dict[str, Any]:
    value = output.get("body", output)
    return value if isinstance(value, dict) else {}


def _answer(body: dict[str, Any]) -> str:
    return str(body.get("answer") or body.get("detail") or "")


def _any(text: str, values: Iterable[str]) -> bool:
    return any(value.casefold() in text.casefold() for value in values)


def score_case(case: dict[str, Any], output: dict[str, Any]) -> list[Score]:
    """Scorecard deterministic; không gửi payload tới LLM."""

    expected, body = case["expected"], _body(output)
    answer = _answer(body)
    status = int(output.get("status_code", 200))
    scores = [
        Score("api_status", float(200 <= status < 300), f"HTTP {status}", True),
        Score("schema", float(bool(body)), "Body response là một object.", True),
    ]
    blocked = [CANARY, *expected.get("must_not_contain", [])]
    serialized = json.dumps(body, ensure_ascii=False).casefold()
    leaked = [value for value in blocked if value.casefold() in serialized]
    scores.append(
        Score(
            "privacy_leak",
            float(not leaked),
            "Không lộ giá trị cần bảo vệ." if not leaked else f"Đã lộ: {leaked}",
            True,
        )
    )
    if kind := expected.get("question_type"):
        scores.append(
            Score(
                "router",
                float(body.get("question_type") == kind),
                f"expected={kind}, actual={body.get('question_type')}",
            )
        )
    if words := expected.get("answer_any_of"):
        scores.append(
            Score(
                "answer_contract",
                float(_any(answer, words)),
                "Đúng ý định phản hồi yêu cầu.",
            )
        )
    if expected.get("requires_evidence"):
        evidence = (
            body.get("evidence")
            or body.get("sources")
            or body.get("evidence_ids")
            or []
        )
        scores.append(
            Score(
                "evidence_binding", float(bool(evidence)), "Có evidence đính kèm.", True
            )
        )
    if minimum := expected.get("citation_minimum"):
        scores.append(
            Score(
                "citation_precision",
                float(len(body.get("sources") or []) >= minimum),
                "Đúng số lượng citation.",
            )
        )
    if "is_approximate" in expected:
        scores.append(
            Score(
                "approximation",
                float(bool(body.get("is_approximate")) == expected["is_approximate"]),
                "Giữ đúng cờ xấp xỉ.",
                True,
            )
        )
    if "numeric_reference" in expected:
        numeric = str(expected["numeric_reference"])
        scores.append(
            Score(
                "numeric_grounding",
                float(
                    numeric in answer
                    or body.get("value") == expected["numeric_reference"]
                ),
                "Giữ đúng giá trị số deterministic.",
                True,
            )
        )
    if unit := expected.get("unit"):
        scores.append(
            Score(
                "unit_preservation",
                float(unit in answer or body.get("unit") == unit),
                "Giữ đúng đơn vị.",
            )
        )
    if budget := expected.get("max_tool_calls"):
        calls = int(body.get("tool_calls_used") or body.get("tool_call_count") or 0)
        scores.append(
            Score("tool_budget", float(calls <= budget), f"tool_calls={calls}", True)
        )
    if case["surface"] == "chart_planner":
        plan = body.get("plan", body)
        columns = set(plan.get("columns") or [plan.get("x"), plan.get("y")]) - {None}
        scores.append(
            Score(
                "planner_allowlist",
                float(columns.issubset(set(expected["plan_allowed_columns"]))),
                f"used={sorted(columns)}",
                True,
            )
        )
        scores.append(
            Score(
                "planner_kind",
                float(
                    plan.get("analysis_kind") in expected["plan_allowed_analysis_kinds"]
                ),
                "Analysis kind thuộc allow-list.",
                True,
            )
        )
    return scores


def hard_gate_pass(scores: Iterable[Score]) -> bool:
    return all(item.score == 1 for item in scores if item.hard_gate)


# Keep the public runner functions used by the existing tests, while delegating
# new runs to the stronger evaluator module.  The legacy implementation remains
# above solely for backwards-readable history of the original v1 hard gates.
legacy_score_case = score_case
score_case = evaluation_score_case
legacy_hard_gate_pass = hard_gate_pass
hard_gate_pass = evaluation_hard_gate_pass


def mock_output(case: dict[str, Any]) -> dict[str, Any]:
    expected = case["expected"]
    if expected.get("safety_outcome") == "backend_reject":
        return {
            "status_code": (expected.get("allowed_statuses") or [404])[0],
            "body": {"detail": "Không tìm thấy resource trong workspace."},
        }
    if case["surface"] == "chart_planner":
        return {
            "status_code": 200,
            "body": {
                "question": case["input"]["question"],
                "problem": "trend",
                "algorithm": expected.get("aggregation", "sum"),
                "chart_type": expected.get("chart_type", "line"),
                "source_columns": expected["plan_allowed_columns"],
                "query": {
                    "analysis_kind": expected["plan_allowed_analysis_kinds"][0],
                    "aggregate": expected.get("aggregation", "sum"),
                    "column": "revenue" if "revenue" in expected["plan_allowed_columns"] else None,
                    "dimensions": ["month"] if "month" in expected["plan_allowed_columns"] else [],
                    "filters": [],
                    "time_grain": expected.get("time_grain"),
                    "bins": 12,
                    "forecast_horizon": 12,
                    "season_length": 12,
                    "confidence_level": 0.95,
                    "history_limit": 500,
                    "limit": 50,
                    "sort": "asc",
                },
            },
        }
    answer = "Không có đủ bằng chứng."
    if expected.get("answer_any_of"):
        answer = f"{expected['answer_any_of'][0]} phản hồi synthetic."
    if "numeric_reference" in expected:
        answer = f"{answer} {expected['numeric_reference']}{expected.get('unit', '')}".strip()
    if markers := expected.get("limitation_any_of"):
        answer = f"{answer} {markers[0]}"
    if markers := expected.get("forecast_uncertainty_any_of"):
        answer = f"{answer} {markers[0]}"
    if all_words := expected.get("answer_all_of"):
        answer = f"{answer} {' '.join(all_words)}"
    return {
        "status_code": 200,
        "body": {
            "question": case.get("input", {}).get("question", "synthetic evaluation"),
            "answer": answer,
            "question_type": expected.get("question_type"),
            "sources": [{"type": "tool", "tool": expected.get("required_tool", "get_column_profile"), "args": {}, "status": "completed", "profile_run_id": "synthetic-profile"}]
            if expected.get("requires_evidence")
            else [],
            "is_approximate": expected.get("is_approximate", False),
            "tool_call_count": 1,
            "evidence_status": "verified" if expected.get("requires_evidence") else "no_evidence",
        },
    }


async def api_target(
    inputs: dict[str, Any],
    base_url: str,
    headers: dict[str, str],
    profile_run_id: str,
    request_timeout: float,
) -> dict[str, Any]:
    if inputs["surface"] == "qa":
        method, path, payload = (
            "POST",
            "/qa",
            {"profile_run_id": profile_run_id, "question": inputs["input"]["question"]},
        )
    elif inputs["surface"] == "chart_planner":
        method, path, payload = (
            "POST",
            f"/profile/{profile_run_id}/charts/auto-plan",
            {"question": inputs["input"]["question"]},
        )
    elif inputs["surface"] == "profile_narrative":
        method, path, payload = "GET", f"/profile/{profile_run_id}/report", None
    else:
        return {"status_code": 422, "body": {"detail": "surface_chưa_bật_live"}}
    try:
        async with httpx.AsyncClient(timeout=request_timeout) as client:
            response = await client.request(
                method,
                f"{base_url.rstrip('/')}{path}",
                headers=headers,
                json=payload,
            )
            try:
                body = response.json()
                if inputs["surface"] == "profile_narrative" and response.is_success:
                    body = {
                        "answer": _profile_report_text(body),
                        "sources": [{"type": "profile_report", "status": "completed"}],
                    }
                return {"status_code": response.status_code, "body": body}
            except ValueError:
                return {
                    "status_code": response.status_code,
                    "body": {"detail": "phản_hồi_không_phải_json"},
                }
    except httpx.TimeoutException:
        return {
            "status_code": 504,
            "body": {"detail": "evaluation_target_timeout"},
        }
    except httpx.HTTPError:
        return {
            "status_code": 502,
            "body": {"detail": "evaluation_target_transport_error"},
        }


def _profile_report_text(value: Any) -> str:
    """Project a report response to the narrative text used by the fixture scorer."""

    preferred_keys = ("narrative_report", "summary", "text", "content")
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in preferred_keys:
            if key in value:
                text = _profile_report_text(value[key])
                if text:
                    return text
        for item in value.values():
            text = _profile_report_text(item)
            if text:
                return text
    if isinstance(value, list):
        for item in value:
            text = _profile_report_text(item)
            if text:
                return text
    return ""


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "không_khả_dụng"


async def run_live(
    cases: list[dict[str, Any]], args: argparse.Namespace, version: str
) -> None:
    from langsmith import Client, aevaluate

    headers = {"X-Workspace-Id": args.workspace_id}
    if args.bearer_token:
        headers["Authorization"] = f"Bearer {args.bearer_token}"

    async def target(inputs: dict[str, Any]) -> dict[str, Any]:
        return await api_target(
            inputs,
            args.base_url,
            headers,
            args.profile_run_id,
            args.request_timeout,
        )

    def hard_gate(run: Any, example: Any) -> dict[str, Any]:
        outputs = getattr(run, "outputs", None) or {}
        inputs = getattr(example, "inputs", None) or {}
        scores = score_case(inputs, outputs)
        return {
            "key": "hard_gate",
            "score": float(hard_gate_pass(scores)),
            "comment": "; ".join(f"{item.key}={item.score}" for item in scores),
        }

    metadata = {
        "dataset_version": version,
        "git_sha": _git_sha(),
        "runtime": "api",
        "generated_at": datetime.now(UTC).isoformat(),
        "repetitions": args.repetitions,
    }
    client = Client()
    dataset_name = f"p170-ai-eval-{version}"
    if not client.has_dataset(dataset_name=dataset_name):
        dataset = client.create_dataset(
            dataset_name,
            description="Synthetic-only P170 evaluation fixture; no production rows or PII.",
            metadata={"dataset_version": version, "source": "repository_fixture"},
        )
        client.create_examples(
            dataset_id=dataset.id,
            examples=[{"inputs": case} for case in cases],
        )
    results = await aevaluate(
        target,
        data=dataset_name,
        evaluators=[hard_gate],
        metadata=metadata,
        experiment_prefix="p170-evidence-first",
        max_concurrency=args.concurrency,
        num_repetitions=args.repetitions,
        client=client,
        upload_results=args.upload_results,
    )
    async for _ in results:
        pass


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--split", choices=["dev", "test", "security", "regression"])
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--offline", action="store_true")
    result.add_argument("--base-url")
    result.add_argument("--workspace-id")
    result.add_argument(
        "--bearer-token", default=os.getenv("P170_EVAL_BEARER_TOKEN", "")
    )
    result.add_argument("--profile-run-id")
    result.add_argument("--upload-results", action="store_true")
    result.add_argument("--concurrency", type=int, default=2)
    result.add_argument("--repetitions", type=int, default=1)
    result.add_argument(
        "--request-timeout",
        type=float,
        default=120.0,
        help="Per-request API timeout in seconds for live evaluation.",
    )
    result.add_argument("--baseline", help="Path to a prior JSON scorecard for regression comparison.")
    result.add_argument("--output-dir", default=str(PROJECT_ROOT / "evaluations" / "results"))
    result.add_argument("--no-write-reports", action="store_true")
    return result


def _load_gates() -> dict[str, Any]:
    return json.loads(GATES.read_text(encoding="utf-8"))


def evaluate_release_gates(scorecard: dict[str, Any], gates: dict[str, Any]) -> list[dict[str, Any]]:
    """Return explicit pass/fail states; thresholds stay out of evaluator code."""

    metrics = scorecard["summary"]["metrics"]
    telemetry = scorecard.get("summary", {}).get("telemetry", {})
    telemetry_metric_paths = {
        "latency_p95_ms": ("latency_ms", "p95"),
        "total_tokens_per_run": ("total_tokens", "total"),
        "estimated_cost_usd_per_run": ("estimated_cost_usd", "total"),
    }

    def metric_value(key: str) -> Any:
        if key in metrics:
            return metrics[key]
        path = telemetry_metric_paths.get(key)
        if not path:
            return None
        section = telemetry.get(path[0]) or {}
        if section.get("status") != "available":
            return None
        value = section.get(path[1])
        return value if isinstance(value, (int, float)) else None

    results: list[dict[str, Any]] = []
    for key, minimum in gates.get("minimum_rates", {}).items():
        value = metrics.get(key)
        results.append({"gate": key, "status": "not_available" if value is None else "pass" if value >= minimum else "fail", "actual": value, "threshold": minimum})
    for key, maximum in gates.get("maximum_values", {}).items():
        value = metric_value(key)
        results.append({"gate": key, "status": "not_available" if value is None else "pass" if value <= maximum else "fail", "actual": value, "threshold": maximum})
    if gates.get("critical_failures_must_equal", 0) == 0:
        actual = len(scorecard["summary"]["critical_failures"])
        results.append({"gate": "critical_failures", "status": "pass" if actual == 0 else "fail", "actual": actual, "threshold": 0})
    return results


def compare_baseline(scorecard: dict[str, Any], path: str | None, gates: dict[str, Any]) -> list[dict[str, Any]]:
    if not path:
        return []
    baseline = json.loads(Path(path).read_text(encoding="utf-8"))
    current_metrics = scorecard["summary"]["metrics"]
    baseline_metrics = baseline.get("summary", {}).get("metrics", {})
    comparisons: list[dict[str, Any]] = []
    for key, allowed_drop in gates.get("maximum_regressions", {}).items():
        before, after = baseline_metrics.get(key), current_metrics.get(key)
        if not isinstance(before, (int, float)) or not isinstance(after, (int, float)):
            comparisons.append({"metric": key, "status": "not_available", "before": before, "after": after})
            continue
        delta = round(after - before, 6)
        comparisons.append({"metric": key, "status": "regression" if delta < -float(allowed_drop) else "pass", "before": before, "after": after, "delta": delta, "allowed_drop": allowed_drop})
    return comparisons


def write_reports(scorecard: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "latest_scorecard.json"
    markdown_path = output_dir / "latest_scorecard.md"
    json_path.write_text(json.dumps(scorecard, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = scorecard["summary"]
    lines = [
        "# VDaAgent AI Evaluation Scorecard",
        "",
        f"- Dataset: `{scorecard['dataset_version']}`",
        f"- Runtime: `{scorecard['runtime']}`",
        f"- Cases: {scorecard['case_count']}",
        "- Online model metrics were not executed." if scorecard["runtime"] == "offline_fixture_contract" else "- Online API execution was used.",
        "",
        "## Metrics",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        *[f"| `{key}` | {value:.2%} |" for key, value in summary["metrics"].items()],
        "",
        "## Release gates",
        "",
        "| Gate | Status | Actual | Threshold |",
        "| --- | --- | ---: | ---: |",
        *[f"| `{item['gate']}` | {item['status'].upper()} | {item.get('actual', '—')} | {item.get('threshold', '—')} |" for item in scorecard["release_gates"]],
        "",
        "## Diagnostics",
        "",
        f"- Failed cases: {', '.join(summary['failed_cases']) or 'none'}",
        f"- Critical failures: {', '.join(summary['critical_failures']) or 'none'}",
        f"- Latency: `{summary['telemetry']['latency_ms']['status']}`",
        f"- Token usage: `{summary['telemetry']['input_tokens']['status']}`",
        f"- Cost: `{summary['telemetry']['estimated_cost']}`",
    ]
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


def main() -> int:
    args = parser().parse_args()
    version, cases = load_cases(args.split)
    validate_fixture(version, cases)
    if args.dry_run:
        print(
            json.dumps(
                {
                    "status": "valid",
                    "dataset_version": version,
                    "case_count": len(cases),
                    "network": False,
                },
                ensure_ascii=False,
            )
        )
        return 0
    if args.offline:
        outcomes = [
            {
                "id": case["id"],
                "scores": [asdict(score) for score in score_case(case, mock_output(case))],
                "telemetry": {},
            }
            for case in cases
        ]
        diagnostics = [redact_diagnostics(case, [Score(**score) for score in outcome["scores"]]) for case, outcome in zip(cases, outcomes, strict=True)]
        scorecard = {
            "schema_version": "p170-evaluation-scorecard-v1",
            "dataset_version": version,
            "runtime": "offline_fixture_contract",
            "generated_at": datetime.now(UTC).isoformat(),
            "case_count": len(cases),
            "summary": summarize(outcomes),
            "diagnostics": diagnostics,
        }
        gates = _load_gates()
        scorecard["release_gates"] = evaluate_release_gates(scorecard, gates)
        scorecard["regression"] = compare_baseline(scorecard, args.baseline, gates)
        if not args.no_write_reports:
            json_path, markdown_path = write_reports(scorecard, Path(args.output_dir))
            scorecard["report_paths"] = {"json": str(json_path), "markdown": str(markdown_path)}
        failed = scorecard["summary"]["failed_cases"]
        gate_failed = any(item["status"] == "fail" for item in scorecard["release_gates"])
        print(
            json.dumps(
                scorecard,
                ensure_ascii=False,
            )
        )
        return int(bool(failed or gate_failed))
    if not all([args.base_url, args.workspace_id, args.profile_run_id]):
        raise SystemExit(
            "Chế độ live cần --base-url, --workspace-id và --profile-run-id của dữ liệu staging synthetic."
        )
    if not args.bearer_token:
        raise SystemExit(
            "Live evaluation requires P170_EVAL_BEARER_TOKEN for the synthetic staging environment."
        )
    asyncio.run(run_live(cases, args, version))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
