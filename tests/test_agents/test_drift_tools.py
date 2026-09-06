from __future__ import annotations

from typing import Any

from src.agents.tools.drift_tools import _supplemental_profile_findings


class _Repository:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def get_column_stats(self, run_id: str) -> dict[str, dict[str, Any]]:
        self.calls.append(run_id)
        return {
            "baseline": {
                "amount": {"median": 10.0},
                "unchanged": {"median": 5.0},
                "label": {
                    "median": None,
                    "top_k_values": [{"value": "Website", "count": 8}],
                },
            },
            "current": {
                "amount": {"median": 15.0},
                "unchanged": {"median": 5.0},
                "label": {
                    "median": None,
                    "top_k_values": [{"value": "Ứng dụng", "count": 9}],
                },
            },
        }[run_id]


def test_supplemental_medians_use_persisted_stats_and_deduplicate_reports() -> None:
    repository = _Repository()
    duplicate_reports = [
        {"profile_run_id_a": "baseline", "profile_run_id_b": "current"},
        {"profile_run_id_a": "baseline", "profile_run_id_b": "current"},
    ]

    findings = _supplemental_profile_findings(repository, duplicate_reports)

    assert repository.calls == ["baseline", "current"]
    assert findings == [
        {
            "column_name": "amount",
            "drift_type": "numeric_shift",
            "severity": "major",
            "metric": "median",
            "baseline_value": 10.0,
            "current_value": 15.0,
            "before": 10.0,
            "after": 15.0,
            "detail": "median changed from 10.0 to 15.0.",
        },
        {
            "column_name": "label",
            "drift_type": "distribution_snapshot",
            "severity": "informational",
            "metric": "top_category",
            "baseline_value": "Website",
            "current_value": "Ứng dụng",
            "before": "Website",
            "after": "Ứng dụng",
            "detail": (
                "top category was Website in the baseline and Ứng dụng in the "
                "current run."
            ),
        },
    ]
