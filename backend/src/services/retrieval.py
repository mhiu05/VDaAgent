"""Hybrid retrieval cho QA định tính (ADR-007).

Kết hợp hai nguồn rồi hợp nhất bằng Reciprocal Rank Fusion:
    - dense: embedding (local sentence-transformers, hoặc OpenAI, hoặc tắt);
    - sparse: BM25 keyword — bắt đúng tên cột / tên metric mà dense thường trượt.

Cả hai dependency đều tuỳ chọn. Thiếu `rank_bm25` thì dùng BM25 tự cài đặt;
thiếu model embedding thì chạy sparse-only. Mục tiêu: QA không sập chỉ vì thiếu
thư viện tuỳ chọn.
"""

from __future__ import annotations

import json
import math
import re
import threading
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

    def encode(self, texts: list[str]) -> list[list[float]]:
        if not self.available or not texts:
            return []
        if self._model is not None:
            return [list(map(float, v)) for v in self._model.encode(texts, show_progress_bar=False)]
        response = self._client.embeddings.create(
            model="text-embedding-3-small", input=texts
        )
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
    """Index dense + sparse, persist ra JSON để không mất khi restart.

    Quy mô MVP (vài trăm profile run) nên giữ toàn bộ trong RAM và brute-force
    cosine — đủ nhanh mà không cần thêm FAISS vào dependency bắt buộc.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.dir = self.settings.index_path
        self.dir.mkdir(parents=True, exist_ok=True)
        self.store = self.dir / "documents.json"
        self._lock = threading.Lock()
        self._docs: list[Document] = []
        self._vectors: list[list[float]] = []
        self._bm25: Any = None
        self._vocab: list[Counter[str]] = []
        self._embedder: Embedder | None = None
        self._load()

    # --- persistence ---------------------------------------------------- #
    def _load(self) -> None:
        if not self.store.exists():
            return
        try:
            raw = json.loads(self.store.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        self._docs = [
            Document(d["doc_id"], d["text"], d.get("metadata", {})) for d in raw.get("documents", [])
        ]
        self._vectors = raw.get("vectors", [])
        # Vector cũ có thể lệch chiều với model hiện tại -> bỏ, index lại khi cần.
        if self._vectors and len(self._vectors) != len(self._docs):
            self._vectors = []
        self._rebuild_sparse()

    def _save(self) -> None:
        payload = {
            "documents": [
                {"doc_id": d.doc_id, "text": d.text, "metadata": d.metadata} for d in self._docs
            ],
            "vectors": self._vectors,
        }
        tmp = self.store.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.store)

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
    def upsert(self, doc_id: str, text: str, metadata: dict[str, Any] | None = None) -> None:
        """Thêm/ghi đè một document theo doc_id (index incremental)."""
        if not text.strip():
            return
        with self._lock:
            vector: list[float] = []
            if self.embedder.available:
                encoded = self.embedder.encode([text])
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
            self._save()

    def delete(self, doc_id: str) -> bool:
        with self._lock:
            idx = next((i for i, d in enumerate(self._docs) if d.doc_id == doc_id), None)
            if idx is None:
                return False
            self._docs.pop(idx)
            if len(self._vectors) > idx:
                self._vectors.pop(idx)
            self._rebuild_sparse()
            self._save()
            return True

    def __len__(self) -> int:
        return len(self._docs)

    # --- read ----------------------------------------------------------- #
    def _dense(self, query: str, k: int) -> list[tuple[int, float]]:
        if not self.embedder.available or len(self._vectors) != len(self._docs):
            return []
        encoded = self.embedder.encode([query])
        if not encoded:
            return []
        qv = encoded[0]
        scored = [
            (i, _cosine(qv, v)) for i, v in enumerate(self._vectors) if len(v) == len(qv)
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:k]

    def _sparse(self, query: str, k: int) -> list[tuple[int, float]]:
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
            for i, s in enumerate(scores)
            if i < len(vocab) and any(vocab[i].get(t) for t in tokens)
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:k]

    def search(
        self,
        query: str,
        top_k: int | None = None,
        candidate_k: int | None = None,
        where: dict[str, Any] | None = None,
    ) -> list[Hit]:
        """Hybrid search: dense + sparse -> RRF -> (tuỳ chọn) cross-encoder rerank."""
        if not self._docs or not query.strip():
            return []

        top_k = top_k or self.settings.retrieval_top_k
        candidate_k = candidate_k or self.settings.retrieval_candidate_k

        dense = self._dense(query, candidate_k)
        sparse = self._sparse(query, candidate_k)

        # Reciprocal Rank Fusion: cộng 1/(60+rank) — không cần chuẩn hoá score
        # giữa hai thang đo khác nhau (cosine vs BM25).
        fused: dict[int, float] = {}
        origin: dict[int, set[str]] = {}
        for name, ranked in (("dense", dense), ("sparse", sparse)):
            for rank, (idx, _score) in enumerate(ranked, start=1):
                fused[idx] = fused.get(idx, 0.0) + 1.0 / (60 + rank)
                origin.setdefault(idx, set()).add(name)

        candidates = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)

        if where:
            candidates = [
                (i, s)
                for i, s in candidates
                if all(self._docs[i].metadata.get(k) == v for k, v in where.items())
            ]

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


__all__ = ["Document", "Hit", "HybridIndex", "get_index", "reset_index", "tokenize"]
