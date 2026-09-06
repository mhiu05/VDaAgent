from __future__ import annotations

from typing import Any


def score(case: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    if not case.get("expected_evidence", {}).get("required"):
        return {"case_id": case["case_id"], "status": "NOT_APPLICABLE", "pass": None}
    sources = result.get("sources") or []
    citations = result.get("citations") or []
    provenance = result.get("provenance") or {}
    bound = any(isinstance(item, dict) and (item.get("profile_run_id") or item.get("tool")) for item in sources) or bool(citations) or bool(provenance)
    return {"case_id": case["case_id"], "status": "EVALUATED", "pass": bool(bound), "source_count": len(sources), "citation_count": len(citations), "provenance_present": bool(provenance)}
