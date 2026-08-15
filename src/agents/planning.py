"""User-scoped document intake and profiling plan generation.

This MVP uses deterministic retrieval over extracted text so the product can
support RAG-shaped workflows without adding a vector database dependency yet.
The module keeps all outputs structured so an LLM or vector store can replace
the internals later without changing API contracts.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile
import xml.etree.ElementTree as ET
import unicodedata

from src.agents.persistence import AgentRepository, agent_repository
from src.agents.pii import mask_text
from src.models.schemas import (
    DatabasePlanGenerateRequest,
    DatabasePlanRecommendation,
    DatabasePlanTableRecommendation,
    KnowledgeDocument,
    KnowledgeSearchResult,
    ProfilingPlan,
    ProfilingPlanGenerateRequest,
    ProfilingPlanItem,
    UserRule,
)


class PlanningStore:
    def __init__(self, repository: AgentRepository | None = None) -> None:
        self.repository = repository or agent_repository

    def ingest_document(
        self,
        user_id: str,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> KnowledgeDocument:
        suffix = Path(filename).suffix.lower()
        extracted = ""
        status = "metadata_only"
        if suffix in {".txt", ".md", ".json", ".csv"} or content_type.startswith("text/"):
            extracted = content.decode("utf-8", errors="ignore")
            status = "ingested"
        elif suffix == ".docx":
            extracted = _try_extract_docx(content)
            status = "ingested" if extracted else "metadata_only"
        elif suffix == ".pdf":
            extracted = _try_extract_pdf(content)
            status = "ingested" if extracted else "metadata_only"
        else:
            extracted = ""

        safe_text = mask_text(extracted[:20000])
        document = KnowledgeDocument(
            id=f"doc_{uuid4().hex}",
            user_id=user_id,
            name=Path(filename).name,
            content_type=content_type or "application/octet-stream",
            size=len(content),
            status=status,
            extracted_text=safe_text,
            summary=_summarize_text(safe_text, filename),
            created_at=_now(),
        )
        return self.repository.save_knowledge_document(document)

    def list_documents(self, user_id: str) -> list[KnowledgeDocument]:
        return self.repository.list_knowledge_documents(user_id)

    def search_documents(self, user_id: str, query: str, limit: int = 5) -> list[KnowledgeSearchResult]:
        terms = _keywords(query)
        documents = self.repository.list_knowledge_documents(user_id, limit=200)
        ranked: list[KnowledgeSearchResult] = []
        for document in documents:
            text = document.extracted_text or document.summary
            score = sum(text.lower().count(term) for term in terms)
            if score <= 0 and terms:
                continue
            ranked.append(KnowledgeSearchResult(
                document_id=document.id,
                document_name=document.name,
                score=float(score),
                excerpt=_excerpt(text, terms),
            ))
        return sorted(ranked, key=lambda item: item.score, reverse=True)[:limit]

    def recommend_database_plan(self, request: DatabasePlanGenerateRequest) -> DatabasePlanRecommendation:
        documents = self.repository.get_knowledge_documents(request.user_id, request.document_ids)
        context_text = "\n\n".join(document.extracted_text or document.summary for document in documents)
        requirements = f"{request.custom_requirements}\n\n{context_text}"
        terms = _keywords(requirements)
        table_terms = [term for term in terms if len(term) >= 3]
        recommendations: list[DatabasePlanTableRecommendation] = []

        for table in request.tables:
            schema_name = table.schema_name
            table_name = table.table
            haystack = f"{schema_name} {table_name}".lower()
            matched = [term for term in table_terms if term in haystack]
            score = float(len(matched))
            if score <= 0:
                score += _semantic_table_score(haystack, requirements.lower())
            if score <= 0:
                continue
            reason = (
                f"Matched requirement terms: {', '.join(matched[:8])}."
                if matched
                else "Table name is related to the requested analysis domain."
            )
            recommendations.append(DatabasePlanTableRecommendation(
                schema_name=schema_name,
                table_name=table_name,
                score=score,
                reason=reason,
                matched_terms=matched[:12],
            ))

        recommendations.sort(key=lambda item: item.score, reverse=True)
        selected = recommendations[:request.max_tables]
        questions: list[str] = []
        evidence: list[str] = []
        if selected:
            evidence.append(
                "Selected tables from requirement document and available database object names."
            )
            questions.append(
                "Confirm these tables before profiling, especially if the requirement mentions business concepts not visible in table names."
            )
        else:
            questions.append(
                "No table name matched the uploaded documents or custom requirements. Select tables manually or add table names to the requirement document."
            )
        return DatabasePlanRecommendation(
            recommended_tables=selected,
            questions=questions,
            evidence=evidence,
        )

    def generate_plan(self, request: ProfilingPlanGenerateRequest) -> ProfilingPlan:
        documents = self.repository.get_knowledge_documents(request.user_id, request.document_ids)
        context_text = "\n\n".join(document.extracted_text or document.summary for document in documents)
        requirements = _normalize_text(f"{request.custom_requirements}\n\n{context_text}")
        column_names = [column for column in request.columns if column]
        normalized_columns = {column: _normalize_text(column) for column in column_names}
        requested_sections = request.selected_sections or ["schema", "columns", "findings"]
        sections = set(requested_sections)
        items: list[ProfilingPlanItem] = []
        questions: list[str] = []

        def add(item_id: str, label: str, reason: str, section: str | None = None, confirm: bool = False) -> None:
            if any(item.id == item_id for item in items):
                return
            if section:
                sections.add(section)
            items.append(ProfilingPlanItem(
                id=item_id,
                label=label,
                reason=reason,
                section=section,
                requires_confirmation=confirm,
            ))

        section_items = {
            "schema": ("schema", "Inspect schema", "Selected output includes schema and datatype validation."),
            "columns": ("columns", "Compute column metrics", "Selected output includes nulls, distincts, ranges, samples, and top values."),
            "findings": ("findings", "Generate findings", "Selected output includes analyst-facing data quality findings."),
            "quality_summary": ("quality_summary", "Summarize quality", "Selected output includes aggregate warning and critical counts."),
            "correlations": ("relationships", "Profile relationships", "Selected output includes numeric correlations and relationship candidates."),
        }
        for section in requested_sections:
            definition = section_items.get(section)
            if definition:
                add(*definition, section=section)

        pii_column_terms = [
            "email", "phone", "mobile", "tel", "name", "full_name", "customer_name",
            "address", "dob", "birth", "ssn", "national", "identifier", "customer_id",
            "user_id", "cccd", "cmnd", "passport",
        ]
        pii_columns = [
            column for column in column_names
            if any(term in normalized_columns[column] for term in pii_column_terms)
        ]
        pii_matches = _matched_terms(requirements, [
            "pii", "privacy", "email", "phone", "mask", "personal", "sensitive",
            "an", "che", "an danh", "du lieu ca nhan", "nhay cam", "sdt",
            "so dien thoai", "cccd", "cmnd",
        ])
        if pii_matches or pii_columns:
            evidence = (
                f"Column names suggest possible PII: {', '.join(pii_columns[:8])}."
                if pii_columns
                else f"Requirements mention: {', '.join(pii_matches[:4])}."
            )
            add("pii", "Detect and mask PII candidates", evidence, "findings", True)
            if pii_columns:
                questions.append(f"Should these columns be masked in the report: {', '.join(pii_columns[:8])}?")
            else:
                questions.append("Which columns are allowed to be exposed unmasked in the report?")

        relationship_matches = _matched_terms(requirements, [
            "correlation", "relationship", "join", "foreign key", "primary key",
            "lien he", "quan he", "khoa", "khoa chinh", "khoa ngoai",
        ])
        if relationship_matches:
            add("relationships", "Profile correlations and inferred relationships", f"Requirements mention: {', '.join(relationship_matches[:4])}.", "correlations", True)
            questions.append("Which identifier or relationship candidates should be treated as trusted metadata?")

        outlier_matches = _matched_terms(requirements, [
            "outlier", "anomaly", "range", "invalid", "ngoai le", "bat thuong", "khoang",
        ])
        if outlier_matches:
            add("outliers", "Check outliers and invalid ranges", f"Requirements mention: {', '.join(outlier_matches[:4])}.", "columns", True)
            questions.append("What thresholds or accepted business ranges should be enforced?")

        missing_matches = _matched_terms(requirements, [
            "missing", "null", "completeness", "required", "thieu", "rong", "bat buoc",
        ])
        if missing_matches:
            add("missingness", "Highlight missingness and required-field risks", f"Requirements mention: {', '.join(missing_matches[:4])}.", "findings", True)
            questions.append("Which columns are mandatory and what null threshold should become a warning?")

        stat_matches = _matched_terms(requirements, [
            "statistical", "anova", "t-test", "chi-square", "spearman", "pearson", "thong ke", "kiem dinh",
        ])
        if stat_matches:
            add("stat_tests", "Recommend statistical tests after profiling", f"Requirements mention: {', '.join(stat_matches[:4])}.", None, True)
            questions.append("Which outcome and grouping columns should be used for statistical tests?")

        if request.custom_requirements.strip() and not questions:
            questions.append("Which columns or thresholds should this custom requirement apply to?")

        now = _now()
        plan = ProfilingPlan(
            id=f"plan_{uuid4().hex}",
            user_id=request.user_id,
            source_name=request.source_name,
            selected_sections=sorted(sections),
            custom_requirements=mask_text(request.custom_requirements),
            items=items,
            clarification_questions=list(dict.fromkeys(questions)),
            confirmed=False,
            created_at=now,
            updated_at=now,
        )
        return self.repository.save_profiling_plan(plan)

    def confirm_plan(self, plan_id: str, user_id: str, confirmed_items: list[str], answers: dict[str, str]) -> ProfilingPlan | None:
        plan = self.repository.get_profiling_plan(plan_id, user_id)
        if not plan:
            return None
        plan.confirmed = True
        plan.updated_at = _now()
        confirmed = set(confirmed_items or [item.id for item in plan.items])
        answer_text = _format_plan_answers(answers)
        for item in plan.items:
            if item.id not in confirmed or not item.requires_confirmation:
                continue
            self.repository.save_user_rule(UserRule(
                id=f"rule_{uuid4().hex}",
                user_id=user_id,
                source_name=plan.source_name,
                column=None,
                rule_type=item.id,
                description=item.label,
                evidence=mask_text(answers.get(item.id) or answer_text or item.reason),
                created_at=_now(),
            ))
        return self.repository.save_profiling_plan(plan)


planning_store = PlanningStore()


def _try_extract_pdf(content: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
        from io import BytesIO

        reader = PdfReader(BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return ""


def _try_extract_docx(content: bytes) -> str:
    try:
        from io import BytesIO

        with ZipFile(BytesIO(content)) as archive:
            xml_bytes = archive.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = []
        for paragraph in root.findall(".//w:p", namespace):
            texts = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
            if texts:
                paragraphs.append("".join(texts))
        return "\n".join(paragraphs)
    except Exception:
        return ""


def _summarize_text(text: str, filename: str) -> str:
    if not text.strip():
        return f"{Path(filename).name}: content was not extracted; metadata only."
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return first_line[:300] or "Document ingested."


def _keywords(query: str) -> list[str]:
    normalized = _normalize_text(query)
    return [word for word in "".join(char if char.isalnum() else " " for char in normalized).split() if len(word) >= 3]


def _normalize_text(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text or "")
    ascii_text = "".join(char for char in decomposed if not unicodedata.combining(char))
    return ascii_text.lower()


def _matched_terms(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if term in text]


def _format_plan_answers(answers: dict[str, str]) -> str:
    cleaned = [
        f"{key}: {value.strip()}"
        for key, value in (answers or {}).items()
        if value and value.strip()
    ]
    return "; ".join(cleaned)


def _semantic_table_score(table_name: str, requirements: str) -> float:
    groups = {
        "customer": ["customer", "client", "user", "buyer", "khach"],
        "order": ["order", "purchase", "sale", "invoice", "don"],
        "payment": ["payment", "transaction", "billing", "pay", "thanh", "toan"],
        "product": ["product", "item", "sku", "category", "san", "hang"],
        "region": ["region", "country", "city", "location", "area", "khu", "vuc", "vá»±c"],
    }
    score = 0.0
    for table_terms in groups.values():
        if any(term in table_name for term in table_terms) and any(term in requirements for term in table_terms):
            score += 0.75
    return score


def _excerpt(text: str, terms: list[str]) -> str:
    if not text:
        return ""
    lower = text.lower()
    positions = [lower.find(term) for term in terms if term in lower]
    start = max(0, min(positions) - 120) if positions else 0
    return text[start:start + 500].strip()


def _now() -> str:
    return datetime.now(UTC).isoformat()
