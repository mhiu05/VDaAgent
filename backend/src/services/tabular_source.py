"""Prepare CSV/TSV sources so DuckDB always receives UTF-8 text.

DuckDB rejects non-UTF-8 CSV input. Files exported by Excel on Windows or
supplied through Google Drive are often UTF-16 or a legacy Windows code page,
so normalize only those text sources in a temporary file.
"""

from __future__ import annotations

import codecs
import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

# pyrefly: ignore [missing-import]
from charset_normalizer import from_bytes

_TEXT_DELIMITED_SUFFIXES = frozenset({".csv", ".tsv"})
_UTF8_ENCODINGS = frozenset({"ascii", "utf8", "utf-8", "utf-8-sig"})
_SNIFF_BYTES = 256 * 1024


def _detect_encoding(path: Path) -> str:
    with path.open("rb") as source:
        sample = source.read(_SNIFF_BYTES)
    if not sample:
        return "utf-8"
    if sample.startswith(codecs.BOM_UTF8):
        return "utf-8-sig"
    if sample.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return "utf-16"
    try:
        sample.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass

    # Generic charset detectors commonly classify Vietnamese Windows-1258 as
    # Windows-1250 because their byte ranges overlap. Prefer the local export
    # encoding first; it also decodes standard Windows-1252 characters shared
    # by the two code pages correctly.
    try:
        sample.decode("cp1258")
        return "cp1258"
    except UnicodeDecodeError:
        pass

    detected = from_bytes(sample).best()
    if detected and detected.encoding:
        encoding = detected.encoding
        try:
            sample.decode(encoding)
            return encoding
        except (LookupError, UnicodeDecodeError):
            pass

    # These cover the remaining Western Windows CSV exports.
    for encoding in ("cp1252", "latin-1"):
        try:
            sample.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("Không xác định được bảng mã của CSV/TSV. Hãy lưu lại file dưới dạng UTF-8 rồi thử lại.")


@contextmanager
def utf8_tabular_source(path: Path) -> Iterator[Path]:
    """Yield a UTF-8 CSV/TSV path while keeping binary formats untouched."""
    if path.suffix.lower() not in _TEXT_DELIMITED_SUFFIXES:
        yield path
        return

    encoding = _detect_encoding(path)
    if encoding.lower().replace("_", "-") in _UTF8_ENCODINGS:
        yield path
        return

    fd, temporary_name = tempfile.mkstemp(prefix="p170-utf8-", suffix=path.suffix)
    temporary_path = Path(temporary_name)
    try:
        with (
            os.fdopen(fd, "w", encoding="utf-8", newline="") as target,
            path.open("r", encoding=encoding, errors="strict", newline="") as source,
        ):
            shutil.copyfileobj(source, target, length=1024 * 1024)
        yield temporary_path
    except UnicodeError as exc:
        raise ValueError(
            "Không thể chuyển CSV/TSV sang UTF-8. Hãy mở file bằng Excel và lưu lại với encoding UTF-8."
        ) from exc
    finally:
        temporary_path.unlink(missing_ok=True)


__all__ = ["utf8_tabular_source"]
