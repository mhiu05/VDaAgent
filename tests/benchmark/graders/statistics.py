from __future__ import annotations

import math


def binomial_ci(passed: int, total: int) -> dict:
    if not total:
        return {"status": "NOT_EVALUATED"}
    p = passed / total
    z = 1.96
    z_squared = z**2
    denominator = 1 + z_squared / total
    center = (p + z_squared / (2 * total)) / denominator
    margin = (
        z
        * math.sqrt((p * (1 - p) + z_squared / (4 * total)) / total)
        / denominator
    )
    return {
        "n": total,
        "mean": round(p, 6),
        "std": round(math.sqrt(p * (1 - p)), 6),
        "ci95": [round(max(0, center - margin), 6), round(min(1, center + margin), 6)],
        "ci_method": "wilson_score_95",
    }
