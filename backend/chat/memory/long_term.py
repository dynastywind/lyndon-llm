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

from datetime import UTC, datetime
import logging

from chat.memory.types import Memory, MemoryType
from config.settings import settings
from core.security.crypto import memory_cipher

logger = logging.getLogger(__name__)


def candidate_scopes(
    meta: dict, *, user_id: str | None = None, session_id: str | None = None
) -> list[str]:
    """Ordered, de-duplicated list of scope ids to try when decrypting a stored
    document.

    Documents written after the enc_scope change record the exact scope used in
    metadata. Older documents must be probed against both possible scopes
    (``user_id`` then ``session_id``) because the scope chosen at write time did
    not always match the retrieval filter.
    """
    out: list[str] = []
    for s in (
        meta.get("enc_scope"),
        meta.get("user_id"),
        meta.get("session_id"),
        user_id,
        session_id,
    ):
        if s and s not in out:
            out.append(s)
    return out


def decrypt_document(
    doc: str, meta: dict, *, user_id: str | None = None, session_id: str | None = None
) -> str:
    """Decrypt a stored document by trying every candidate scope. Returns the
    document unchanged when it is plaintext or no scope can decrypt it (so the
    model never receives a hard error — at worst it sees opaque text)."""
    if not doc:
        return doc
    for scope in candidate_scopes(meta, user_id=user_id, session_id=session_id):
        # try_decrypt returns the plaintext, the input unchanged (legacy
        # plaintext), or None (this scope's key did not work — try the next).
        pt = memory_cipher.try_decrypt(doc, scope)
        if pt is not None:
            return pt
    return doc


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

    async def store(self, memory: Memory, user_id: str | None = None) -> None:
        """Persist a memory to both the DB and vector store."""
        from core.llm.gateway import llm_gateway

        # Embed if not already done
        if memory.embedding is None:
            embeddings = await llm_gateway.embed([memory.content])
            memory.embedding = embeddings[0]

        meta: dict = {
            "session_id": memory.session_id,
            "memory_type": memory.memory_type.value,
            "importance": memory.importance,
            "created_at": memory.created_at.isoformat(),
        }
        if user_id:
            meta["user_id"] = user_id

        # Encrypt the stored document at rest. The embedding is still computed
        # from plaintext above — vector search needs it, and embeddings are not
        # trivially invertible. Record the exact scope used (`enc_scope`) so
        # decryption is unambiguous regardless of the retrieval filter.
        scope = user_id or memory.session_id
        if scope:
            meta["enc_scope"] = scope
        document = memory_cipher.encrypt(memory.content, scope)

        vs = await self._get_vector_store()
        await vs.upsert(
            ids=[memory.id],
            embeddings=[memory.embedding],
            documents=[document],
            metadatas=[meta],
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
        user_id: str | None = None,
    ) -> list[Memory]:
        """
        Retrieve the most relevant memories for a query.
        Optionally filter by session, memory type, or user.
        """
        from core.llm.gateway import llm_gateway

        # User-isolation guard (checked first, before any embedding/query work):
        # never run an unscoped query. An empty `where` would otherwise become a
        # global query (`where or None`) returning EVERY user's memories. Memory
        # retrieval must always be scoped by at least a user or a session.
        if not user_id and not session_id:
            logger.warning(
                "LongTermMemory.retrieve called without user_id or session_id — "
                "refusing unscoped query to prevent cross-user memory leak"
            )
            return []

        k = top_k or settings.long_term_top_k
        embeddings = await llm_gateway.embed([query])
        query_embedding = embeddings[0]

        where: dict = {}
        if session_id:
            where["session_id"] = session_id
        if memory_type:
            where["memory_type"] = memory_type.value
        if user_id:
            where["user_id"] = user_id

        vs = await self._get_vector_store()
        results = await vs.query(
            query_embeddings=[query_embedding],
            n_results=k,
            where=where or None,
        )

        # Decrypt each document by trying its candidate scopes (enc_scope, then
        # the metadata user_id/session_id, then the query filter). Legacy
        # plaintext docs pass through unchanged.
        memories = []
        for doc, meta, _dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
            strict=False,
        ):
            memories.append(
                Memory(
                    session_id=meta.get("session_id", ""),
                    memory_type=MemoryType(meta.get("memory_type", "episodic")),
                    content=decrypt_document(doc, meta, user_id=user_id, session_id=session_id),
                    importance=float(meta.get("importance", 0.5)),
                    created_at=datetime.fromisoformat(
                        meta.get("created_at", datetime.now(UTC).isoformat())
                    ),
                )
            )
        return memories

    async def list_all(self, limit: int = 200, user_id: str | None = None) -> list[dict]:
        """Return all memories as plain dicts, sorted newest-first."""
        vs = await self._get_vector_store()
        all_ids, all_docs, all_metas = await vs.list_all(limit=limit)
        if user_id:
            filtered = [
                (i, d, m)
                for i, d, m in zip(all_ids, all_docs, all_metas, strict=False)
                if m.get("user_id") == user_id
            ]
            ids = [x[0] for x in filtered]
            docs = [x[1] for x in filtered]
            metas = [x[2] for x in filtered]
        else:
            ids, docs, metas = all_ids, all_docs, all_metas
        results = []
        for id_, doc, meta in zip(ids, docs, metas, strict=False):
            results.append(
                {
                    "id": id_,
                    "content": decrypt_document(doc, meta),
                    "session_id": meta.get("session_id", ""),
                    "memory_type": meta.get("memory_type", "episodic"),
                    "importance": float(meta.get("importance", 0.5)),
                    "created_at": meta.get("created_at", ""),
                }
            )
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
