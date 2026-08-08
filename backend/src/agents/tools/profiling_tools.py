"""Compatibility exports cho code cũ.

Tool đã được tách theo domain; module này giữ import path cũ để các integration
hoặc plugin hiện tại không bị hỏng.
"""

from src.agents.tools.core_profile_tools import get_run_metadata, get_stat, list_columns
from src.agents.tools.governance_tools import get_proposals, get_risk_warnings
from src.agents.tools.registry import STRUCTURED_TOOLS, run_tool
from src.agents.tools.statistics_tools import (
    get_correlation,
)
from src.agents.tools.test_tools import (
    get_test_results,
)

__all__ = [
    "STRUCTURED_TOOLS",
    "get_correlation",
    "get_proposals",
    "get_risk_warnings",
    "get_run_metadata",
    "get_stat",
    "get_test_results",
    "list_columns",
    "run_tool",
]
