"""Hybrid retrieval cho QA định tính (ADR-007).

Kết hợp hai nguồn rồi hợp nhất bằng Reciprocal Rank Fusion:
    - dense: embedding (local sentence-transformers, hoặc OpenAI, hoặc tắt);
    - sparse: BM25 keyword — bắt đúng tên cột / tên metric mà dense thường trượt.

Cả hai dependency đều tuỳ chọn. Thiếu `rank_bm25` thì dùng BM25 tự cài đặt;
thiếu model embedding thì chạy sparse-only. Mục tiêu: QA không sập chỉ vì thiếu
thư viện tuỳ chọn.
"""

from __future__ import annotations

import math
import re
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from src.config import Settings, get_settings

_TOKEN_RE = re.compile(r"[\wÀ-ỹ]+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    """Tách token, giữ nguyên chữ có dấu tiếng Việt."""
    return [t.lower() for t in _TOKEN_RE.findall(text)]


@dataclass
class Document:
    doc_id: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Hit:
    doc_id: str
    text: str
    metadata: dict[str, Any]
    score: float
    source: str  # dense | sparse | hybrid


# --------------------------------------------------------------------------- #
# BM25
# --------------------------------------------------------------------------- #
class _SimpleBM25:
    """BM25 Okapi tối giản — fallback khi không cài `rank_bm25`."""

    def __init__(self, corpus: list[list[str]], k1: float = 1.5, b: float = 0.75) -> None:
        self.k1, self.b = k1, b
        self.corpus = corpus
        self.doc_len = [len(d) for d in corpus]
        self.avg_len = (sum(self.doc_len) / len(corpus)) if corpus else 0.0
        self.freqs = [Counter(d) for d in corpus]
        df: Counter[str] = Counter()
        for doc in corpus:
            df.update(set(doc))
        n = len(corpus)
        self.idf = {
            term: math.log(1 + (n - count + 0.5) / (count + 0.5)) for term, count in df.items()
        }

    def get_scores(self, query: list[str]) -> list[float]:
        scores = []
        for freq, length in zip(self.freqs, self.doc_len, strict=True):
            score = 0.0
            for term in query:
                tf = freq.get(term, 0)
                if not tf:
                    continue
                denom = tf + self.k1 * (1 - self.b + self.b * length / (self.avg_len or 1))
                score += self.idf.get(term, 0.0) * tf * (self.k1 + 1) / denom
            scores.append(score)
        return scores


def _build_bm25(corpus: list[list[str]]) -> Any:
    if not corpus:
        return None
    try:
        from rank_bm25 import BM25Okapi

        return BM25Okapi(corpus)
    except ImportError:
        return _SimpleBM25(corpus)


# --------------------------------------------------------------------------- #
# Embedding
# --------------------------------------------------------------------------- #
class Embedder:
    """Wrapper embedding. `available=False` thì pipeline tự chạy sparse-only."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: Any = None
        self._client: Any = None
        self.provider = settings.retrieval_embedding_provider
        self.active_provider = self.provider
        self.available = False
        self._init()

    def _init(self) -> None:
        if self.provider == "none":
            return
        if self.provider == "local":
            try:
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(self.settings.retrieval_embedding_model)
                self.available = True
            except (ImportError, OSError):
                # Chưa cài extras [vector] hoặc chưa tải được model -> sparse-only.
                self.available = False
            return
        if self.provider == "openai":
            key = self.settings.embedding_api_key or self.settings.llm_api_key
            if not key:
                return
            try:
                from openai import OpenAI

                self._client = OpenAI(api_key=key)
                self.available = True
            except ImportError:
                self.available = False
            return
        if self.provider == "voyage":
            if not self.settings.voyage_api_key:
                self._use_local_fallback()
                return
            try:
                import voyageai

                self._client = voyageai.Client(api_key=self.settings.voyage_api_key)
                self.available = True
            except ImportError:
                self._use_local_fallback()

    def _use_local_fallback(self) -> bool:
        """Switch permanently after a Voyage failure; never retry every batch."""
        if self._model is not None:
            return True
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.settings.retrieval_local_fallback_model)
            self.active_provider = "local_fallback"
            self.available = True
            return True
        except Exception:  # noqa: BLE001 - local model may be absent/offline.
            # BM25 remains available. Do not convert a remote embedding outage
            # into a Q&A outage, or repeatedly attempt model downloads.
            self.available = False
            return False

    def encode(self, texts: list[str], input_type: str | None = None) -> list[list[float]]:
        if not self.available or not texts:
            return []
        if self._model is not None:
            return [list(map(float, v)) for v in self._model.encode(texts, show_progress_bar=False)]
        if self.provider == "voyage":
            try:
                response = self._client.embed(
                    texts,
                    model=self.settings.retrieval_embedding_model,
                    input_type=input_type or "document",
                )
                return [list(map(float, embedding)) for embedding in response.embeddings]
            except Exception:  # noqa: BLE001 - quota/network/provider errors fail over safely.
                if self._use_local_fallback():
                    return [list(map(float, vector)) for vector in self._model.encode(texts, show_progress_bar=False)]
                return []
        response = self._client.embeddings.create(model="text-embedding-3-small", input=texts)
        return [list(map(float, item.embedding)) for item in response.data]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


# --------------------------------------------------------------------------- #
# Index
# --------------------------------------------------------------------------- #
class HybridIndex:
    """Index dense + sparse, persist vào metadata database.

    Quy mô MVP (vài trăm profile run) nên giữ toàn bộ trong RAM và brute-force
    cosine — đủ nhanh mà không cần thêm FAISS/pgvector vào dependency bắt buộc.
    Nội dung index và vector được lưu trong bảng `retrieval_documents`, vì vậy
    restart hoặc đổi instance deploy không làm mất index như cơ chế JSON local
    trước đây.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._lock = threading.Lock()
        self._docs: list[Document] = []
        self._vectors: list[list[float]] = []
        self._bm25: Any = None
        self._vocab: list[Counter[str]] = []
        self._embedder: Embedder | None = None
        self._workspace_id: str | None = None
        self._loaded_at = 0.0
        self._load()

    # --- persistence ---------------------------------------------------- #
    def _load(self, workspace_id: str | None = None) -> None:
        # Import lazy để tránh vòng import khi repository khởi tạo metadata.
        from src.services.repository import get_repository

        rows = get_repository(self.settings).list_retrieval_documents(workspace_id=workspace_id)
        self._workspace_id = workspace_id
        self._docs = []
        for row in rows:
            metadata = dict(row.get("document_metadata") or {})
            # Documents created before the external corpus did not have a
            # discriminator. A profile run is the only safe legacy inference.
            if not metadata.get("knowledge_type") and metadata.get("profile_run_id"):
                metadata["knowledge_type"] = "profile_report"
            self._docs.append(Document(row["doc_id"], row["text"], metadata))
        self._vectors = [d.get("vector") or [] for d in rows]
        # Vector cũ có thể lệch chiều với model hiện tại -> bỏ, index lại khi cần.
        if self._vectors and len(self._vectors) != len(self._docs):
            self._vectors = []
        self._rebuild_sparse()
        self._loaded_at = time.monotonic()

    def _rebuild_sparse(self) -> None:
        corpus = [tokenize(d.text) for d in self._docs]
        self._bm25 = _build_bm25(corpus)
        # Cache tần suất từ để `_sparse` không phải tokenize lại mỗi lần tìm.
        self._vocab = [Counter(tokens) for tokens in corpus]

    @property
    def documents(self) -> list[Document]:
        """Các document đang có trong index (chỉ đọc)."""
        return list(self._docs)

    @property
    def embedder(self) -> Embedder:
        if self._embedder is None:
            self._embedder = Embedder(self.settings)
        return self._embedder

    # --- write ---------------------------------------------------------- #
    def upsert(
        self, doc_id: str, text: str, metadata: dict[str, Any] | None = None, *, workspace_id: str | None = None
    ) -> None:
        """Thêm/ghi đè một document theo doc_id (index incremental)."""
        if not text.strip():
            return
        with self._lock:
            vector: list[float] = []
            if self.embedder.available:
                encoded = self.embedder.encode([text], input_type="document")
                vector = encoded[0] if encoded else []

            existing = next((i for i, d in enumerate(self._docs) if d.doc_id == doc_id), None)
            doc = Document(doc_id, text, metadata or {})
            if existing is None:
                self._docs.append(doc)
                self._vectors.append(vector)
            else:
                self._docs[existing] = doc
                if len(self._vectors) == len(self._docs):
                    self._vectors[existing] = vector
                else:
                    self._vectors = []

            self._rebuild_sparse()
            self._loaded_at = 0.0
            from src.services.repository import get_repository

            get_repository(self.settings).upsert_retrieval_document(
                doc_id=doc_id,
                text=text,
                document_metadata=metadata or {},
                vector=vector,
                workspace_id=workspace_id,
            )

    def upsert_many(self, documents: list[Document], batch_size: int = 64, *, workspace_id: str | None = None) -> dict[str, int]:
        """Encode and persist a batch, rebuilding the in-memory index once."""
        clean = [doc for doc in documents if doc.doc_id and doc.text.strip()]
        if not clean:
            return {"inserted": 0, "updated": 0, "unchanged": 0}
        with self._lock:
            from src.services.repository import get_repository

            old = {doc.doc_id: doc for doc in self._docs}
            vectors: list[list[float]] = []
            for start in range(0, len(clean), max(1, batch_size)):
                group = clean[start : start + max(1, batch_size)]
                encoded = self.embedder.encode([doc.text for doc in group], input_type="document") if self.embedder.available else []
                vectors.extend(encoded if len(encoded) == len(group) else ([[]] * len(group)))
            payload = [(doc.doc_id, doc.text, doc.metadata, vector) for doc, vector in zip(clean, vectors, strict=True)]
            result = get_repository(self.settings).upsert_retrieval_documents(payload, workspace_id=workspace_id)
            merged = {doc.doc_id: doc for doc in self._docs}
            merged.update({doc.doc_id: doc for doc in clean})
            self._docs = [merged[key] for key in sorted(merged)]
            vector_by_id = {doc.doc_id: vector for doc, vector in zip(clean, vectors, strict=True)}
            prior_vectors = {doc.doc_id: self._vectors[index] for index, doc in enumerate(old.values()) if index < len(self._vectors)}
            self._vectors = [vector_by_id.get(doc.doc_id, prior_vectors.get(doc.doc_id, [])) for doc in self._docs]
            self._rebuild_sparse()
            self._loaded_at = 0.0
            return result

    def delete(self, doc_id: str, *, workspace_id: str | None = None) -> bool:
        with self._lock:
            idx = next((i for i, d in enumerate(self._docs) if d.doc_id == doc_id), None)
            if idx is None:
                return False
            self._docs.pop(idx)
            if len(self._vectors) > idx:
                self._vectors.pop(idx)
            self._rebuild_sparse()
            self._loaded_at = 0.0
            from src.services.repository import get_repository

            get_repository(self.settings).delete_retrieval_document(doc_id, workspace_id=workspace_id)
            return True

    def __len__(self) -> int:
        return len(self._docs)

    # --- read ----------------------------------------------------------- #
    def _dense(self, query: str, k: int, eligible: list[int]) -> list[tuple[int, float]]:
        if not self.embedder.available or len(self._vectors) != len(self._docs):
            return []
        encoded = self.embedder.encode([query], input_type="query")
        if not encoded:
            return []
        qv = encoded[0]
        scored = [
            (i, _cosine(qv, self._vectors[i])) for i in eligible if len(self._vectors[i]) == len(qv)
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:k]

    def _sparse(self, query: str, k: int, eligible: list[int]) -> list[tuple[int, float]]:
        """BM25 trên toàn corpus.

        Không lọc `score > 0`: khi mọi document đều chứa từ khoá (corpus nhỏ,
        các profile run của cùng một dataset rất giống nhau), IDF của BM25 tụt
        về 0 hoặc âm và bộ lọc dương sẽ loại bỏ hết kết quả. Chỉ cần thứ tự
        tương đối, vì RRF dùng rank chứ không dùng giá trị score.
        """
        if self._bm25 is None:
            return []
        tokens = tokenize(query)
        if not tokens:
            return []

        scores = self._bm25.get_scores(tokens)
        # Giữ document có ít nhất một từ khoá khớp — dùng tần suất thật thay vì
        # dấu của score để không phụ thuộc vào cách tính IDF.
        vocab = self._vocab
        scored = [
            (i, float(s))
            for i in eligible
            for s in [scores[i]]
            if i < len(vocab) and any(vocab[i].get(t) for t in tokens)
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:k]

    def _eligible_indices(self, where: dict[str, Any] | None) -> list[int]:
        if not where:
            return list(range(len(self._docs)))
        return [
            index for index, doc in enumerate(self._docs)
            if all(doc.metadata.get(key) == value for key, value in where.items())
        ]

    def search(
        self,
        query: str,
        top_k: int | None = None,
        candidate_k: int | None = None,
        where: dict[str, Any] | None = None,
        workspace_id: str | None = None,
        *,
        dense: bool = True,
    ) -> list[Hit]:
        """Hybrid search: dense + sparse -> RRF -> (tuỳ chọn) cross-encoder rerank."""
        # Mỗi worker có cache RAM riêng; đọc lại metadata giúp các instance
        # nhìn thấy document mới được index bởi worker khác.
        with self._lock:
            refresh_after = self.settings.retrieval_index_refresh_seconds
            needs_refresh = (
                self._workspace_id != workspace_id
                or refresh_after == 0.0
                or time.monotonic() - self._loaded_at >= refresh_after
            )
            if needs_refresh:
                self._load(workspace_id)
        if not self._docs or not query.strip():
            return []

        top_k = top_k or self.settings.retrieval_top_k
        candidate_k = candidate_k or self.settings.retrieval_candidate_k

        eligible = self._eligible_indices(where)
        if not eligible:
            return []
        dense_hits = self._dense(query, candidate_k, eligible) if dense else []
        sparse = self._sparse(query, candidate_k, eligible)

        # Reciprocal Rank Fusion: cộng 1/(60+rank) — không cần chuẩn hoá score
        # giữa hai thang đo khác nhau (cosine vs BM25).
        fused: dict[int, float] = {}
        origin: dict[int, set[str]] = {}
        for name, ranked in (("dense", dense_hits), ("sparse", sparse)):
            for rank, (idx, _score) in enumerate(ranked, start=1):
                fused[idx] = fused.get(idx, 0.0) + 1.0 / (60 + rank)
                origin.setdefault(idx, set()).add(name)

        candidates = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)

        candidates = candidates[:candidate_k]

        if self.settings.retrieval_enable_rerank and candidates:
            candidates = self._rerank(query, candidates)

        return [
            Hit(
                doc_id=self._docs[i].doc_id,
                text=self._docs[i].text,
                metadata=self._docs[i].metadata,
                score=round(score, 6),
                source="hybrid" if len(origin.get(i, set())) > 1 else next(iter(origin.get(i, {"sparse"}))),
            )
            for i, score in candidates[:top_k]
        ]

    def _rerank(self, query: str, candidates: list[tuple[int, float]]) -> list[tuple[int, float]]:
        """Cross-encoder rerank. Thiếu thư viện thì giữ nguyên thứ tự RRF."""
        try:
            from sentence_transformers import CrossEncoder
        except ImportError:
            return candidates
        try:
            model = CrossEncoder(self.settings.retrieval_rerank_model)
            pairs = [(query, self._docs[i].text) for i, _ in candidates]
            scores = model.predict(pairs)
        except (OSError, ValueError):
            return candidates
        reranked = [(candidates[j][0], float(s)) for j, s in enumerate(scores)]
        reranked.sort(key=lambda x: x[1], reverse=True)
        return reranked


_index: HybridIndex | None = None
_index_lock = threading.Lock()


def get_index(settings: Settings | None = None) -> HybridIndex:
    global _index
    with _index_lock:
        if _index is None:
            _index = HybridIndex(settings)
        return _index


def reset_index() -> None:
    """Dùng trong test khi đổi index_dir."""
    global _index
    _index = None


def index_business_glossary(
    glossary_terms: list[dict[str, str]],
    workspace_id: str | None = None,
    settings: Settings | None = None,
) -> int:
    """Index OpenMetadata-style business terms into hybrid retrieval for domain-aware Q&A."""
    index = get_index(settings)
    docs = []
    for term in glossary_terms:
        name = str(term.get("name") or "").strip()
        definition = str(term.get("definition") or "").strip()
        synonyms = str(term.get("synonyms") or "").strip()
        if not name:
            continue
        text = f"Thuật ngữ nghiệp vụ: {name}\nĐịnh nghĩa: {definition}\nTừ đồng nghĩa: {synonyms}"
        doc_id = f"glossary_{name.lower().replace(' ', '_')}"
        docs.append(
            Document(
                doc_id=doc_id,
                text=text,
                metadata={
                    "evidence_type": "business_glossary",
                    "term": name,
                    "workspace_id": workspace_id,
                },
            )
        )
    if docs:
        index.upsert_many(docs, workspace_id=workspace_id)
    return len(docs)


def index_column_lineage(
    profile_run_id: str,
    lineage_entries: list[dict[str, Any]],
    workspace_id: str | None = None,
    settings: Settings | None = None,
) -> int:
    """Index OpenMetadata-style column-level lineage and transformations."""
    index = get_index(settings)
    docs = []
    for entry in lineage_entries:
        target_column = str(entry.get("target_column") or "").strip()
        source_columns = ", ".join(entry.get("source_columns") or [])
        transformation = str(entry.get("transformation") or "").strip()
        if not target_column:
            continue
        text = (
            f"Dòng chảy dữ liệu (Lineage): Cột '{target_column}' được sinh từ các cột nguồn [{source_columns}]. "
            f"Phép biến đổi: {transformation}"
        )
        doc_id = f"lineage_{profile_run_id}_{target_column}"
        docs.append(
            Document(
                doc_id=doc_id,
                text=text,
                metadata={
                    "evidence_type": "column_lineage",
                    "profile_run_id": profile_run_id,
                    "target_column": target_column,
                    "workspace_id": workspace_id,
                },
            )
        )
    if docs:
        index.upsert_many(docs, workspace_id=workspace_id)
    return len(docs)


__all__ = [
    "Document",
    "Hit",
    "HybridIndex",
    "get_index",
    "index_business_glossary",
    "index_column_lineage",
    "reset_index",
    "tokenize",
]
