"""Alembic, driven from code (boot step 2 in doc 16) and from tests.

These functions are blocking (the env runs its own event loop); from async code call them
with `asyncio.to_thread`. The URL is passed through `Config.attributes`, never through the
ini file, so passwords with `%` work and nothing is written to disk.
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

ALEMBIC_DIR = Path(__file__).resolve().parent.parent / "alembic"


def config(url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.attributes["database_url"] = url
    return cfg


def upgrade(url: str, revision: str = "head") -> None:
    command.upgrade(config(url), revision)


def downgrade(url: str, revision: str) -> None:
    command.downgrade(config(url), revision)
