"""Report schema v1 validation: the rules of the frontend `decodeReportSchema` (docs 14f, 19)."""

from __future__ import annotations

import copy

import pytest

from backend.reports.schema import SchemaError, validate_schema

MINIMAL = {
    "schemaVersion": 1,
    "reportTypeId": "customer-segmentation",
    "title": "Phân nhóm khách hàng",
    "language": "vi-VN",
    "limitations": ["Dữ liệu minh họa"],
    "dashboard": [
        {
            "id": "customer-count",
            "kind": "metric-grid",
            "title": "Quy mô mẫu",
            "evidenceIds": [],
            "metrics": [{"id": "customers", "label": "Khách hàng", "value": 120, "unit": "người"}],
        }
    ],
    "sections": [
        {
            "id": "method",
            "kind": "text",
            "title": "Phương pháp",
            "evidenceIds": [],
            "markdown": "Mô tả phạm vi.",
        }
    ],
}

CHART = {
    "id": "price",
    "kind": "chart",
    "title": "Giá/m²",
    "evidenceIds": ["ev1"],
    "chart": {
        "id": "c1",
        "title": "Giá/m²",
        "dimension": {"label": "Căn", "kind": "categorical"},
        "labels": ["MAS-U03832", "Nhóm"],
        "sourceId": "warehouse",
        "series": [{"id": "s1", "label": "Giá", "unit": "triệu/m²", "values": [52, None]}],
    },
}


def ok(schema, evidence=("ev1",)):
    return validate_schema(schema, report_id="R7", version_id="R7-v1", evidence_ids=list(evidence))


def broken(mutate, message=None):
    s = copy.deepcopy(MINIMAL)
    mutate(s)
    with pytest.raises(SchemaError) as e:
        ok(s)
    if message:
        assert message in str(e.value)


def test_minimal_schema_gets_its_identity_and_defaults():
    out = ok(copy.deepcopy(MINIMAL))
    assert (out["reportId"], out["versionId"], out["schemaVersion"]) == ("R7", "R7-v1", 1)
    assert out["diagnostics"] == [] and out["limitations"] == ["Dữ liệu minh họa"]
    assert out["dashboard"][0]["metrics"][0]["value"] == 120


def test_agent_supplied_identity_must_match():
    s = copy.deepcopy(MINIMAL)
    s["reportId"] = "R9"
    with pytest.raises(SchemaError, match="identity"):
        ok(s)
    s["reportId"], s["versionId"] = "R7", "R7-v1"
    assert ok(s)["reportId"] == "R7"


def test_charts_tables_and_sections():
    s = copy.deepcopy(MINIMAL)
    s["sections"] += [
        CHART,
        {
            "id": "t",
            "kind": "data-table",
            "title": "Bảng",
            "evidenceIds": [],
            "unit": "căn",
            "columns": ["A", "B"],
            "rows": [["x", 1], ["y", None]],
        },
        {
            "id": "sec",
            "kind": "section",
            "title": "Phụ lục",
            "evidenceIds": [],
            "span": "half",
            "blocks": [
                {
                    "id": "f",
                    "kind": "finding",
                    "title": "Kết luận",
                    "evidenceIds": ["ev1"],
                    "text": "Giá cao hơn 12%.",
                }
            ],
        },
        {
            "id": "ev",
            "kind": "evidence",
            "title": "Nguồn",
            "evidenceIds": [],
            "references": ["ev1"],
        },
    ]
    s["scope"] = {"from": "2026-07-01", "to": "2026-10-01", "timezone": "Asia/Ho_Chi_Minh"}
    out = ok(s)
    assert [b["kind"] for b in out["sections"]] == [
        "text",
        "chart",
        "data-table",
        "section",
        "evidence",
    ]
    assert out["sections"][1]["chart"]["evidenceIds"] == []


def test_an_absent_optional_is_omitted_never_stored_as_null():
    """A stored `null` breaks the frontend decoders, which accept a missing key but not `null`.

    `unit`, `type`, `description` and `semantic` are optional; the report versions table is
    immutable, so a null written here can never be corrected later. Regression: charts published
    with `"unit": null` made the viewer report "Phiên bản schema chưa được hỗ trợ" and render the
    report without any chart.
    """
    s = copy.deepcopy(MINIMAL)
    s["sections"].append(copy.deepcopy(CHART))
    out = ok(s)
    spec = out["sections"][-1]["chart"]
    assert "type" not in spec and "description" not in spec and "semantic" not in spec
    assert "unit" not in spec["dimension"]
    # An explicit value is kept, so the omission is not a blanket drop.
    s2 = copy.deepcopy(MINIMAL)
    chart = copy.deepcopy(CHART)
    chart["chart"]["type"] = "bar"
    chart["chart"]["description"] = "Giá niêm yết"
    chart["chart"]["semantic"] = "comparison"
    chart["chart"]["dimension"]["unit"] = "triệu VNĐ"
    s2["sections"].append(chart)
    spec2 = ok(s2)["sections"][-1]["chart"]
    assert spec2["type"] == "bar"
    assert spec2["description"] == "Giá niêm yết"
    assert spec2["semantic"] == "comparison"
    assert spec2["dimension"]["unit"] == "triệu VNĐ"
    assert all(v is not None for v in spec2.values())


def test_unknown_blocks_become_unsupported_with_a_diagnostic():
    s = copy.deepcopy(MINIMAL)
    s["sections"].append(
        {"id": "x", "kind": "hologram", "title": "?", "evidenceIds": [], "script": "alert(1)"}
    )
    out = ok(s)
    block = out["sections"][-1]
    assert block["kind"] == "unsupported" and block["originalKind"] == "hologram"
    assert "script" not in block
    assert out["diagnostics"] == ["Unsupported report block: hologram"]


@pytest.mark.parametrize(
    "mutate,message",
    [
        (lambda s: s.update(schemaVersion=2), "version"),
        (lambda s: s.update(language="Vietnamese!"), "language"),
        (lambda s: s.update(title="  "), "title"),
        (
            lambda s: s["dashboard"][0]["metrics"].append(dict(s["dashboard"][0]["metrics"][0])),
            "metric",
        ),
        (lambda s: s["sections"].append(dict(s["sections"][0])), "duplicate"),
        (lambda s: s["sections"][0].update(span="third"), "span"),
        (lambda s: s["sections"][0].update(evidenceIds=["nope"]), "evidence"),
        (lambda s: s["dashboard"][0]["metrics"][0].update(value="120"), "number"),
        (
            lambda s: s.update(
                scope={"from": "2026-10-01", "to": "2026-07-01", "timezone": "Asia/Ho_Chi_Minh"}
            ),
            "date",
        ),
        (
            lambda s: s.update(
                scope={"from": "2026-07-01", "to": "2026-10-01", "timezone": "Mars/Base"}
            ),
            "timezone",
        ),
        (
            lambda s: s["sections"].append(
                {
                    "id": "t",
                    "kind": "data-table",
                    "title": "T",
                    "evidenceIds": [],
                    "unit": "",
                    "columns": ["A", "B"],
                    "rows": [["x"]],
                }
            ),
            "row",
        ),
        (
            lambda s: s["sections"].append(
                {**CHART, "chart": {**CHART["chart"], "semantic": "vibes"}}
            ),
            "semantic",
        ),
        (
            lambda s: s["sections"].append(
                {
                    **CHART,
                    "chart": {**CHART["chart"], "dimension": {"label": "x", "kind": "spatial"}},
                }
            ),
            "dimension",
        ),
    ],
)
def test_invalid_schemas(mutate, message):
    broken(mutate, message)


def test_section_depth_is_capped_at_eight():
    s = copy.deepcopy(MINIMAL)
    block = {"id": "leaf", "kind": "text", "title": "x", "evidenceIds": [], "markdown": "x"}
    for i in range(10):
        block = {
            "id": f"s{i}",
            "kind": "section",
            "title": "x",
            "evidenceIds": [],
            "blocks": [block],
        }
    s["sections"] = [block]
    with pytest.raises(SchemaError, match="depth"):
        ok(s)


def test_the_report_starter_prompt_example_is_a_valid_schema():
    """The Report starter writes its schema from the example in its prompt; it must validate."""
    import json
    import re
    from pathlib import Path

    prompt = (
        Path(__file__).resolve().parents[3] / "domains/fabrikam/starters/report/prompt.md"
    ).read_text(encoding="utf-8")
    example = re.search(r"```json\n(.*?)```", prompt, re.S).group(1)
    schema = validate_schema(
        json.loads(example), report_id="R1", version_id="R1-v1", evidence_ids=[]
    )
    assert schema["schemaVersion"] == 1 and schema["reportId"] == "R1"


def test_a_wrong_version_key_names_the_expected_one():
    bad = {k: v for k, v in MINIMAL.items() if k != "schemaVersion"} | {"schema_version": 1}
    with pytest.raises(SchemaError, match='"schemaVersion": 1'):
        validate_schema(bad, report_id="R1", version_id="R1-v1", evidence_ids=[])
