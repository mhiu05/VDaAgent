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

from src.agents.persistence import AgentRepository, agent_repository
from src.agents.pii import mask_text
from src.models.schemas import (
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

    def generate_plan(self, request: ProfilingPlanGenerateRequest) -> ProfilingPlan:
        documents = self.repository.get_knowledge_documents(request.user_id, request.document_ids)
        context_text = "\n\n".join(document.extracted_text or document.summary for document in documents)
        requirements = f"{request.custom_requirements}\n\n{context_text}".lower()
        sections = set(request.selected_sections or ["schema", "columns", "findings"])
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

        add("schema", "Inspect schema and datatypes", "Every profiling run needs a trusted schema baseline.", "schema")
        add("columns", "Compute column-level metrics", "Nulls, distincts, ranges, samples, and top values drive the report.", "columns")
        add("findings", "Generate data quality findings", "Findings provide analyst-friendly issues and recommendations.", "findings")

        if any(term in requirements for term in ["pii", "privacy", "email", "phone", "mask", "personal"]):
            add("pii", "Detect and mask PII candidates", "Requirements mention privacy-sensitive data.", "findings", True)
            questions.append("Which columns are allowed to be exposed unmasked in the report?")
        if any(term in requirements for term in ["correlation", "relationship", "join", "foreign key", "primary key"]):
            add("relationships", "Profile correlations and inferred relationships", "Requirements mention relationships or joins.", "correlations", True)
            questions.append("Which identifier or relationship candidates should be treated as trusted metadata?")
        if any(term in requirements for term in ["outlier", "anomaly", "range", "invalid"]):
            add("outliers", "Check outliers and invalid ranges", "Requirements mention anomalies or business ranges.", "columns", True)
            questions.append("What thresholds or accepted business ranges should be enforced?")
        if any(term in requirements for term in ["missing", "null", "completeness", "required"]):
            add("missingness", "Highlight missingness and required-field risks", "Requirements mention completeness or required fields.", "findings", True)
            questions.append("Which columns are mandatory and what null threshold should become a warning?")
        if any(term in requirements for term in ["statistical", "anova", "t-test", "chi-square", "spearman", "pearson"]):
            add("stat_tests", "Recommend statistical tests after profiling", "Requirements mention analytical hypothesis testing.", None, True)
            questions.append("Which outcome and grouping columns should be used for statistical tests?")

        if request.custom_requirements.strip() and not questions:
            questions.append("Confirm whether the custom requirement should become a reusable rule for future reports.")

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
                evidence=mask_text(answers.get(item.id, item.reason)),
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
    return [word for word in "".join(char.lower() if char.isalnum() else " " for char in query).split() if len(word) >= 3]


def _excerpt(text: str, terms: list[str]) -> str:
    if not text:
        return ""
    lower = text.lower()
    positions = [lower.find(term) for term in terms if term in lower]
    start = max(0, min(positions) - 120) if positions else 0
    return text[start:start + 500].strip()


def _now() -> str:
    return datetime.now(UTC).isoformat()
