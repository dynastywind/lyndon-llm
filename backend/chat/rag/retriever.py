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


def _scope_where(user_id: str | None, project_id: str | None) -> dict | None:
    """Build a metadata filter scoping results to a user and/or project.

    Chroma requires ``$and`` to combine more than one clause; Qdrant's adapter
    treats a flat ``{key: value}`` dict as an AND of field matches, so the
    single-clause and multi-clause shapes both translate cleanly.
    """
    clauses = []
    if user_id:
        clauses.append({"user_id": user_id})
    if project_id:
        clauses.append({"project_id": project_id})
    if len(clauses) > 1:
        return {"$and": clauses}
    if clauses:
        return clauses[0]
    return None


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
        self,
        query: str,
        top_k: int | None = None,
        user_id: str | None = None,
        project_id: str | None = None,
    ) -> list[RetrievedChunk]:
        k = int(top_k or settings.rag_top_k)
        dense = await self._dense_search(query, k=k * 2, user_id=user_id, project_id=project_id)
        sparse = self._bm25_search(query, candidates=dense, k=k * 2)
        return self._reciprocal_rank_fusion(dense, sparse)[:k]

    async def _dense_search(
        self, query: str, k: int, user_id: str | None = None, project_id: str | None = None
    ) -> list[RetrievedChunk]:
        embeddings = await llm_gateway.embed([query])
        vs = await self._get_vector_store()
        # Scope by user, and (when given) by project so a project's chats only
        # see that project's uploaded files.
        where = _scope_where(user_id, project_id)
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


class ImageRetriever:
    """Cross-modal image retrieval over the CLIP image collection.

    Embeds the text query with CLIP's *text* encoder and searches the dedicated
    image collection (CLIP image vectors). Results below the similarity
    threshold are dropped so unrelated images are never injected into chat.
    """

    def __init__(self) -> None:
        self._vector_store = None

    async def _get_vector_store(self):
        if self._vector_store is None:
            from db.vector.store import get_vector_store

            self._vector_store = await get_vector_store(
                settings.image_collection_name, vector_size=settings.clip_dimension
            )
        return self._vector_store

    async def retrieve(
        self,
        query: str,
        top_k: int | None = None,
        user_id: str | None = None,
        project_id: str | None = None,
    ) -> list[RetrievedChunk]:
        from core.llm.clip_embedder import clip_embedder

        vs = await self._get_vector_store()
        # Cheap gate: don't load the CLIP model (~350 MB) or text-encode when no
        # images have been indexed at all. Keeps text-only users on the fast path.
        ids, _docs, _metas = await vs.list_all(limit=1)
        if not ids:
            return []

        k = int(top_k or settings.rag_image_top_k)
        vec = (await clip_embedder.embed_texts([query]))[0]
        where = _scope_where(user_id, project_id)
        results = await vs.query(query_embeddings=[vec], n_results=k, where=where)

        chunks: list[RetrievedChunk] = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
            strict=False,
        ):
            similarity = 1.0 - float(dist)
            if similarity < settings.rag_image_min_similarity:
                continue
            chunks.append(
                RetrievedChunk(
                    content=doc,
                    source=meta.get("source", meta.get("filename", "unknown")),
                    score=similarity,
                    metadata=meta,
                )
            )
        return chunks


# Module-level singletons
retriever = HybridRetriever()
image_retriever = ImageRetriever()
