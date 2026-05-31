"""
Ingest Pipeline — end-to-end: source → load → chunk → embed → store.
"""

from __future__ import annotations

from pathlib import Path

from chat.rag.ingestion.chunker import Chunk, RecursiveChunker
from chat.rag.ingestion.loader import get_loader
from core.llm.gateway import llm_gateway


class IngestPipeline:
    COLLECTION_NAME = "rag_knowledge_base"

    def __init__(self) -> None:
        self._chunker = RecursiveChunker()
        self._vector_store = None

    async def _get_vector_store(self):
        if self._vector_store is None:
            from db.vector.store import get_vector_store

            self._vector_store = await get_vector_store(self.COLLECTION_NAME)
        return self._vector_store

    async def ingest(self, source: str) -> int:
        """
        Ingest a single source (file path or URL).
        Returns the number of chunks stored.
        """
        loader = get_loader(source)
        documents = await loader.load(source)

        all_chunks: list[Chunk] = []
        for doc in documents:
            all_chunks.extend(self._chunker.chunk(doc))

        if not all_chunks:
            return 0

        # Batch embed (max 32 chunks per call to avoid timeouts)
        texts = [c.content for c in all_chunks]
        embeddings: list[list[float]] = []
        batch_size = 32
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            embeddings.extend(await llm_gateway.embed(batch))

        vs = await self._get_vector_store()

        # Remove any previously ingested chunks for this source so re-ingestion
        # is always clean (no orphaned chunks from old versions of the file).
        await vs.delete_by_source(source)

        # IDs use a *global* sequential index across all chunks.
        # Per-document chunk_index resets to 0 for each page/section (e.g. PDF
        # pages), which would produce duplicate IDs like source::0 appearing
        # multiple times in one upsert call.
        await vs.upsert(
            ids=[f"{source}::{i}" for i in range(len(all_chunks))],
            embeddings=embeddings,
            documents=texts,
            metadatas=[{"source": c.source, **c.metadata} for c in all_chunks],
        )
        return len(all_chunks)

    async def ingest_directory(self, directory: str, glob: str = "**/*") -> int:
        """Recursively ingest all supported files in a directory."""
        total = 0
        for path in Path(directory).glob(glob):
            if path.is_file() and path.suffix.lower() in {
                ".pdf",
                ".md",
                ".mdx",
                ".txt",
                ".py",
                ".ts",
                ".tsx",
                ".js",
                ".jsx",
                ".go",
                ".rs",
                ".java",
                ".cpp",
                ".c",
            }:
                total += await self.ingest(str(path))
        return total


# Module-level singleton
ingest_pipeline = IngestPipeline()
