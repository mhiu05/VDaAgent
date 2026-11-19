"""Report schema v1 validation (docs 14f, 19): a port of the frontend `decodeReportSchema`.

`validate_schema(value, report_id, version_id, evidence_ids)` returns the normalized schema
(identity filled in, unknown block kinds turned into `unsupported` blocks with a diagnostic,
fields outside the contract dropped) or raises `SchemaError` with the first problem. The frontend
decoder still runs on every read; this is the same rule set applied before storing.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DIMENSIONS = ("categorical", "temporal", "numeric")
SEMANTICS = ("comparison", "trend", "composition", "relationship", "matrix", "distribution")
MAX_DEPTH = 8


class SchemaError(ValueError):
    pass


def _fail(message: str) -> None:
    raise SchemaError(message)


def _obj(v: Any, what: str) -> dict:
    if not isinstance(v, dict):
        _fail(f"{what} must be an object")
    return v


def _str(v: Any, what: str) -> str:
    if not isinstance(v, str) or not v.strip():
        _fail(f"{what} must be a non-empty string")
    return v


def _arr(v: Any, what: str) -> list:
    if not isinstance(v, list):
        _fail(f"{what} must be an array")
    return v


def _num(v: Any, what: str) -> float | int | None:
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        _fail(f"{what} must be a finite number or null")
    return v


def _strings(v: Any, what: str) -> list[str]:
    return [_str(x, what) for x in _arr(v, what)]


def _optional(v: Any, what: str) -> str | None:
    return None if v is None else _str(v, what)


def valid_timezone(tz: str) -> bool:
    try:
        ZoneInfo(tz)
        return True
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return False


def valid_date(value: Any) -> bool:
    if not isinstance(value, str) or not DATE_RE.match(value):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def validate_range(start: str | None, end: str | None, timezone: str) -> None:
    if not valid_timezone(timezone):
        _fail(f"invalid timezone {timezone!r}")
    if (
        (start and not valid_date(start))
        or (end and not valid_date(end))
        or (start and end and start >= end)
    ):
        _fail("scope must be a valid [from, to) business-date interval")


def _chart(v: Any) -> dict:
    c = _obj(v, "chart")
    d = _obj(c.get("dimension"), "chart.dimension")
    if d.get("kind") not in DIMENSIONS:
        _fail(f"chart dimension kind must be one of {', '.join(DIMENSIONS)}")
    labels = []
    for x in _arr(c.get("labels"), "chart.labels"):
        if isinstance(x, str):
            labels.append(x)
        else:
            n = _num(x, "chart label")
            if n is None:
                _fail("chart labels must be strings or numbers")
            labels.append(n)
    series = []
    for s in _arr(c.get("series"), "chart.series"):
        s = _obj(s, "chart series")
        series.append(
            {
                "id": _str(s.get("id"), "series id"),
                "label": _str(s.get("label"), "series label"),
                "unit": _str(s.get("unit"), "series unit"),
                "values": [_num(x, "series value") for x in _arr(s.get("values"), "series values")],
            }
        )
    if c.get("semantic") is not None and c["semantic"] not in SEMANTICS:
        _fail(f"chart semantic must be one of {', '.join(SEMANTICS)}")
    out = {
        "id": _str(c.get("id"), "chart id"),
        "title": _str(c.get("title"), "chart title"),
        "dimension": {
            "label": _str(d.get("label"), "dimension label"),
            "kind": d["kind"],
        },
        "labels": labels,
        "series": series,
        "sourceId": _str(c.get("sourceId"), "chart sourceId"),
        "evidenceIds": []
        if c.get("evidenceIds") is None
        else _strings(c["evidenceIds"], "chart evidenceIds"),
    }
    # Absent optional fields are omitted, never stored as `null`. The frontend decoders
    # (decode-schema.ts `optional()`, decode-version.ts `optional()`) accept a missing key but
    # reject an explicit `null`, so a stored `"unit": null` made the whole report schema fail to
    # decode in the viewer. `None` here means "the agent did not send the field".
    for key, source, what in (
        ("type", c.get("type"), "chart type"),
        ("description", c.get("description"), "chart description"),
    ):
        value = _optional(source, what)
        if value is not None:
            out[key] = value
    unit = _optional(d.get("unit"), "dimension unit")
    if unit is not None:
        out["dimension"]["unit"] = unit
    if c.get("semantic") is not None:
        out["semantic"] = c["semantic"]
    if c.get("binEnds") is not None:
        ends = []
        for x in _arr(c["binEnds"], "binEnds"):
            n = _num(x, "binEnd")
            if n is None:
                _fail("binEnds must be numbers")
            ends.append(n)
        out["binEnds"] = ends
    return {k: v for k, v in out.items() if v is not None}


def validate_schema(
    value: Any,
    *,
    report_id: str,
    version_id: str,
    evidence_ids: list[str],
    report_type_id: str | None = None,
) -> dict:
    s = _obj(value, "schema")
    if s.get("schemaVersion") != 1:
        # name the key: agents guess `schema_version` / "v1" from the words "schema v1"
        _fail('unsupported report schema version (expected "schemaVersion": 1, camelCase keys)')
    if (
        s.get("reportId", report_id) != report_id
        or s.get("versionId", version_id) != version_id
        or (report_type_id and s.get("reportTypeId") != report_type_id)
    ):
        _fail("report schema identity mismatch")
    known = set(evidence_ids)
    diagnostics: list[str] = []
    language = _optional(s.get("language"), "language")
    if language and not LANGUAGE_RE.match(language):
        _fail(f"invalid language tag {language!r}")

    def refs(v: Any, what: str) -> list[str]:
        ids = [] if v is None else _strings(v, what)
        unknown = [i for i in ids if i not in known]
        if unknown:
            _fail(f"unknown evidence id {unknown[0]!r} in {what}")
        return ids

    def blocks(v: Any, depth: int = 0, where: str = "sections") -> list[dict]:
        if depth > MAX_DEPTH:
            _fail(f"sections nest deeper than depth {MAX_DEPTH}")
        seen: set[str] = set()
        out = []
        for raw in _arr(v, where):
            b = _obj(raw, "block")
            bid = _str(b.get("id"), "block id")
            kind = _str(b.get("kind"), "block kind")
            if bid in seen:
                _fail(f"duplicate block id {bid!r} in {where}")
            seen.add(bid)
            if b.get("span") is not None and b["span"] not in ("full", "half"):
                _fail(f"block {bid!r}: span must be full or half")
            base = {
                "id": bid,
                "title": _str(b.get("title"), f"block {bid!r} title"),
                "description": _optional(b.get("description"), "block description"),
                "evidenceIds": refs(b.get("evidenceIds"), f"block {bid!r} evidenceIds"),
                "span": b.get("span"),
            }
            base = {k: v for k, v in base.items() if v is not None}
            if kind == "section":
                out.append(
                    {
                        **base,
                        "kind": kind,
                        "blocks": blocks(b.get("blocks"), depth + 1, f"section {bid!r}"),
                    }
                )
            elif kind == "text":
                out.append({**base, "kind": kind, "markdown": _str(b.get("markdown"), "markdown")})
            elif kind in ("finding", "recommendation"):
                out.append({**base, "kind": kind, "text": _str(b.get("text"), "text")})
            elif kind == "evidence":
                out.append(
                    {
                        **base,
                        "kind": kind,
                        "references": refs(b.get("references"), f"block {bid!r} references"),
                    }
                )
            elif kind == "chart":
                spec = _chart(b.get("chart"))
                refs(spec.get("evidenceIds"), f"chart {bid!r} evidenceIds")
                out.append({**base, "kind": kind, "chart": spec})
            elif kind == "metric-grid":
                metrics = []
                for m in _arr(b.get("metrics"), "metrics"):
                    m = _obj(m, "metric")
                    metric = {
                        "id": _str(m.get("id"), "metric id"),
                        "label": _str(m.get("label"), "metric label"),
                        "value": _num(m.get("value"), "metric value"),
                        "unit": _str(m.get("unit"), "metric unit"),
                        "definition": _optional(m.get("definition"), "definition"),
                        "comparison": _optional(m.get("comparison"), "comparison"),
                    }
                    metrics.append(
                        {k: v for k, v in metric.items() if v is not None or k == "value"}
                    )
                if len({m["id"] for m in metrics}) != len(metrics):
                    _fail(f"duplicate metric id in block {bid!r}")
                out.append({**base, "kind": kind, "metrics": metrics})
            elif kind in ("data-table", "comparison"):
                columns = _strings(b.get("columns"), "columns")
                rows = [
                    [
                        c if isinstance(c, str) else _num(c, "table cell")
                        for c in _arr(r, "table row")
                    ]
                    for r in _arr(b.get("rows"), "rows")
                ]
                if not columns or any(len(r) != len(columns) for r in rows):
                    _fail(f"block {bid!r}: every row needs one cell per column")
                out.append(
                    {
                        **base,
                        "kind": kind,
                        "columns": columns,
                        "rows": rows,
                        "unit": _str(b.get("unit"), "unit") if b.get("unit") != "" else "",
                    }
                )
            else:
                message = f"Unsupported report block: {kind}"
                diagnostics.append(message)
                out.append(
                    {**base, "kind": "unsupported", "originalKind": kind, "message": message}
                )
        return out

    scope = None
    if s.get("scope") is not None:
        p = _obj(s["scope"], "scope")
        start, end = _str(p.get("from"), "scope.from"), _str(p.get("to"), "scope.to")
        timezone = _str(p.get("timezone"), "scope.timezone")
        validate_range(start, end, timezone)
        scope = {
            "from": start,
            "to": end,
            "timezone": timezone,
            "project": _optional(p.get("project"), "scope.project"),
            "market": _optional(p.get("market"), "scope.market"),
        }
        scope = {k: v for k, v in scope.items() if v is not None}
    skill = None
    if s.get("skill") is not None:
        p = _obj(s["skill"], "skill")
        skill = {
            "id": _str(p.get("id"), "skill.id"),
            "name": _str(p.get("name"), "skill.name"),
            "revision": _str(p.get("revision"), "skill.revision"),
        }
    dashboard = blocks(s.get("dashboard"), where="dashboard")
    sections = blocks(s.get("sections"), where="sections")
    out = {
        "schemaVersion": 1,
        "reportId": report_id,
        "versionId": version_id,
        "reportTypeId": _str(s.get("reportTypeId"), "reportTypeId"),
        "title": _str(s.get("title"), "title"),
        "description": _optional(s.get("description"), "description"),
        "language": language,
        "domain": _optional(s.get("domain"), "domain"),
        "summary": _optional(s.get("summary"), "summary"),
        "scope": scope,
        "skill": skill,
        "limitations": []
        if s.get("limitations") is None
        else _strings(s["limitations"], "limitations"),
        "dashboard": dashboard,
        "sections": sections,
        "diagnostics": diagnostics,
    }
    return {k: v for k, v in out.items() if v is not None}
