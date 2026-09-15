"""Regression coverage for the repository-root configuration contract."""

from __future__ import annotations

from pathlib import Path

import pytest

from src import config


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "src" / "backend"


@pytest.mark.parametrize("working_directory", (ROOT, BACKEND_ROOT))
def test_project_root_is_independent_of_local_working_directory(
    monkeypatch: pytest.MonkeyPatch, working_directory: Path
) -> None:
    """Local commands may start at the repository root or backend directory."""
    monkeypatch.chdir(working_directory)
    assert config._project_root_from_source(Path(config.__file__)) == ROOT
    assert config.PROJECT_ROOT == ROOT


def test_project_root_resolves_from_the_container_source_layout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The immutable image has the same contract beneath its ``/app`` root."""
    container_root = tmp_path / "app"
    source_file = container_root / "src" / "backend" / "src" / "config.py"
    source_file.parent.mkdir(parents=True)
    source_file.touch()
    for marker in ("README.md", "config.yaml", "alembic.ini"):
        (container_root / marker).touch()

    monkeypatch.chdir(container_root)
    assert config._project_root_from_source(source_file) == container_root


def test_project_root_discovery_rejects_incomplete_layout(tmp_path: Path) -> None:
    source_file = tmp_path / "src" / "backend" / "src" / "config.py"
    source_file.parent.mkdir(parents=True)
    source_file.touch()

    with pytest.raises(RuntimeError, match="Unable to locate the VDaAgent repository root"):
        config._project_root_from_source(source_file)
