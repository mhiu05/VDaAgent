"""Per-exec filesystem isolation with Landlock (doc 11 "Isolation level").

Every user's agent folders live in one volume, owned by one uid, so file permissions can't
keep agents apart. Each exec process therefore restricts itself, after fork and before it runs
the agent's code, to:

- its own agent folder, the shared uv cache, `/tmp` and `/dev/shm`: read and write;
- the system and runtime trees (`/usr`, `/lib*`, `/bin`, `/sbin`, `/etc`, `/opt`, `/proc`,
  `/sys`, `/var/cache`): read and execute;
- `/dev`: read and write device files (`/dev/null`, `/dev/urandom`).

Nothing else is reachable: not the folders root (no listing other users), not another
agent's folder, not `/domains` (credentials reach the code only as environment variables, read
by execd before the sandbox applies). Landlock is unprivileged and inherited by every child
process; execd itself stays unrestricted, so it still loads `.env.d` and takes git snapshots.

Landlock needs Linux ≥ 5.13 with `landlock` among the active LSMs; `abi()` returns 0 when it
is missing. Standard library only (`ctypes`): the syscall numbers are the same on every
architecture.
"""

from __future__ import annotations

import ctypes
import os
from pathlib import Path

_SYS_CREATE_RULESET, _SYS_ADD_RULE, _SYS_RESTRICT_SELF = 444, 445, 446
_CREATE_RULESET_VERSION = 1
_RULE_PATH_BENEATH = 1
_PR_SET_NO_NEW_PRIVS = 38

EXECUTE, WRITE_FILE, READ_FILE, READ_DIR = 1 << 0, 1 << 1, 1 << 2, 1 << 3
REFER, TRUNCATE, IOCTL_DEV = 1 << 13, 1 << 14, 1 << 15
_V1_ALL = (1 << 13) - 1  # EXECUTE .. MAKE_SYM

READ = EXECUTE | READ_FILE | READ_DIR
DEVICES = READ_FILE | WRITE_FILE | READ_DIR | IOCTL_DEV

SYSTEM_READ = ("/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc", "/opt", "/proc", "/sys")
SYSTEM_READ += ("/var/cache",)

_libc = ctypes.CDLL(None, use_errno=True)


class _RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64)]


class _PathBeneath(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]


class LandlockError(OSError):
    pass


def abi() -> int:
    """The kernel's Landlock ABI version, 0 when Landlock is unavailable."""
    version = _libc.syscall(
        _SYS_CREATE_RULESET, None, ctypes.c_size_t(0), ctypes.c_uint32(_CREATE_RULESET_VERSION)
    )
    return max(version, 0)


def handled(version: int) -> int:
    """Every filesystem right this ABI knows: whatever isn't granted below is denied."""
    rights = _V1_ALL
    if version >= 2:
        rights |= REFER
    if version >= 3:
        rights |= TRUNCATE
    if version >= 5:
        rights |= IOCTL_DEV
    return rights


def rules(folder: Path, cache_dir: Path | None) -> list[tuple[str, str]]:
    """(path, "rw" | "ro" | "dev") for one exec, before filtering out missing paths."""
    out = [(str(folder), "rw"), ("/tmp", "rw"), ("/dev/shm", "rw"), ("/dev", "dev")]
    if cache_dir is not None:
        out.append((str(cache_dir), "rw"))
    out += [(p, "ro") for p in SYSTEM_READ]
    return out


def ruleset(folder: Path, cache_dir: Path | None, version: int) -> int:
    """Build the ruleset in the parent; returns its fd (pass it to `restrict`, then close it)."""
    every = handled(version)
    grant = {"rw": every, "ro": READ & every, "dev": DEVICES & every}
    attr = _RulesetAttr(every)
    fd = _libc.syscall(_SYS_CREATE_RULESET, ctypes.byref(attr), ctypes.sizeof(attr), 0)
    if fd < 0:
        raise LandlockError(ctypes.get_errno(), "landlock_create_ruleset failed")
    try:
        for path, kind in rules(folder, cache_dir):
            try:
                parent = os.open(path, os.O_PATH | os.O_CLOEXEC)
            except FileNotFoundError:
                continue  # e.g. no /lib64 on this image
            try:
                rule = _PathBeneath(grant[kind], parent)
                if _libc.syscall(_SYS_ADD_RULE, fd, _RULE_PATH_BENEATH, ctypes.byref(rule), 0):
                    raise LandlockError(ctypes.get_errno(), f"landlock_add_rule {path} failed")
            finally:
                os.close(parent)
    except BaseException:
        os.close(fd)
        raise
    return fd


def restrict(fd: int) -> None:
    """In the child (preexec): no new privileges, then enforce the ruleset on this process."""
    if _libc.prctl(_PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0):
        raise LandlockError(ctypes.get_errno(), "prctl(PR_SET_NO_NEW_PRIVS) failed")
    if _libc.syscall(_SYS_RESTRICT_SELF, fd, 0):
        raise LandlockError(ctypes.get_errno(), "landlock_restrict_self failed")
