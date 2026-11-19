"""Optional uv cache warm-up, `make warm-cache` (doc 11 "uv cache warm-up").

The image ships no preset packages; `prewarm.py warm` fills a cache with hashes so that the
project-mode `uv add` of provisioning reuses it. These tests use a throwaway cache and a tiny
package, never the shared `/data/folders/.uv-cache`.
"""

from __future__ import annotations

import os
import subprocess
import sys

PREWARM = "/opt/warm/prewarm.py"
PROJECT = (
    '[project]\nname = "agent"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n'
    "dependencies = []\n\n[tool.uv]\npackage = false\n"
)


def _prewarm(*args, env):
    return subprocess.run([sys.executable, PREWARM, *args], capture_output=True, text=True, env=env)


def test_list_reads_every_seed_file_and_glob(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    (tmp_path / "a" / "presets.yaml").write_text('- id: x\n  packages: ["pandas>=2.2", "idna"]\n')
    (tmp_path / "b" / "presets.yaml").write_text('- id: y\n  packages: ["idna", "httpx>=0.27"]\n')
    r = _prewarm("list", str(tmp_path / "*" / "presets.yaml"), env=dict(os.environ))
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == ["pandas>=2.2", "idna", "httpx>=0.27"]  # deduplicated, in order


def test_warm_makes_an_offline_project_uv_add_work(tmp_path):
    seeds = tmp_path / "library_presets.yaml"
    seeds.write_text('- id: tiny\n  packages: ["idna==3.10"]\n')
    env = {**os.environ, "UV_CACHE_DIR": str(tmp_path / "cache")}

    before = _prewarm("status", str(seeds), env=env)
    assert before.returncode == 0 and "(1): incomplete" in before.stdout

    warm = _prewarm("warm", str(seeds), env=env)
    assert warm.returncode == 0, warm.stderr
    assert "(1): complete" in _prewarm("status", str(seeds), env=env).stdout
    assert _prewarm("warm", str(seeds), env=env).returncode == 0  # safe to repeat

    project = tmp_path / "agent"
    project.mkdir()
    (project / "pyproject.toml").write_text(PROJECT)
    add = subprocess.run(
        ["uv", "add", "--offline", "idna==3.10"],
        cwd=project,
        capture_output=True,
        text=True,
        env=env,
    )
    assert add.returncode == 0, add.stderr  # provisioning's install path, from the warm cache
    assert not list(tmp_path.glob(".warm-*"))  # the throwaway venv is gone
