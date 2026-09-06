"""Extract privacy-safe LangSmith metadata and map it by exact agent_run_id."""
from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from common import RUNS, publish_alias, read_jsonl, run_dir, stage_status, utc_now, write_json, write_jsonl


def _to_utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _chunks(start: datetime, end: datetime, minutes: int = 5) -> list[tuple[datetime, datetime]]:
    output, cursor = [], start
    while cursor < end:
        next_cursor = min(cursor + timedelta(minutes=minutes), end)
        output.append((cursor, next_cursor))
        cursor = next_cursor
    return output


def _metadata(run: Any) -> dict[str, Any]:
    extra = run.extra if isinstance(getattr(run, "extra", None), dict) else {}
    value = extra.get("metadata")
    return value if isinstance(value, dict) else {}


def _safe_tools(runs: list[Any]) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    for run in runs:
        if str(getattr(run, "run_type", "")) != "tool":
            continue
        metadata = _metadata(run)
        parameter_names = metadata.get("parameter_names")
        if not isinstance(parameter_names, list):
            inputs = run.inputs if isinstance(getattr(run, "inputs", None), dict) else {}
            parameter_names = sorted(str(key) for key in inputs)
        tools.append({
            "tool_name": str(metadata.get("tool_name") or getattr(run, "name", "")).removeprefix("tool."),
            "status": str(metadata.get("tool_status") or ("failed" if getattr(run, "error", None) else "completed")),
            "parameter_names": sorted(str(value) for value in parameter_names),
            "parameter_values_observed": False,
        })
    return tools


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    directory = run_dir(args.run_id)
    mapping_path = directory / "langsmith_trace_mapping.json"
    contexts_path = directory / "retrieval_contexts.jsonl"
    stage_status(directory, "trace", "RUNNING")
    try:
        backend = Path(__file__).resolve().parents[2] / "backend"
        sys.path.insert(0, str(backend))
        from langsmith import Client
        from src.config import get_settings

        settings = get_settings()
        raw = read_jsonl(directory / "raw_results.jsonl")
        normalized = read_jsonl(directory / "normalized_results.jsonl")
        if not (settings.langsmith_tracing and settings.langsmith_api_key and raw):
            raise RuntimeError("LangSmith or the selected raw run is unavailable.")
        response_by_agent_id = {
            str(row["agent_run_id"]).replace("-", ""): row
            for row in normalized if row.get("agent_run_id")
        }
        if not response_by_agent_id:
            raise RuntimeError("No agent_run_id was observable in the selected run.")
        start_times, end_times = [], []
        for row in raw:
            ended = datetime.fromisoformat(row["timestamp"])
            latency = float((row.get("telemetry") or {}).get("total_latency_ms") or 0)
            start_times.append(ended - timedelta(milliseconds=latency))
            end_times.append(ended)
        client = Client(api_url=settings.langsmith_endpoint, api_key=settings.langsmith_api_key)
        observed: dict[str, Any] = {}
        for start, end in _chunks(min(start_times) - timedelta(minutes=1), max(end_times) + timedelta(minutes=1)):
            query = f'and(gte(start_time, "{_to_utc(start)}"), lt(start_time, "{_to_utc(end)}"))'
            for run in client.list_runs(project_name=settings.langsmith_project_name, filter=query, limit=100):
                observed[str(run.id)] = run
        children: dict[str, list[Any]] = defaultdict(list)
        roots: dict[str, Any] = {}
        for run in observed.values():
            trace_id = str(getattr(run, "trace_id", "")).replace("-", "")
            if getattr(run, "parent_run_id", None):
                children[trace_id].append(run)
            else:
                roots[trace_id] = run
        mapped: list[dict[str, Any]] = []
        for agent_id, response in response_by_agent_id.items():
            root = roots.get(agent_id)
            if root is None:
                continue
            tools = _safe_tools(children.get(agent_id, []))
            duration_ms = None
            if root.start_time and root.end_time:
                duration_ms = round((root.end_time - root.start_time).total_seconds() * 1000, 3)
            mapped.append({
                "case_id": response.get("case_id"), "attempt": response.get("attempt"),
                "agent_run_id": response.get("agent_run_id"), "trace_id": str(root.trace_id),
                "trace_status": "failed" if root.error else "completed", "duration_ms": duration_ms,
                "actual_route": response.get("route"), "tools": tools, "tool_count": len(tools),
                "retrieved_context_observable": False,
            })
        tool_events = [tool for item in mapped for tool in item["tools"]]
        payload = {
            "language": "vi-VN", "run_id": args.run_id, "status": "EVALUATED",
            "project": settings.langsmith_project_name, "data_mode": settings.langsmith_data_mode,
            "root_trace_count_observed": len(roots), "raw_agent_run_id_count": len(response_by_agent_id),
            "exact_case_trace_mapping_count": len(mapped),
            "exact_case_trace_mapping_coverage": round(len(mapped) / len(response_by_agent_id), 6),
            "mapping_status": "EXACT_AGENT_RUN_ID_MAPPING",
            "reason": "Root trace ID equals agent_run_id; no timestamp correlation is used.",
            "retrieval_contexts_observable": False,
            "tool_params_observable": any(tool["parameter_names"] for tool in tool_events),
            "tool_events_observed": len(tool_events),
            "tool_names_observed": dict(sorted(Counter(tool["tool_name"] for tool in tool_events).items())),
            "route_observable_count": sum(bool(item["actual_route"]) for item in mapped),
            "mapped_records": mapped, "timestamp": utc_now(),
        }
        write_json(mapping_path, payload)
        write_jsonl(contexts_path, [])
        stage_status(directory, "trace", "COMPLETED", exit_code=0, mapped=len(mapped))
    except Exception as exc:
        write_json(mapping_path, {
            "language": "vi-VN", "run_id": args.run_id, "status": "FAILED",
            "reason": type(exc).__name__,
            "safe_detail": "Trace metadata could not be fetched; no secret or raw payload was stored.",
            "timestamp": utc_now(),
        })
        write_jsonl(contexts_path, [])
        stage_status(directory, "trace", "FAILED", exit_code=1, reason=type(exc).__name__)
    publish_alias(mapping_path, RUNS / mapping_path.name)
    publish_alias(contexts_path, RUNS / contexts_path.name)


if __name__ == "__main__":
    main()
