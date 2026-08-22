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

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / "fixtures" / "v1.json"
CANARY = "PII_CANARY_9471"


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


def mock_output(case: dict[str, Any]) -> dict[str, Any]:
    expected = case["expected"]
    if case["surface"] == "chart_planner":
        return {
            "status_code": 200,
            "body": {
                "plan": {
                    "columns": expected["plan_allowed_columns"],
                    "analysis_kind": expected["plan_allowed_analysis_kinds"][0],
                }
            },
        }
    answer = "Không có đủ bằng chứng."
    if expected.get("answer_any_of"):
        answer = f"{expected['answer_any_of'][0]} phản hồi synthetic."
    if "numeric_reference" in expected:
        answer = f"{expected['numeric_reference']}{expected.get('unit', '')}"
    return {
        "status_code": 200,
        "body": {
            "answer": answer,
            "question_type": expected.get("question_type"),
            "sources": [{"id": "synthetic"}]
            if expected.get("requires_evidence")
            else [],
            "is_approximate": expected.get("is_approximate", False),
            "tool_call_count": 1,
        },
    }


async def api_target(
    inputs: dict[str, Any], base_url: str, headers: dict[str, str], profile_run_id: str
) -> dict[str, Any]:
    if inputs["surface"] == "qa":
        path, payload = (
            "/qa",
            {"profile_run_id": profile_run_id, "question": inputs["input"]["question"]},
        )
    elif inputs["surface"] == "chart_planner":
        path, payload = (
            f"/profile/{profile_run_id}/charts/auto-plan",
            {"question": inputs["input"]["question"]},
        )
    else:
        return {"status_code": 422, "body": {"detail": "surface_chưa_bật_live"}}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{base_url.rstrip('/')}{path}", headers=headers, json=payload
        )
        try:
            return {"status_code": response.status_code, "body": response.json()}
        except ValueError:
            return {
                "status_code": response.status_code,
                "body": {"detail": "phản_hồi_không_phải_json"},
            }


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT.parent, text=True
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
        return await api_target(inputs, args.base_url, headers, args.profile_run_id)

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
    results = aevaluate(
        target,
        data=cases,
        evaluators=[hard_gate],
        metadata=metadata,
        experiment_prefix="p170-evidence-first",
        max_concurrency=args.concurrency,
        num_repetitions=args.repetitions,
        client=Client(),
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
    return result


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
                "scores": [
                    asdict(score) for score in score_case(case, mock_output(case))
                ],
            }
            for case in cases
        ]
        failed = [
            item["id"]
            for item in outcomes
            if not hard_gate_pass(Score(**score) for score in item["scores"])
        ]
        print(
            json.dumps(
                {
                    "dataset_version": version,
                    "case_count": len(cases),
                    "hard_gate_failed": failed,
                },
                ensure_ascii=False,
            )
        )
        return int(bool(failed))
    if not all([args.base_url, args.workspace_id, args.profile_run_id]):
        raise SystemExit(
            "Chế độ live cần --base-url, --workspace-id và --profile-run-id của dữ liệu staging synthetic."
        )
    asyncio.run(run_live(cases, args, version))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
