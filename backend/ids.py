"""Readable random ids: ULIDs with a kind prefix, for example `x_01J9Z…` for an exec (doc 02)."""

from __future__ import annotations

import os
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def ulid() -> str:
    """26 Crockford base32 characters: 48-bit milliseconds then 80 random bits."""
    value = (int(time.time() * 1000) << 80) | int.from_bytes(os.urandom(10), "big")
    return "".join(_CROCKFORD[(value >> shift) & 31] for shift in range(125, -1, -5))


def exec_id() -> str:
    return f"x_{ulid()}"


def trace_id() -> str:
    """A fresh 32-hex trace id per activation (doc 13)."""
    return os.urandom(16).hex()
