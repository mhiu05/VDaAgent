"""Preflight: `make check` (also run by `make up`) and step 1 of the api boot (doc 16).

Reports missing keys and invalid domains by key or file name, never by value. The one
exception is the model line: model ids and the provider URL are configuration, not secrets.
Exits non-zero only when a required platform key is missing; an invalid domain only
makes that domain `unavailable`.

Domains now live in Postgres (doc 12), so checking them needs a live connection — unlike the
platform-key checks, which are pure `.env` reads. `run()` takes an optional connection; without
one (e.g. `make check` before the stack has ever been `make up`'d) domains are reported as
unchecked rather than failing the whole command.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncConnection

from backend.domains.validate import DomainResult, validate_domains
from backend.settings import Settings

REQUIRED_KEYS = (
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "POSTGRES_PASSWORD",
    "SESSION_SECRET",
    "EXECD_TOKEN",
)
# Missing → tracing is off (doc 13); reported, but not fatal.
OPTIONAL_KEYS = ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
# Keys people put in `.env` that the stack never reads, and what to use instead.
IGNORED_KEYS = {
    "OPENAI_API_KEY": "OPENROUTER_API_KEY",
    "OPENAI_BASE_URL": "OPENROUTER_BASE_URL",
    "DOCKER_HOST": "your shell, not .env (GUIDE.md: Docker on another machine)",
}


def missing_platform_keys(settings: Settings) -> list[str]:
    required = list(REQUIRED_KEYS)
    if settings.MODEL_BACKEND == "openrouter":
        required.append("OPENROUTER_API_KEY")
    return sorted(k for k in required if not settings.is_set(k))


def ignored_keys(environ: Mapping[str, str]) -> list[str]:
    return sorted(k for k in IGNORED_KEYS if environ.get(k, "").strip())


def model_summary(settings: Settings) -> str:
    """Model ids and the provider URL: configuration, not secrets."""
    return (
        f"backend={settings.MODEL_BACKEND} base_url={settings.OPENROUTER_BASE_URL} "
        f"agent={settings.AGENT_MODEL} compaction={settings.COMPACTION_MODEL} "
        f"jev={settings.JEV_MODEL}"
    )


async def check_domains(
    conn: AsyncConnection, platform_dir: Path | None = None, domains_dir: Path | None = None
) -> list[DomainResult]:
    return await validate_domains(conn, platform_dir, domains_dir)


@dataclass
class Report:
    missing: list[str]
    optional_missing: list[str]
    domains: list[DomainResult] = field(default_factory=list)
    domains_checked: bool = True
    model: str = ""
    ignored: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing

    def lines(self) -> list[str]:
        out = []
        if self.missing:
            out.append("platform: missing required keys: " + ", ".join(self.missing))
        else:
            out.append("platform: ok")
        if self.optional_missing:
            out.append(
                "platform: optional keys not set (tracing off): " + ", ".join(self.optional_missing)
            )
        for key in self.ignored:
            out.append(f"platform: {key} is set but not used; use {IGNORED_KEYS[key]}")
        if self.model:
            out.append(f"model: {self.model}")
        if not self.domains_checked:
            out.append("domains: database unreachable, skipped (run again after `make up`)")
        for d in self.domains:
            out.append(f"domain {d.domain_id}: {'available' if d.available else 'unavailable'}")
            out.extend(f"  - {reason}" for reason in d.reasons)
        return out


async def run(
    settings: Settings,
    conn: AsyncConnection | None = None,
    environ: Mapping[str, str] | None = None,
) -> Report:
    domains: list[DomainResult] = []
    domains_checked = False
    if conn is not None:
        domains_dir = Path(settings.DOMAINS_DIR) if settings.DOMAINS_DIR else None
        domains = await check_domains(conn, Path(settings.PLATFORM_DIR), domains_dir)
        domains_checked = True
    return Report(
        missing=missing_platform_keys(settings),
        optional_missing=[k for k in OPTIONAL_KEYS if not settings.is_set(k)],
        model=model_summary(settings),
        ignored=ignored_keys(os.environ if environ is None else environ),
        domains=domains,
        domains_checked=domains_checked,
    )


async def _run_cli() -> Report:
    """`make check`: best-effort domain check — only the stack's own Postgres, never crashes the
    command when it isn't reachable yet (e.g. before the first `make up`)."""
    settings = Settings()
    url = settings.DATABASE_URL.get_secret_value()
    if not url:
        return await run(settings)
    from sqlalchemy.pool import NullPool

    from backend.db.session import create_engine

    engine = create_engine(url, poolclass=NullPool)
    try:
        async with asyncio.timeout(5), engine.connect() as conn:
            return await run(settings, conn)
    except Exception:
        return await run(settings)
    finally:
        await engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    report = asyncio.run(_run_cli())
    print("\n".join(report.lines()))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
