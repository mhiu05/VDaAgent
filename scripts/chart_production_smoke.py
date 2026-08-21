"""Run the bounded chart workflow against one real production Profile Run.

This smoke test is intentionally explicit: it requires existing authorized IDs,
does not upload data, never prints rows, and reports only execution IDs/hashes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from uuid import uuid4


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-run-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--actor-user-id", required=True)
    parser.add_argument(
        "--enable-feature-for-smoke",
        action="store_true",
        help="Enable Command Center only in this process when the deployed flag is off.",
    )
    parser.add_argument("--skip-llm", action="store_true")
    parser.add_argument("--skip-pin", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    if args.enable_feature_for_smoke:
        os.environ["UX_COMMAND_CENTER_ENABLED"] = "true"
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "backend"))

    from src.agents.runtime.trace import (
        ExecutionContext,
        complete_agent_run,
        execution_scope,
        invoke_model,
        start_agent_run,
    )
    from src.mcp_server import (
        _quick_context,
        preview_chart_plan,
        promote_chart_plan,
    )
    from src.services.llm import get_llm, llm_available
    from src.services.report_draft_repository import (
        ReportDraftRepository,
    )
    from src.services.repository import get_repository

    repository = get_repository()
    run = repository.get_profile_run(
        args.profile_run_id, workspace_id=args.workspace_id
    )
    membership = repository.get_membership(args.workspace_id, args.actor_user_id)
    if not run or run.get("status") != "completed":
        raise RuntimeError(
            "Profile Run is missing, outside the workspace, or incomplete."
        )
    if not membership or membership.get("status") != "active":
        raise RuntimeError("Actor does not have an active workspace membership.")

    semantic = _quick_context(args.profile_run_id, repository)
    dimensions = list(semantic["dimensions"])
    measures = list(semantic["measures"])
    if len(dimensions) < 2 or len(measures) < 2:
        raise RuntimeError(
            "Smoke test needs at least two safe dimensions and measures."
        )
    stats = repository.get_column_stats(args.profile_run_id)
    low_cardinality = next(
        (
            name for name in dimensions
            if 1 <= int((stats.get(name) or {}).get("cardinality") or 0) <= 12
        ),
        None,
    )
    charts = [
        {
            "chart_type": "histogram",
            "x_column": measures[0],
            "aggregation": "count",
            "bins": 12,
            "title": "Production histogram smoke",
        },
        {
            "chart_type": "scatter",
            "x_column": measures[0],
            "y_column": measures[1],
            "aggregation": "count",
            "bins": 12,
            "title": "Production scatter density smoke",
        },
        {
            "chart_type": "box",
            "x_column": dimensions[0],
            "y_column": measures[0],
            "aggregation": "median",
            "title": "Production box summary smoke",
        },
        {
            "chart_type": "heatmap",
            "x_column": dimensions[0],
            "y_column": dimensions[1],
            "aggregation": "count",
            "title": "Production heatmap smoke",
        },
        {
            "chart_type": "missing_bar",
            "aggregation": "count",
            "title": "Production missing value bar smoke",
        },
        {
            "chart_type": "missing_heatmap",
            "aggregation": "count",
            "title": "Production missing value heatmap smoke",
        },
        {
            "chart_type": "correlation_heatmap",
            "aggregation": "count",
            "title": "Production correlation heatmap smoke",
        },
        {
            "chart_type": "cardinality",
            "aggregation": "count",
            "title": "Production cardinality smoke",
        },
        {
            "chart_type": "violin",
            "x_column": dimensions[0],
            "y_column": measures[0],
            "aggregation": "count",
            "bins": 16,
            "title": "Production violin density smoke",
        },
        {
            "chart_type": "outlier",
            "aggregation": "count",
            "title": "Production outlier smoke",
        },
    ]
    if low_cardinality:
        charts.append(
            {
                "chart_type": "donut",
                "x_column": low_cardinality,
                "y_column": measures[0],
                "aggregation": "sum",
                "title": "Production donut share smoke",
            }
        )
    request_id = f"chart-smoke-{uuid4().hex}"
    preview = preview_chart_plan(
        args.profile_run_id,
        args.workspace_id,
        args.actor_user_id,
        charts,
        request_id,
    )
    if preview.get("status") != "preview_ready" or preview.get("errors"):
        raise RuntimeError(f"Preview failed: {preview.get('errors') or preview}")
    preview_ids = [item["execution"]["id"] for item in preview["executions"]]
    official = promote_chart_plan(
        args.profile_run_id,
        args.workspace_id,
        args.actor_user_id,
        preview_ids,
        preview["context_version_id"],
    )
    if official.get("status") != "official_ready" or official.get("errors"):
        raise RuntimeError(
            f"Official promotion failed: {official.get('errors') or official}"
        )
    official_executions = [item["execution"] for item in official["executions"]]

    insight = ""
    agent_run_id: str | None = None
    if not args.skip_llm:
        if not llm_available():
            raise RuntimeError("LLM is not configured.")
        selected = official_executions[0]
        agent_run_id = start_agent_run(
            workspace_id=args.workspace_id,
            actor_user_id=args.actor_user_id,
            run_type="chart_insight",
            resource_bindings={
                "profile_run_id": args.profile_run_id,
                "analysis_execution_id": selected["id"],
                "context_version_id": preview["context_version_id"],
            },
            request_for_hash={"kind": "chart_production_smoke"},
        )
        if not agent_run_id:
            raise RuntimeError(
                "Agent trace is disabled; cannot verify a pinnable insight."
            )
        evidence = {
            "query_summary": selected.get("query_summary"),
            "query_spec": selected["query_spec"],
            "result": selected["result"],
            "result_hash": selected["result_hash"],
            "limitations": selected.get("limitations") or [],
        }
        prompt = (
            "Viết insight tiếng Việt ngắn gọn cho biểu đồ dựa duy nhất vào "
            "Official aggregate evidence sau. Nêu giới hạn, không suy diễn nhân quả:\n"
            + json.dumps(evidence, ensure_ascii=False, default=str)
        )
        trace_context = ExecutionContext(
            agent_run_id=agent_run_id,
            workspace_id=args.workspace_id,
            actor_user_id=args.actor_user_id,
            resource_bindings={
                "profile_run_id": args.profile_run_id,
                "analysis_execution_id": selected["id"],
            },
        )
        with execution_scope(trace_context):
            response = invoke_model(
                get_llm(),
                prompt,
                prompt_id="chart_insight",
            )
        insight = str(getattr(response, "content", "")).strip()
        if not insight:
            raise RuntimeError("LLM returned an empty chart insight.")
        complete_agent_run(agent_run_id, workspace_id=args.workspace_id)

    report_id: str | None = None
    if not args.skip_pin:
        if not insight or not agent_run_id:
            raise RuntimeError("Pin smoke requires a verified LLM insight.")
        selected = official_executions[0]
        drafts = ReportDraftRepository(repository)
        draft = drafts.get_or_create(
            args.workspace_id, args.profile_run_id, args.actor_user_id
        )
        pinned = drafts.pin_item(
            draft["id"],
            args.workspace_id,
            args.actor_user_id,
            {
                "item_type": "chart",
                "query_execution_id": selected["id"],
                "agent_run_id": agent_run_id,
                "title": "Production chart smoke",
                "chart_spec": {
                    "chart_type": "histogram",
                    "renderer": "native-svg",
                },
                "content": {"insight": insight, "insight_reviewed": True},
            },
            idempotency_key=request_id,
        )
        report_id = pinned["id"]

    print(
        json.dumps(
            {
                "status": "passed",
                "profile_run_id": args.profile_run_id,
                "preview_execution_ids": preview_ids,
                "official": [
                    {
                        "id": item["id"],
                        "result_hash": item["result_hash"],
                        "analysis_kind": item["query_spec"].get("analysis_kind"),
                    }
                    for item in official_executions
                ],
                "llm_verified": bool(insight),
                "insight_characters": len(insight),
                "agent_run_id": agent_run_id,
                "report_id": report_id,
            },
            ensure_ascii=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
