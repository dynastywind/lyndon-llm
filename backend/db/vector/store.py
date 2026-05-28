"""
Vector Store abstraction — Chroma (dev) or Qdrant (prod).
Both expose the same async interface so callers don't care which backend is active.
"""
from __future__ import annotations

from config.settings import settings, VectorStoreBackend


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


class ChromaVectorStore(VectorStoreBase):
    def __init__(self, collection_name: str) -> None:
        self._collection_name = collection_name
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
        kwargs = dict(
            query_embeddings=query_embeddings,
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        if where:
            kwargs["where"] = where
        return self._get_col().query(**kwargs)

    async def delete(self, ids: list[str]) -> None:
        self._get_col().delete(ids=ids)

    async def delete_by_source(self, source: str) -> None:
        """Delete all chunks whose metadata source matches the given path/URL."""
        col = self._get_col()
        result = col.get(where={"source": source}, include=[])
        if result["ids"]:
            col.delete(ids=result["ids"])


class QdrantVectorStore(VectorStoreBase):
    def __init__(self, collection_name: str) -> None:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams

        self._collection = collection_name
        self._client = QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            api_key=settings.qdrant_api_key or None,
        )
        # Create collection if it doesn't exist
        existing = [c.name for c in self._client.get_collections().collections]
        if collection_name not in existing:
            self._client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=settings.embedding_dimension,
                    distance=Distance.COSINE,
                ),
            )

    async def upsert(self, ids, embeddings, documents, metadatas) -> None:
        from qdrant_client.models import PointStruct
        points = [
            PointStruct(
                id=abs(hash(id_)) % (2**63),   # Qdrant needs integer IDs
                vector=emb,
                payload={"text": doc, **meta},
            )
            for id_, emb, doc, meta in zip(ids, embeddings, documents, metadatas)
        ]
        self._client.upsert(collection_name=self._collection, points=points)

    async def query(self, query_embeddings, n_results=5, where=None) -> dict:
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        qdrant_filter = None
        if where:
            must = [
                FieldCondition(key=k, match=MatchValue(value=v))
                for k, v in where.items()
            ]
            qdrant_filter = Filter(must=must)

        hits = self._client.search(
            collection_name=self._collection,
            query_vector=query_embeddings[0],
            limit=n_results,
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
        from qdrant_client.models import Filter, FieldCondition, MatchValue, FilterSelector
        self._client.delete(
            collection_name=self._collection,
            points_selector=FilterSelector(
                filter=Filter(must=[FieldCondition(key="source", match=MatchValue(value=source))])
            ),
        )


_instances: dict[str, VectorStoreBase] = {}


async def get_vector_store(collection_name: str) -> VectorStoreBase:
    """Return (and cache) the right vector store backend.
    ChromaVectorStore connects lazily, so caching the instance is always safe —
    a failed connection just means the next call to _get_col() will retry.
    """
    if collection_name not in _instances:
        if settings.vector_store_backend == VectorStoreBackend.qdrant:
            _instances[collection_name] = QdrantVectorStore(collection_name)
        else:
            _instances[collection_name] = ChromaVectorStore(collection_name)
    return _instances[collection_name]
