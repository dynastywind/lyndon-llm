"""
Vector Store abstraction — Chroma (dev) or Qdrant (prod).
Both expose the same async interface so callers don't care which backend is active.
"""

from __future__ import annotations

from config.settings import VectorStoreBackend, settings


class VectorStoreBase:
    async def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict],
    ) -> None: ...

    async def query(
        self,
        query_embeddings: list[list[float]],
        n_results: int = 5,
        where: dict | None = None,
    ) -> dict: ...

    async def delete(self, ids: list[str]) -> None: ...

    async def delete_by_source(self, source: str) -> None: ...

    async def list_sources(self, user_id: str | None = None) -> list[str]: ...

    async def list_all(self, limit: int = 200) -> tuple[list[str], list[str], list[dict]]:
        """Return (ids, documents, metadatas) for up to *limit* items."""
        return [], [], []


class ChromaVectorStore(VectorStoreBase):
    def __init__(self, collection_name: str, vector_size: int | None = None) -> None:
        self._collection_name = collection_name
        # Chroma infers the vector dimension from the first insert, so vector_size
        # is accepted for interface symmetry with Qdrant but not used here.
        self._vector_size = vector_size
        self._col = None  # lazy — connect on first use

    def _get_col(self):
        """Connect to Chroma lazily so startup order doesn't matter."""
        if self._col is None:
            import chromadb

            client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
            )
            self._col = client.get_or_create_collection(
                name=self._collection_name,
                metadata={"hnsw:space": "cosine"},
            )
        return self._col

    async def upsert(self, ids, embeddings, documents, metadatas) -> None:
        self._get_col().upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )

    async def query(self, query_embeddings, n_results=5, where=None) -> dict:
        col = self._get_col()
        # ChromaDB requires n_results to be a plain Python int (not numpy scalar
        # or float) and must not exceed the number of stored vectors.
        safe_n = max(1, min(int(n_results), col.count() or 1))
        kwargs: dict = {
            "query_embeddings": query_embeddings,
            "n_results": safe_n,
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where
        return col.query(**kwargs)

    async def delete(self, ids: list[str]) -> None:
        self._get_col().delete(ids=ids)

    async def delete_by_source(self, source: str) -> None:
        """Delete all chunks whose metadata source matches the given path/URL."""
        col = self._get_col()
        result = col.get(where={"source": source}, include=[])
        if result["ids"]:
            col.delete(ids=result["ids"])

    async def list_sources(self, user_id: str | None = None) -> list[str]:
        """Return sorted list of distinct source paths in the collection."""
        kwargs: dict = {"include": ["metadatas"]}
        if user_id:
            kwargs["where"] = {"user_id": user_id}
        result = self._get_col().get(**kwargs)
        sources = sorted(
            {m.get("source", "") for m in (result.get("metadatas") or []) if m.get("source")}
        )
        return sources

    async def list_all(self, limit: int = 200) -> tuple[list[str], list[str], list[dict]]:
        result = self._get_col().get(include=["documents", "metadatas"], limit=limit)
        return (
            result.get("ids", []),
            result.get("documents", []),
            result.get("metadatas", []),
        )


class QdrantVectorStore(VectorStoreBase):
    def __init__(self, collection_name: str, vector_size: int | None = None) -> None:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams

        self._collection = collection_name
        self._client = QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            api_key=settings.qdrant_api_key or None,
        )
        # Each collection may use a different vector dimension (e.g. nomic text =
        # 768, CLIP image = 512). Qdrant must be told the size at creation time;
        # default to the text embedding dimension when not specified.
        size = vector_size or settings.embedding_dimension
        # Create collection if it doesn't exist
        existing = [c.name for c in self._client.get_collections().collections]
        if collection_name not in existing:
            self._client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=size,
                    distance=Distance.COSINE,
                ),
            )

    async def upsert(self, ids, embeddings, documents, metadatas) -> None:
        from qdrant_client.models import PointStruct

        points = [
            PointStruct(
                id=abs(hash(id_)) % (2**63),  # Qdrant needs integer IDs
                vector=emb,
                payload={"text": doc, "_id": id_, **meta},  # _id preserves the string UUID
            )
            for id_, emb, doc, meta in zip(ids, embeddings, documents, metadatas, strict=False)
        ]
        self._client.upsert(collection_name=self._collection, points=points)

    async def query(self, query_embeddings, n_results=5, where=None) -> dict:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        qdrant_filter = None
        if where:
            must = [FieldCondition(key=k, match=MatchValue(value=v)) for k, v in where.items()]
            qdrant_filter = Filter(must=must)

        hits = self._client.search(
            collection_name=self._collection,
            query_vector=query_embeddings[0],
            limit=max(1, int(n_results)),
            query_filter=qdrant_filter,
            with_payload=True,
        )
        docs, metas, dists = [], [], []
        for hit in hits:
            payload = hit.payload or {}
            docs.append(payload.pop("text", ""))
            metas.append(payload)
            dists.append(1.0 - hit.score)  # cosine distance

        return {"documents": [docs], "metadatas": [metas], "distances": [dists]}

    async def delete(self, ids: list[str]) -> None:
        from qdrant_client.models import PointIdsList

        int_ids = [abs(hash(i)) % (2**63) for i in ids]
        self._client.delete(
            collection_name=self._collection,
            points_selector=PointIdsList(points=int_ids),
        )

    async def delete_by_source(self, source: str) -> None:
        from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue

        self._client.delete(
            collection_name=self._collection,
            points_selector=FilterSelector(
                filter=Filter(must=[FieldCondition(key="source", match=MatchValue(value=source))])
            ),
        )

    async def list_sources(self, user_id: str | None = None) -> list[str]:
        """Scroll all points and collect distinct source values."""
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        qdrant_filter = None
        if user_id:
            qdrant_filter = Filter(
                must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
            )

        sources: set[str] = set()
        offset = None
        while True:
            results, offset = self._client.scroll(
                collection_name=self._collection,
                with_payload=True,
                limit=256,
                offset=offset,
                query_filter=qdrant_filter,
            )
            for point in results:
                src = (point.payload or {}).get("source", "")
                if src:
                    sources.add(src)
            if offset is None:
                break
        return sorted(sources)

    async def list_all(self, limit: int = 200) -> tuple[list[str], list[str], list[dict]]:
        results, _ = self._client.scroll(
            collection_name=self._collection,
            with_payload=True,
            limit=limit,
        )
        ids, docs, metas = [], [], []
        for point in results:
            payload = dict(point.payload or {})
            doc = payload.pop("text", "")
            # Original string ID is stored in payload under "_id" (set during upsert)
            original_id = payload.pop("_id", str(point.id))
            ids.append(original_id)
            docs.append(doc)
            metas.append(payload)
        return ids, docs, metas


_instances: dict[str, VectorStoreBase] = {}


async def get_vector_store(
    collection_name: str, vector_size: int | None = None
) -> VectorStoreBase:
    """Return (and cache) the right vector store backend.
    ChromaVectorStore connects lazily, so caching the instance is always safe —
    a failed connection just means the next call to _get_col() will retry.

    *vector_size* sets the collection's vector dimension at creation time. It only
    takes effect the first time a given collection is opened (each collection has
    a fixed dimension, so the instance is cached by name alone).
    """
    if collection_name not in _instances:
        if settings.vector_store_backend == VectorStoreBackend.qdrant:
            _instances[collection_name] = QdrantVectorStore(collection_name, vector_size)
        else:
            _instances[collection_name] = ChromaVectorStore(collection_name, vector_size)
    return _instances[collection_name]
