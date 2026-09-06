"""Tách khả năng quan sát tool khỏi độ chính xác routing/tool selection."""
from __future__ import annotations

from collections import Counter


def _tool_name(tool: dict) -> str:
    return str(tool.get("tool_name") or tool.get("tool") or "")


def _route_matches(expected: str, actual: str, result: dict) -> bool:
    """Treat a validated cache replay as its deterministic logical route.

    ``semantic_cache`` is an execution optimization, not a new intent route:
    cache entries can only be produced by ``deterministic_profile`` and every
    hit re-runs the aggregate tool plus evidence validator before release.
    """

    if expected.casefold() == actual:
        return True
    if expected.casefold() != "deterministic_profile" or actual != "semantic_cache":
        return False
    provenance = result.get("provenance") or {}
    return (
        result.get("status") == "OK"
        and bool(result.get("sources"))
        and provenance.get("evidence_status") == "verified"
    )


def _params_match(expected: dict, actual: dict) -> bool:
    """Compare tool parameters while respecting symmetric operations."""

    if not all(key in actual for key in expected):
        return False
    if {"column_a", "column_b"} <= expected.keys():
        if {actual.get("column_a"), actual.get("column_b")} != {
            expected.get("column_a"),
            expected.get("column_b"),
        }:
            return False
        return all(
            actual.get(key) == value
            for key, value in expected.items()
            if key not in {"column_a", "column_b"}
        )
    return all(actual.get(key) == value for key, value in expected.items())


def score(case: dict, result: dict, trace: dict | None = None) -> dict:
    expected_route = case.get("expected_route")
    trace = trace or {}
    route = str(trace.get("actual_route") or result.get("route") or "").casefold()
    source_tools = result.get("sources") or []
    trace_tools = trace.get("tools") or []
    # Public sources are emitted by the execution path itself and bind each
    # answer citation to one completed tool. Prefer them for exact selection;
    # LangSmith spans remain an observability fallback because asynchronous
    # ingestion can occasionally duplicate a child span.
    tools = source_tools or trace_tools or result.get("tool_calls") or []
    expected_tools = [str(item) for item in case.get("expected_tools") or []]
    observed_names = [_tool_name(tool) for tool in tools if isinstance(tool, dict) and _tool_name(tool)]
    tool_selection_eligible = bool(expected_tools) and bool(observed_names)
    tool_selection_pass = (
        Counter(observed_names) == Counter(expected_tools)
        if tool_selection_eligible
        else None
    )
    expected_params = case.get("expected_params") or {}
    source_args = next(
        (
            tool["args"]
            for tool in source_tools
            if isinstance(tool, dict)
            and _tool_name(tool) in expected_tools
            and isinstance(tool.get("args"), dict)
            and all(key in tool["args"] for key in expected_params)
        ),
        None,
    )
    parameter_accuracy_eligible = bool(expected_params) and source_args is not None
    parameter_accuracy_pass = (
        _params_match(expected_params, source_args)
        if parameter_accuracy_eligible else None
    )
    route_observable = bool(route)
    route_eligible = bool(expected_route) and route_observable
    parameter_observable = any(
        bool(tool.get("parameter_names"))
        for tool in (trace_tools or tools)
        if isinstance(tool, dict)
    )
    tool_success = all(str(tool.get("status") or "").casefold() in {"ok", "completed"} for tool in tools if isinstance(tool, dict)) if tools else None
    return {
        "case_id": case["case_id"],
        "status": "EVALUATED" if route_observable or tools else "NOT_EVALUATED",
        "tool_observed": bool(tools), "tool_observability_eligible": bool(case.get("requires_tool")),
        "tool_parameter_observed": parameter_observable, "tool_success": tool_success,
        "tool_selection_eligible": tool_selection_eligible,
        "tool_selection_pass": tool_selection_pass,
        "parameter_accuracy_eligible": parameter_accuracy_eligible,
        "parameter_accuracy_pass": parameter_accuracy_pass,
        "routing_eligible": route_eligible,
        "routing_pass": _route_matches(str(expected_route), route, result) if route_eligible else None,
        "route": route or None,
        "mo_ta": "Không tính routing/tool selection là FAIL khi public response không cung cấp đủ telemetry.",
    }
