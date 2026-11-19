"""The Makefile's startup contract (doc 16 "Makefile"): `make up` stays light — preset packages
are never downloaded by it — and `make demo-ready` is the optional one-command preparation that
warms the shared uv cache before starting the stack."""

from __future__ import annotations

import re
from pathlib import Path

MAKEFILE = Path(__file__).resolve().parents[3] / "Makefile"


def recipe(target: str) -> list[str]:
    """The recipe lines of `target`, with `@` prefixes stripped."""
    lines = MAKEFILE.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if re.match(rf"^{re.escape(target)}:", line))
    body = []
    for line in lines[start + 1 :]:
        if not line.startswith("\t"):
            break
        body.append(line.lstrip("\t").lstrip("@"))
    return body


def test_up_never_warms_the_cache():
    text = "\n".join(recipe("up"))
    assert "warm" not in text and "prewarm" not in text
    # `up` depends on `check` only, not on any warm-up target
    assert re.search(r"^up: check ##", MAKEFILE.read_text(encoding="utf-8"), re.M)


def test_demo_ready_runs_bootstrap_then_checks_cache_and_health():
    steps = [
        m.group(1)
        for line in recipe("demo-ready")
        if (m := re.search(r"\$\(MAKE\) --no-print-directory ([a-z-]+)", line))
    ]
    assert steps == ["up", "warm-cache-status", "health"]
    bootstrap = "\n".join(recipe("demo-bootstrap"))
    assert bootstrap.index("warm-cache") < bootstrap.index("seed-demo")
    text = "\n".join(recipe("demo-ready"))
    for destructive in ("down -v", "reset-dev", "seed-demo", "DROP"):
        assert destructive not in text


def test_reset_dev_warns_that_the_uv_cache_goes_too():
    text = MAKEFILE.read_text(encoding="utf-8")
    assert re.search(r"^reset-dev:.*uv cache", text, re.M)
    assert "make down, then make up" in "\n".join(recipe("reset-dev"))
