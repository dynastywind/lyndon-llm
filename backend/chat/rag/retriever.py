"""
Hybrid Retriever — combines dense vector search with BM25 sparse retrieval.
"""

from __future__ import annotations

from dataclasses import dataclass

from config.settings import settings
from core.llm.gateway import llm_gateway


@dataclass
class RetrievedChunk:
    content: str
    source: str
    score: float
    metadata: dict


class HybridRetriever:
    COLLECTION_NAME = "rag_knowledge_base"

    def __init__(self) -> None:
        self._vector_store = None

    async def _get_vector_store(self):
        if self._vector_store is None:
            from db.vector.store import get_vector_store

            self._vector_store = await get_vector_store(self.COLLECTION_NAME)
        return self._vector_store

    async def retrieve(
        self, query: str, top_k: int | None = None, user_id: str | None = None
    ) -> list[RetrievedChunk]:
        k = top_k or settings.rag_top_k
        dense = await self._dense_search(query, k=k * 2, user_id=user_id)
        sparse = self._bm25_search(query, candidates=dense, k=k * 2)
        return self._reciprocal_rank_fusion(dense, sparse)[:k]

    async def _dense_search(
        self, query: str, k: int, user_id: str | None = None
    ) -> list[RetrievedChunk]:
        embeddings = await llm_gateway.embed([query])
        vs = await self._get_vector_store()
        where = {"user_id": user_id} if user_id else None
        results = await vs.query(
            query_embeddings=[embeddings[0]],
            n_results=k,
            where=where,
        )
        chunks = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
            strict=False,
        ):
            chunks.append(
                RetrievedChunk(
                    content=doc,
                    source=meta.get("source", meta.get("filename", "unknown")),
                    score=1.0 - float(dist),  # convert distance to similarity
                    metadata=meta,
                )
            )
        return chunks

    def _bm25_search(
        self,
        query: str,
        candidates: list[RetrievedChunk],
        k: int,
    ) -> list[RetrievedChunk]:
        """Simple TF-IDF-style BM25 approximation over the dense candidates."""
        if not candidates:
            return []
        query_terms = set(query.lower().split())
        scored = []
        for chunk in candidates:
            words = chunk.content.lower().split()
            doc_len = len(words)
            score = sum(
                words.count(term) / (words.count(term) + 1.5 * (1 - 0.75 + 0.75 * doc_len / 100))
                for term in query_terms
            )
            scored.append((score, chunk))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [c for _, c in scored[:k]]

    @staticmethod
    def _reciprocal_rank_fusion(
        dense: list[RetrievedChunk],
        sparse: list[RetrievedChunk],
        k: int = 60,
        dense_weight: float | None = None,
    ) -> list[RetrievedChunk]:
        """Merge dense + sparse rankings using Reciprocal Rank Fusion."""
        bm25_w = settings.rag_bm25_weight
        dense_w = 1.0 - bm25_w

        scores: dict[str, float] = {}
        chunk_map: dict[str, RetrievedChunk] = {}

        for rank, chunk in enumerate(dense):
            key = chunk.content[:80]
            scores[key] = scores.get(key, 0) + dense_w / (k + rank + 1)
            chunk_map[key] = chunk

        for rank, chunk in enumerate(sparse):
            key = chunk.content[:80]
            scores[key] = scores.get(key, 0) + bm25_w / (k + rank + 1)
            chunk_map[key] = chunk

        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return [chunk_map[key] for key, _ in ranked]


# Module-level singleton
retriever = HybridRetriever()
