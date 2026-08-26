"""Registry and safe dispatcher for the read-only agent tool catalog."""

from __future__ import annotations

import logging
import time
from typing import Any

from src.agents.runtime.trace import record_tool_result
from src.agents.tools.context import _current_run_id
from src.agents.tools.core_profile_tools import CORE_PROFILE_TOOLS
from src.agents.tools.data_quality_tools import DATA_QUALITY_TOOLS
from src.agents.tools.drift_tools import DRIFT_TOOLS
from src.agents.tools.governance_tools import GOVERNANCE_TOOLS
from src.agents.tools.statistics_tools import STATISTICS_TOOLS
from src.agents.tools.test_tools import TEST_TOOLS
from src.agents.tools.math_tools import MATH_TOOLS
from src.config import get_settings
from src.services.security import get_audit

logger = logging.getLogger(__name__)

# Only this list is bound to an LLM.  Internal helpers/calculators must never
# accidentally become agent capabilities.
READ_ONLY_QA_TOOLS = [
    *CORE_PROFILE_TOOLS,
    *STATISTICS_TOOLS,
    *DATA_QUALITY_TOOLS,
    *GOVERNANCE_TOOLS,
    *TEST_TOOLS,
    *DRIFT_TOOLS,
    *MATH_TOOLS,
]
STRUCTURED_TOOLS = READ_ONLY_QA_TOOLS
INTERNAL_TOOLS: list[Any] = []
_TOOLS_BY_NAME = {item.name: item for item in READ_ONLY_QA_TOOLS}


def run_tool(
    name: str, args: dict[str, Any], profile_run_id: str | None = None
) -> dict[str, Any]:
    """Invoke a read-only tool inside an injected active-run scope."""
    tool_obj = _TOOLS_BY_NAME.get(name)
    if tool_obj is None:
        return {
            "tool": name,
            "profile_run_id": profile_run_id or "",
            "data": None,
            "evidence": [],
            "is_approximate": False,
            "limitations": [],
            "error_code": "invalid_argument",
            "error": "Unknown or non-read-only tool.",
        }
    if not profile_run_id:
        return {
            "tool": name,
            "profile_run_id": "",
            "data": None,
            "evidence": [],
            "is_approximate": False,
            "limitations": [],
            "error_code": "forbidden_scope",
            "error": "An active profile run is required.",
        }
    started = time.perf_counter()
    token = _current_run_id.set(profile_run_id)
    try:
        result = tool_obj.invoke(args)
    except (ValueError, TypeError) as exc:
        result = {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": None,
            "evidence": [],
            "is_approximate": False,
            "limitations": [],
            "error_code": "invalid_argument",
            "error": str(exc),
        }
    except Exception:
        logger.exception("Tool %s failed", name)
        result = {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": None,
            "evidence": [],
            "is_approximate": False,
            "limitations": [],
            "error_code": "internal_error",
            "error": "Tool execution failed.",
        }
    finally:
        _current_run_id.reset(token)
    if get_settings().security_audit_log:
        get_audit().log(
            "tool_call",
            tool=name,
            arg_names=sorted(args),
            profile_run_id=profile_run_id,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
            error_code=result.get("error_code"),
            result_size=len(str(result)),
        )
    # Runtime trace is an additive, redacted provenance ledger. It records
    # only bounded tool metadata/evidence and does not alter the legacy tool
    # envelope returned to the graph.
    record_tool_result(
        tool_name=name,
        args=args,
        result=result,
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
    return result


__all__ = ["INTERNAL_TOOLS", "READ_ONLY_QA_TOOLS", "STRUCTURED_TOOLS", "run_tool"]
