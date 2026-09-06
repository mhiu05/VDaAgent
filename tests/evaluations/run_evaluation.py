"""Run the versioned, synthetic-only VDaAgent evaluation benchmark.

Offline mode proves fixtures and deterministic scorers agree with production
contracts. It is explicitly not a model-quality score. Staging mode calls the
authenticated API and is the only mode that can evaluate release gates.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from evaluation_core import Score, hard_gate_pass, redact_diagnostics, score_case, summarize

__all__ = [
    "api_target",
    "compare_baseline",
    "evaluate_release_gates",
    "hard_gate_pass",
    "load_cases",
    "mock_output",
    "redact_diagnostics",
    "score_case",
    "validate_fixture",
]

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
FIXTURE = ROOT / "fixtures" / "v2.json"
GATES = ROOT / "release_gates.json"
load_dotenv(PROJECT_ROOT / ".env")


def load_cases(split: str | None = None) -> tuple[str, list[dict[str, Any]]]:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    cases = payload["cases"]
    if split:
        cases = [case for case in cases if case["split"] == split]
    if not cases:
        raise ValueError("Không có case evaluation cho split đã chọn.")
    return payload["dataset_version"], cases


def validate_fixture(version: str, cases: list[dict[str, Any]]) -> None:
    required_splits = {"dev", "test", "security", "regression"}
    supported_surfaces = {"qa", "chart_planner", "profile_narrative"}
    if not version or not required_splits.issubset({case.get("split") for case in cases}):
        raise ValueError("Fixture thiếu phiên bản hoặc split bắt buộc.")
    ids: set[str] = set()
    for case in cases:
        invalid = (
            not case.get("id") or case["id"] in ids or not isinstance(case.get("input"), dict)
            or not isinstance(case.get("expected"), dict) or not case.get("suite")
            or case.get("surface") not in supported_surfaces
        )
        if invalid:
            raise ValueError(f"Case không hợp lệ: {case}")
        serialized = json.dumps(case, ensure_ascii=False).casefold()
        if any(value in serialized for value in ("workspace_id", "actor_user_id", "bearer ")):
            raise ValueError(f"Fixture chứa định danh hoặc credential: {case['id']}")
        ids.add(case["id"])


def mock_output(case: dict[str, Any]) -> dict[str, Any]:
    """Controlled output used only to test evaluator wiring, never a model."""

    expected = case["expected"]
    if case["surface"] == "chart_planner":
        columns = expected["plan_allowed_columns"]
        time_column = next((value for value in columns if value.endswith(("date", "month", "week"))), None)
        measure = next((value for value in columns if value not in {time_column, "region", "channel"}), columns[0])
        return {
            "status_code": 200,
            "body": {
                "question": case["input"]["question"],
                "problem": "trend",
                "algorithm": expected.get("aggregation", "sum"),
                "chart_type": expected.get("chart_types", ["line"])[0],
                "source_columns": columns,
                "query": {
                    "analysis_kind": expected["plan_allowed_analysis_kinds"][0],
                    "aggregate": expected.get("aggregation", "sum"),
                    "column": measure,
                    "dimensions": [time_column] if time_column else [],
                    "filters": [],
                    "time_grain": expected.get("time_grain"),
                    "bins": 12, "forecast_horizon": 6, "season_length": 12,
                    "confidence_level": 0.95, "history_limit": 500, "limit": 100, "sort": "asc",
                },
            },
        }
    answer = "Không có đủ bằng chứng trong Profile Run để kết luận."
    if expected.get("answer_any_of"):
        answer = f"{expected['answer_any_of'][0]} — phản hồi synthetic."
    if "numeric_reference" in expected:
        answer = f"{answer} {expected['numeric_reference']} {expected.get('unit', '')}".strip()
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
            "sources": [{
                "type": "tool", "tool": expected.get("required_tool", "get_column_profile"),
                "args": {}, "status": "completed", "profile_run_id": "synthetic-profile",
            }] if expected.get("requires_evidence") else [],
            "is_approximate": expected.get("is_approximate", False),
            "evidence_status": expected.get("evidence_status", "verified" if expected.get("requires_evidence") else "no_evidence"),
        },
    }


async def api_target(case: dict[str, Any], base_url: str, headers: dict[str, str], profile_run_id: str, request_timeout: float) -> dict[str, Any]:
    """Call a supported surface, retaining only output and coarse latency."""

    if case["surface"] == "qa":
        method, path, payload = "POST", "/qa", {"profile_run_id": profile_run_id, "question": case["input"]["question"], "stream": False}
    elif case["surface"] == "chart_planner":
        method, path, payload = "POST", f"/profile/{profile_run_id}/charts/auto-plan", {"question": case["input"]["question"]}
    elif case["surface"] == "profile_narrative":
        method, path, payload = "GET", f"/profile/{profile_run_id}/report", None
    else:
        return {"status_code": 422, "body": {"detail": "unsupported_evaluation_surface"}}
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=request_timeout) as client:
            response = await client.request(method, f"{base_url.rstrip('/')}{path}", headers=headers, json=payload)
        try:
            body = response.json()
        except ValueError:
            body = {"detail": "response_not_json"}
        if case["surface"] == "profile_narrative" and response.is_success:
            body = {"answer": _profile_report_text(body)}
        return {"status_code": response.status_code, "body": body, "telemetry": {"latency_ms": round((time.perf_counter() - started) * 1000, 3)}}
    except httpx.TimeoutException:
        status, detail = 504, "evaluation_target_timeout"
    except httpx.HTTPError:
        status, detail = 502, "evaluation_target_transport_error"
    return {"status_code": status, "body": {"detail": detail}, "telemetry": {"latency_ms": round((time.perf_counter() - started) * 1000, 3)}}


def _profile_report_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("narrative_report", "summary", "text", "content"):
            if value.get(key):
                return _profile_report_text(value[key])
    if isinstance(value, list):
        return next((text for item in value if (text := _profile_report_text(item))), "")
    return ""


def _git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return "not_available"


def _load_gates() -> dict[str, Any]:
    return json.loads(GATES.read_text(encoding="utf-8"))


def evaluate_release_gates(scorecard: dict[str, Any], gates: dict[str, Any]) -> list[dict[str, Any]]:
    """Do not gate a controlled mock result as if it were a product result."""

    if scorecard["runtime"] not in {"staging_synthetic_api", "local_synthetic_api"}:
        return [{"gate": "release_readiness", "status": "not_evaluated", "actual": None, "threshold": "staging_synthetic_api required"}]
    summary, metrics, telemetry = scorecard["summary"], scorecard["summary"]["metrics"], scorecard["summary"].get("telemetry", {})
    paths = {
        "latency_p95_ms": ("latency_ms", "p95"),
        "total_tokens_per_run": ("total_tokens", "total"),
        "estimated_cost_usd_per_run": ("estimated_cost_usd", "total"),
    }
    def value_of(key: str) -> Any:
        if key in metrics:
            return metrics[key]
        section, field = paths.get(key, (None, None))
        values = telemetry.get(section) or {}
        return values.get(field) if values.get("status") == "available" else None
    results: list[dict[str, Any]] = []
    for key, minimum in gates.get("minimum_rates", {}).items():
        actual = value_of(key)
        results.append({"gate": key, "status": "not_available" if actual is None else "pass" if actual >= minimum else "fail", "actual": actual, "threshold": minimum})
    for key, maximum in gates.get("maximum_values", {}).items():
        actual = value_of(key)
        results.append({"gate": key, "status": "not_available" if actual is None else "pass" if actual <= maximum else "fail", "actual": actual, "threshold": maximum})
    actual_critical = len(summary["critical_failures"])
    results.append({"gate": "critical_failures", "status": "pass" if actual_critical == 0 else "fail", "actual": actual_critical, "threshold": 0})
    return results


def compare_baseline(scorecard: dict[str, Any], path: str | None, gates: dict[str, Any]) -> list[dict[str, Any]]:
    if not path:
        return []
    baseline = json.loads(Path(path).read_text(encoding="utf-8"))
    baseline_scorecard = baseline.get("release_scorecard", baseline)
    current = scorecard["summary"]["metrics"]
    previous = baseline_scorecard.get("summary", {}).get("metrics", {})
    results: list[dict[str, Any]] = []
    for key, allowed_drop in gates.get("maximum_regressions", {}).items():
        before, after = previous.get(key), current.get(key)
        if not isinstance(before, (int, float)) or not isinstance(after, (int, float)):
            results.append({"metric": key, "status": "not_available", "before": before, "after": after})
            continue
        delta = round(after - before, 6)
        results.append({"metric": key, "status": "regression" if delta < -float(allowed_drop) else "pass", "before": before, "after": after, "delta": delta, "allowed_drop": allowed_drop})
    return results


def write_reports(scorecard: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path, markdown_path = output_dir / "latest_scorecard.json", output_dir / "latest_scorecard.md"
    json_path.write_text(json.dumps(scorecard, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = scorecard["summary"]
    interpretation = "This verifies evaluator wiring only; it is not an LLM-quality result." if scorecard["runtime"] == "offline_harness_contract" else "This is an observed staging result over synthetic-only data."
    lines = [
        "# VDaAgent Evaluation Scorecard", "",
        f"- Dataset: {scorecard['dataset_version']}", f"- Runtime: {scorecard['runtime']}",
        f"- Cases: {scorecard['case_count']}", f"- Git SHA: {scorecard.get('git_sha', 'not_available')}",
        "", "## Interpretation", "", interpretation, "", "## Metrics", "",
        "| Metric | Value |", "| --- | ---: |",
        *[f"| {key} | {value:.2%} |" for key, value in summary["metrics"].items()],
        "", "## Release gates", "", "| Gate | Status | Actual | Threshold |", "| --- | --- | ---: | ---: |",
        *[f"| {item['gate']} | {item['status'].upper()} | {item.get('actual', '—')} | {item.get('threshold', '—')} |" for item in scorecard["release_gates"]],
        "", "## Safe diagnostics", "",
        f"- Failed cases: {', '.join(summary['failed_cases']) or 'none'}",
        f"- Critical failures: {', '.join(summary['critical_failures']) or 'none'}",
        f"- Latency: {summary['telemetry']['latency_ms']['status']}",
        f"- Tokens: {summary['telemetry']['input_tokens']['status']}",
        f"- Cost: {summary['telemetry']['estimated_cost_usd']['status']}",
    ]
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


async def _run_staging(cases: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    headers = {"X-Workspace-Id": args.workspace_id, "Authorization": f"Bearer {args.bearer_token}"}
    semaphore = asyncio.Semaphore(args.concurrency)
    async def execute(case: dict[str, Any]) -> dict[str, Any]:
        profile_run_id = args.sample_profile_run_id if case.get("profile_variant") == "sample" else args.profile_run_id
        async with semaphore:
            output = await api_target(case, args.base_url, headers, profile_run_id, args.request_timeout)
        return {"id": case["id"], "scores": [asdict(item) for item in score_case(case, output)], "telemetry": output.get("telemetry", {})}
    return await asyncio.gather(*(execute(case) for case in cases))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--split", choices=["dev", "test", "security", "regression"])
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--offline", action="store_true")
    result.add_argument("--base-url")
    result.add_argument("--workspace-id")
    result.add_argument("--bearer-token", default=os.getenv("P170_EVAL_BEARER_TOKEN", ""))
    result.add_argument("--profile-run-id")
    result.add_argument("--sample-profile-run-id", help="Completed sampled synthetic Profile Run for cases marked profile_variant=sample.")
    result.add_argument("--concurrency", type=int, default=2)
    result.add_argument("--request-timeout", type=float, default=120.0)
    result.add_argument("--baseline", help="Comparable v2 staging JSON scorecard.")
    result.add_argument("--output-dir", default=str(PROJECT_ROOT / "evaluations" / "results"))
    result.add_argument("--no-write-reports", action="store_true")
    return result


def _make_scorecard(version: str, cases: list[dict[str, Any]], outcomes: list[dict[str, Any]], runtime: str) -> dict[str, Any]:
    diagnostics = [redact_diagnostics(case, [Score(**score) for score in outcome["scores"]]) for case, outcome in zip(cases, outcomes, strict=True)]
    return {
        "schema_version": "p170-evaluation-scorecard-v2", "dataset_version": version,
        "runtime": runtime, "generated_at": datetime.now(UTC).isoformat(), "git_sha": _git_sha(),
        "data_classification": "synthetic_only", "case_count": len(cases),
        "summary": summarize(outcomes), "diagnostics": diagnostics,
    }


def main() -> int:
    args = parser().parse_args()
    version, cases = load_cases(args.split)
    validate_fixture(version, cases)
    if args.dry_run:
        print(json.dumps({"status": "valid", "dataset_version": version, "case_count": len(cases), "network": False}, ensure_ascii=False))
        return 0
    if args.offline:
        outcomes = [{"id": case["id"], "scores": [asdict(score) for score in score_case(case, mock_output(case))], "telemetry": {}} for case in cases]
        scorecard = _make_scorecard(version, cases, outcomes, "offline_harness_contract")
    else:
        if not all((args.base_url, args.workspace_id, args.profile_run_id, args.bearer_token)):
            raise SystemExit("Staging mode cần --base-url, --workspace-id, --profile-run-id và P170_EVAL_BEARER_TOKEN; chỉ dùng Profile Run synthetic.")
        if any(case.get("profile_variant") == "sample" for case in cases) and not args.sample_profile_run_id:
            raise SystemExit("Fixture có sampled case; cần --sample-profile-run-id của Profile Run synthetic ở scan_mode=sample.")
        scorecard = _make_scorecard(version, cases, asyncio.run(_run_staging(cases, args)), "staging_synthetic_api")
    gates = _load_gates()
    scorecard["release_gates"] = evaluate_release_gates(scorecard, gates)
    scorecard["regression"] = compare_baseline(scorecard, args.baseline, gates)
    if not args.no_write_reports:
        json_path, markdown_path = write_reports(scorecard, Path(args.output_dir))
        scorecard["report_paths"] = {"json": str(json_path), "markdown": str(markdown_path)}
    print(json.dumps(scorecard, ensure_ascii=False))
    if scorecard["runtime"] == "offline_harness_contract":
        return int(bool(scorecard["summary"]["failed_cases"]))
    return int(any(item["status"] == "fail" for item in scorecard["release_gates"]) or any(item["status"] == "regression" for item in scorecard["regression"]))


if __name__ == "__main__":
    raise SystemExit(main())
