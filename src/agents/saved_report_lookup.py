"""Evidence lookup tool for questions over saved profiling reports.

The chat route should not know how to inspect profile payloads. This module
keeps report question intent detection, evidence retrieval, and response
formatting in one replaceable service boundary. A future LLM tool-calling agent
can call this service and use the returned evidence instead of relying on
route-level keyword branches.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
import unicodedata

from src.models.schemas import ColumnProfile, ProfileReportRecord


@dataclass
class SavedReportEvidence:
    intent: str
    title: str
    facts: list[str] = field(default_factory=list)
    status: str = "answered"
    evidence_scope: str = "saved_report"

    @property
    def has_evidence(self) -> bool:
        return self.status == "answered"

    def to_tool_payload(self) -> dict[str, object]:
        return {
            "intent": self.intent,
            "title": self.title,
            "facts": self.facts,
            "status": self.status,
            "evidence_scope": self.evidence_scope,
        }

    def to_tool_json(self) -> str:
        return json.dumps(self.to_tool_payload(), ensure_ascii=False)


class SavedReportLookupService:
    """Read evidence from a persisted profile report for a user question."""

    def get_overview(self, record: ProfileReportRecord) -> SavedReportEvidence:
        report = record.report
        return SavedReportEvidence(
            intent="overview",
            title=f"Saved report '{record.source_name}' overview",
            facts=[
                f"Rows: {report.dataset_summary.row_count:,}",
                f"Columns: {report.dataset_summary.column_count:,}",
                f"Warnings: {report.quality_summary.warning_count:,}",
                f"Critical findings: {report.quality_summary.critical_count:,}",
                f"Info findings: {report.quality_summary.info_count:,}",
            ],
        )

    def get_schema(self, record: ProfileReportRecord, column_names: list[str] | None = None) -> SavedReportEvidence:
        report = record.report
        selected_columns = _select_columns(record, column_names) or report.columns[:30]
        return SavedReportEvidence(
            intent="schema",
            title=f"Schema summary for saved report '{record.source_name}'",
            facts=[
                f"Rows: {report.dataset_summary.row_count:,}",
                f"Columns: {report.dataset_summary.column_count:,}",
                *[_format_column_evidence(column) for column in selected_columns[:30]],
            ],
        )

    def get_nulls(self, record: ProfileReportRecord) -> SavedReportEvidence:
        report = record.report
        null_columns = sorted(
            [column for column in report.columns if column.null_count > 0],
            key=lambda column: column.null_ratio,
            reverse=True,
        )
        if not null_columns:
            return SavedReportEvidence(
                intent="nulls",
                title=f"Null coverage in saved report '{record.source_name}'",
                facts=[
                    f"Rows: {report.dataset_summary.row_count:,}",
                    f"Columns: {report.dataset_summary.column_count:,}",
                    "No columns contain null values.",
                ],
            )
        return SavedReportEvidence(
            intent="nulls",
            title=f"Null coverage in saved report '{record.source_name}'",
            facts=[
                f"{column.name}: {column.null_count:,} nulls ({column.null_ratio:.1%})"
                for column in null_columns[:8]
            ],
        )

    def get_categorical_columns(self, record: ProfileReportRecord) -> SavedReportEvidence:
        categorical_columns = [
            column
            for column in record.report.columns
            if _is_categorical_column(column, record.report.dataset_summary.row_count)
        ]
        if not categorical_columns:
            return SavedReportEvidence(
                intent="categorical_columns",
                title=f"Categorical columns in saved report '{record.source_name}'",
                facts=["No categorical top-value distributions were stored in this report."],
                status="not_found",
            )
        return _categorical_columns_evidence(record, categorical_columns)

    def get_distribution(
        self,
        record: ProfileReportRecord,
        column_names: list[str] | None = None,
    ) -> SavedReportEvidence:
        scoped_columns = _select_columns(record, column_names) if column_names else record.report.columns
        categorical_columns = [
            column
            for column in scoped_columns
            if _is_categorical_column(column, record.report.dataset_summary.row_count)
        ]
        if not categorical_columns:
            return SavedReportEvidence(
                intent="categorical_distributions",
                title=f"Categorical distributions in saved report '{record.source_name}'",
                facts=["No categorical top-value distributions were stored for the requested scope."],
                status="not_found",
            )
        return _categorical_distribution_evidence(record, categorical_columns)

    def get_findings(self, record: ProfileReportRecord) -> SavedReportEvidence:
        report = record.report
        return SavedReportEvidence(
            intent="findings",
            title=f"Findings in saved report '{record.source_name}'",
            facts=[
                f"{finding.severity}: {finding.column or 'dataset'} - {finding.message}"
                for finding in report.findings[:10]
            ] or ["No findings were returned."],
        )

    def get_pii(self, record: ProfileReportRecord) -> SavedReportEvidence:
        pii_columns = [column for column in record.report.columns if column.pii_detection]
        if not pii_columns:
            return SavedReportEvidence(
                intent="pii",
                title=f"PII detections in saved report '{record.source_name}'",
                facts=["No PII detections were stored in this report."],
                status="not_found",
            )
        facts = []
        for column in pii_columns[:10]:
            detections = "; ".join(
                f"{item.pii_type} ({item.confidence:.0%})" for item in column.pii_detection
            )
            facts.append(f"{column.name}: {detections}")
        return SavedReportEvidence(
            intent="pii",
            title=f"PII detections in saved report '{record.source_name}'",
            facts=facts,
        )

    def get_correlations(self, record: ProfileReportRecord) -> SavedReportEvidence:
        correlations = record.report.relationships.correlations
        if not correlations:
            return SavedReportEvidence(
                intent="correlations",
                title=f"Correlations in saved report '{record.source_name}'",
                facts=["No correlation evidence was stored in this report."],
                status="not_found",
            )
        return SavedReportEvidence(
            intent="correlations",
            title=f"Correlations in saved report '{record.source_name}'",
            facts=[
                f"{item.left_column} vs {item.right_column}: {item.coefficient:.3f} ({item.strength})"
                for item in correlations[:10]
            ],
        )

    def get_cardinality(
        self,
        record: ProfileReportRecord,
        column_names: list[str] | None = None,
    ) -> SavedReportEvidence:
        selected_columns = _select_columns(record, column_names) or sorted(
            record.report.columns,
            key=lambda column: column.distinct_count,
            reverse=True,
        )
        return SavedReportEvidence(
            intent="cardinality",
            title=f"Cardinality in saved report '{record.source_name}'",
            facts=[
                f"{column.name}: {column.distinct_count:,} distinct ({column.distinct_ratio:.1%} of rows), type={column.data_type}"
                for column in selected_columns[:12]
            ],
        )

    def get_full_report(self, record: ProfileReportRecord) -> SavedReportEvidence:
        return _full_report_evidence(record)

    def lookup(self, question: str, record: ProfileReportRecord) -> SavedReportEvidence | None:
        report = record.report
        normalized_question = _normalize_question(question)
        matched_columns = _find_columns_for_question(normalized_question, record)

        if normalized_question in {"hi", "hello", "hey", "chao", "xin chao"}:
            return SavedReportEvidence(
                intent="greeting",
                title=f"Using saved report '{record.source_name}'",
                facts=[
                    f"Rows: {report.dataset_summary.row_count:,}",
                    f"Columns: {report.dataset_summary.column_count:,}",
                    "Ask about nulls, categorical columns, distributions, schema, findings, PII, or correlations.",
                ],
            )

        if _has_any(
            normalized_question,
            [
                "ban co the lam gi",
                "co the lam gi",
                "lam duoc gi",
                "giup gi",
                "help",
                "what can you do",
                "capabilities",
            ],
        ):
            return SavedReportEvidence(
                intent="capabilities",
                title=f"I can answer using saved report '{record.source_name}' only.",
                facts=[
                    "Dataset size: rows, columns, source name, and generated report summary.",
                    "Column metrics: data type, null count, distinct count, min/max/average when available.",
                    "Distributions: top values for categorical columns when the report stored them.",
                    "Quality evidence: findings, warnings, critical issues, PII detections, and HITL-related signals.",
                    "Relationships: correlations when profiling generated them.",
                    "If the report does not contain evidence, I will say that instead of inventing an answer.",
                ],
            )

        if _has_any(normalized_question, ["bao nhieu dong", "so dong", "row count", "rows"]):
            return SavedReportEvidence(
                intent="row_count",
                title=f"Saved report '{record.source_name}' row count",
                facts=[f"Rows: {report.dataset_summary.row_count:,}"],
            )

        if _has_any(normalized_question, ["bao nhieu cot", "so cot", "column count", "columns count", "columns", "cot trong dataset"]):
            return SavedReportEvidence(
                intent="column_count",
                title=f"Saved report '{record.source_name}' column count",
                facts=[f"Columns: {report.dataset_summary.column_count:,}"],
            )

        if _has_any(
            normalized_question,
            [
                "tat ca thong tin",
                "toan bo thong tin",
                "full report",
                "all information",
                "everything",
                "chi tiet report",
                "thong tin ban biet",
                "thong tin ve report",
            ],
        ):
            return _full_report_evidence(record)

        if _has_any(normalized_question, ["tong quan", "overview", "summary", "tom tat", "bao cao", "dataset", "du lieu"]):
            return self.get_overview(record)

        if _has_any(normalized_question, ["cardinality", "distinct", "distinct count", "do phan biet", "duy nhat"]):
            return self.get_cardinality(record, [column.name for column in matched_columns])

        if _has_any(normalized_question, ["null", "missing", "thieu", "khuyet", "rong", "empty"]):
            return self.get_nulls(record)

        category_distribution_keywords = [
            "top value",
            "top values",
            "distribution",
            "phan bo",
            "tan suat",
            "value count",
            "value counts",
        ]
        category_column_keywords = [
            "category",
            "categorical",
            "danh muc",
            "cot category",
            "cot categorical",
            "cot nao la category",
            "cot nao la categorical",
            "danh sach category",
            "danh sach categorical",
            "category columns",
            "categorical columns",
        ]
        category_keywords = [
            "category",
            "categorical",
            "danh muc",
            *category_distribution_keywords,
        ]
        if _has_any(normalized_question, category_keywords):
            categorical_columns = [
                column
                for column in (matched_columns or report.columns)
                if _is_categorical_column(column, report.dataset_summary.row_count)
            ]
            if not categorical_columns:
                return SavedReportEvidence(
                    intent="categorical",
                    title=f"Categorical evidence in saved report '{record.source_name}'",
                    facts=["No categorical top-value distributions were stored for the requested scope."],
                    status="not_found",
                )
            wants_distribution = _has_any(normalized_question, category_distribution_keywords)
            wants_column_list = _has_any(normalized_question, category_column_keywords) and not wants_distribution
            if wants_column_list or not wants_distribution:
                return self.get_categorical_columns(record)
            return self.get_distribution(record, [column.name for column in matched_columns])

        findings_keywords = [
            "finding",
            "findings",
            "warning",
            "critical",
            "issue",
            "risk",
            "loi",
            "canh bao",
            "van de",
            "rui ro",
        ]
        if _has_any(normalized_question, findings_keywords):
            return self.get_findings(record)

        if _has_any(normalized_question, ["pii", "sensitive", "nhay cam", "du lieu ca nhan", "personal"]):
            return self.get_pii(record)

        if _has_any(normalized_question, ["correlation", "correlations", "tuong quan", "relationship", "lien he"]):
            return self.get_correlations(record)

        schema_keywords = ["schema", "cot", "data type", "datatype", "kieu du lieu", "danh sach cot"]
        if _has_any(normalized_question, schema_keywords) or matched_columns:
            return self.get_schema(record, [column.name for column in matched_columns])

        return None


class SavedReportAnswerFormatter:
    """Turn report evidence into a readable chat response."""

    def format(self, evidence: SavedReportEvidence, record: ProfileReportRecord) -> str:
        if not evidence.has_evidence and evidence.intent == "unknown":
            return self.unknown(record)
        lines = [evidence.title]
        lines.extend(f"- {fact}" for fact in evidence.facts)
        return "\n".join(lines)

    def unknown(self, record: ProfileReportRecord) -> str:
        return (
            f"I could not find evidence in saved report '{record.source_name}' to answer that. "
            "This report contains dataset counts, column schema, null/distinct metrics, top values, "
            "findings, PII detections, and correlations when they were generated."
        )


def _full_report_evidence(record: ProfileReportRecord) -> SavedReportEvidence:
    report = record.report
    facts = [
        f"Run ID: {record.run_id}",
        f"Source type: {record.source_type}",
        f"Rows: {report.dataset_summary.row_count:,}",
        f"Columns: {report.dataset_summary.column_count:,}",
        "Findings: "
        f"{report.quality_summary.critical_count} critical, "
        f"{report.quality_summary.warning_count} warning, "
        f"{report.quality_summary.info_count} info",
    ]

    null_columns = [column for column in report.columns if column.null_count > 0]
    facts.append(
        f"Null coverage: {len(null_columns)} columns contain null values"
        if null_columns
        else "Null coverage: no columns contain null values"
    )

    pii_columns = [column for column in report.columns if column.pii_detection]
    facts.append(
        f"PII detections: {', '.join(column.name for column in pii_columns[:8])}"
        if pii_columns
        else "PII detections: none stored in this report"
    )

    facts.append("Column metrics:")
    for column in report.columns[:40]:
        facts.append(_format_column_evidence(column))
    if len(report.columns) > 40:
        facts.append(f"... {len(report.columns) - 40} more columns are stored in the report.")

    if report.findings:
        facts.append("Findings:")
        for finding in report.findings[:12]:
            facts.append(f"{finding.severity}: {finding.column or 'dataset'} - {finding.message}")

    if report.relationships.correlations:
        facts.append("Correlations:")
        for item in report.relationships.correlations[:10]:
            facts.append(f"{item.left_column} vs {item.right_column}: {item.coefficient:.3f} ({item.strength})")

    return SavedReportEvidence(
        intent="full_report",
        title=f"Saved report '{record.source_name}'",
        facts=facts,
    )


def _categorical_columns_evidence(
    record: ProfileReportRecord,
    categorical_columns: list[ColumnProfile],
) -> SavedReportEvidence:
    facts = [
        f"{column.name}: type={column.data_type}, distinct={column.distinct_count:,}, "
        f"nulls={column.null_count:,} ({column.null_ratio:.1%})"
        for column in categorical_columns[:20]
    ]
    if len(categorical_columns) > 20:
        facts.append(f"... {len(categorical_columns) - 20} more categorical columns are stored in the report.")
    return SavedReportEvidence(
        intent="categorical_columns",
        title=f"Categorical columns in saved report '{record.source_name}'",
        facts=facts,
    )


def _categorical_distribution_evidence(
    record: ProfileReportRecord,
    categorical_columns: list[ColumnProfile],
) -> SavedReportEvidence:
    row_count = max(record.report.dataset_summary.row_count, 1)
    facts = []
    for column in categorical_columns[:8]:
        facts.append(f"{column.name} ({column.data_type}, distinct={column.distinct_count:,})")
        if not column.top_values:
            facts.append("  No top values stored for this column.")
            continue
        for item in column.top_values[:5]:
            label = "<null>" if item.value is None else str(item.value)
            facts.append(f"  value={label}, count={item.count:,}, ratio={item.count / row_count:.1%}")
    if len(categorical_columns) > 8:
        facts.append(f"... {len(categorical_columns) - 8} more categorical columns are stored in the report.")
    return SavedReportEvidence(
        intent="categorical_distributions",
        title=f"Categorical distributions in saved report '{record.source_name}'",
        facts=facts,
    )


def _normalize_question(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(without_marks.lower().strip(" .!?:;").split())


def _has_any(text: str, keywords: list[str]) -> bool:
    tokens = set(re.findall(r"[a-z0-9_]+", text))
    for keyword in keywords:
        normalized_keyword = _normalize_question(keyword)
        if " " in normalized_keyword:
            if normalized_keyword in text:
                return True
            continue
        if normalized_keyword in tokens:
            return True
    return False


def _find_columns_for_question(normalized_question: str, record: ProfileReportRecord) -> list[ColumnProfile]:
    matches = []
    padded_question = f" {normalized_question} "
    for column in record.report.columns:
        normalized_name = _normalize_question(column.name).replace("_", " ")
        compact_name = normalized_name.replace(" ", "")
        if (
            f" {normalized_name} " in padded_question
            or compact_name in normalized_question.replace(" ", "")
        ):
            matches.append(column)
    return matches


def _select_columns(record: ProfileReportRecord, column_names: list[str] | None) -> list[ColumnProfile]:
    if not column_names:
        return []
    requested = {_normalize_question(name).replace("_", " ") for name in column_names if name}
    compact_requested = {name.replace(" ", "") for name in requested}
    selected = []
    for column in record.report.columns:
        normalized_name = _normalize_question(column.name).replace("_", " ")
        if normalized_name in requested or normalized_name.replace(" ", "") in compact_requested:
            selected.append(column)
    return selected


def _format_column_evidence(column: ColumnProfile) -> str:
    parts = [
        f"{column.name}: {column.data_type}",
        f"null={column.null_count:,} ({column.null_ratio:.1%})",
        f"distinct={column.distinct_count:,}",
    ]
    if column.avg is not None:
        parts.append(f"avg={column.avg:.3g}")
    if column.min is not None:
        parts.append(f"min={column.min}")
    if column.max is not None:
        parts.append(f"max={column.max}")
    if column.top_values:
        top_values = "; ".join(
            f"{'<null>' if item.value is None else item.value}: {item.count:,}"
            for item in column.top_values[:5]
        )
        parts.append(f"top values=[{top_values}]")
    return ", ".join(parts)


def _is_numeric_type(data_type: str) -> bool:
    value = str(data_type or "").lower()
    return any(token in value for token in ["int", "float", "double", "decimal", "numeric", "real"])


def _is_categorical_column(column: ColumnProfile, row_count: int) -> bool:
    if not column.top_values or _is_numeric_type(column.data_type):
        return False
    max_distinct = max(50, int(max(row_count, 1) * 0.2))
    return column.distinct_count <= max_distinct
