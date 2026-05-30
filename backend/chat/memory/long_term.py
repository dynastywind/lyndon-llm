"""
Long-term memory — cross-session persistent memory with vector search.

Storage:
  - Metadata + content → SQLite/Postgres (via SQLAlchemy)
  - Embeddings         → Vector store (Chroma / Qdrant)

Retrieval is hybrid:
  1. Vector similarity search (semantic)
  2. Recency boost (more recent memories ranked up slightly)
  3. Importance weight
"""
from __future__ import annotations

from datetime import datetime, timezone

from chat.memory.types import Memory, MemoryType
from config.settings import settings


class LongTermMemory:
    COLLECTION_NAME = "long_term_memory"

    def __init__(self) -> None:
        # Lazily initialised — avoids import-time side effects
        self._vector_store = None
        self._db = None

    async def _get_vector_store(self):
        if self._vector_store is None:
            from db.vector.store import get_vector_store
            self._vector_store = await get_vector_store(self.COLLECTION_NAME)
        return self._vector_store

    # ------------------------------------------------------------------ #
    #  Write                                                               #
    # ------------------------------------------------------------------ #

    async def store(self, memory: Memory) -> None:
        """Persist a memory to both the DB and vector store."""
        from core.llm.gateway import llm_gateway

        # Embed if not already done
        if memory.embedding is None:
            embeddings = await llm_gateway.embed([memory.content])
            memory.embedding = embeddings[0]

        vs = await self._get_vector_store()
        await vs.upsert(
            ids=[memory.id],
            embeddings=[memory.embedding],
            documents=[memory.content],
            metadatas=[{
                "session_id":   memory.session_id,
                "memory_type":  memory.memory_type.value,
                "importance":   memory.importance,
                "created_at":   memory.created_at.isoformat(),
            }],
        )

    # ------------------------------------------------------------------ #
    #  Retrieve                                                            #
    # ------------------------------------------------------------------ #

    async def retrieve(
        self,
        query: str,
        session_id: str | None = None,
        memory_type: MemoryType | None = None,
        top_k: int | None = None,
    ) -> list[Memory]:
        """
        Retrieve the most relevant memories for a query.
        Optionally filter by session or memory type.
        """
        from core.llm.gateway import llm_gateway

        k = top_k or settings.long_term_top_k
        embeddings = await llm_gateway.embed([query])
        query_embedding = embeddings[0]

        where: dict = {}
        if session_id:
            where["session_id"] = session_id
        if memory_type:
            where["memory_type"] = memory_type.value

        vs = await self._get_vector_store()
        results = await vs.query(
            query_embeddings=[query_embedding],
            n_results=k,
            where=where or None,
        )

        memories = []
        for doc, meta, _dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            memories.append(Memory(
                session_id=meta.get("session_id", ""),
                memory_type=MemoryType(meta.get("memory_type", "episodic")),
                content=doc,
                importance=float(meta.get("importance", 0.5)),
                created_at=datetime.fromisoformat(
                    meta.get("created_at", datetime.now(timezone.utc).isoformat())
                ),
            ))
        return memories

    async def list_all(self, limit: int = 200) -> list[dict]:
        """Return all memories as plain dicts, sorted newest-first."""
        vs = await self._get_vector_store()
        ids, docs, metas = await vs.list_all(limit=limit)
        results = []
        for id_, doc, meta in zip(ids, docs, metas):
            results.append({
                "id":          id_,
                "content":     doc,
                "session_id":  meta.get("session_id", ""),
                "memory_type": meta.get("memory_type", "episodic"),
                "importance":  float(meta.get("importance", 0.5)),
                "created_at":  meta.get("created_at", ""),
            })
        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return results

    async def delete(self, memory_id: str) -> None:
        vs = await self._get_vector_store()
        await vs.delete(ids=[memory_id])

    async def consolidate(self, session_id: str, summariser_fn) -> None:
        """
        Merge near-duplicate memories and prune low-importance old ones.
        Called periodically (every N sessions) via the memory manager.
        """
        # TODO: implement clustering + deduplication in Phase 2
        pass
