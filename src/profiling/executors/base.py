"""Base executor contracts for profiling sources.

Executors hide where data comes from. API and service code can call the same
methods for an uploaded file today and database pushdown later.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from src.profiling.planner import ProfilePlan


class ProfileExecutor(ABC):
    @abstractmethod
    def profile_file(self, file_path: Path, source_name: str, plan: ProfilePlan) -> dict[str, Any]:
        raise NotImplementedError

