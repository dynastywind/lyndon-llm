"""
Ingest Pipeline — end-to-end: source → load → chunk → embed → store.
"""

from __future__ import annotations

from pathlib import Path

from chat.rag.ingestion.chunker import Chunk, RecursiveChunker
from chat.rag.ingestion.loader import IMAGE_EXTENSIONS, get_loader
from config.settings import settings
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

    async def ingest(
        self, source: str, user_id: str | None = None, project_id: str | None = None
    ) -> int:
        """
        Ingest a single source (file path or URL).
        Returns the number of chunks stored.

        When *project_id* is given it is stored in each chunk's metadata so the
        retriever can scope results to a single project's files.
        """
        # Images take a separate path: embedded with CLIP into a dedicated
        # collection (one vector per image, no chunking).
        if Path(source).suffix.lower() in IMAGE_EXTENSIONS:
            return await self._ingest_image(source, user_id=user_id, project_id=project_id)

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
        extra_meta: dict[str, str] = {}
        if user_id:
            extra_meta["user_id"] = user_id
        if project_id:
            extra_meta["project_id"] = project_id
        await vs.upsert(
            ids=[f"{source}::{i}" for i in range(len(all_chunks))],
            embeddings=embeddings,
            documents=texts,
            metadatas=[{"source": c.source, **c.metadata, **extra_meta} for c in all_chunks],
        )
        return len(all_chunks)

    async def _ingest_image(
        self, source: str, user_id: str | None = None, project_id: str | None = None
    ) -> int:
        """Embed an image with CLIP and store it in the image collection.

        Images are not chunked — one vector per image. The stored document text
        is the filename (used for display / snippets); retrieval is purely
        vector-based via CLIP's cross-modal text/image space.
        """
        from core.llm.clip_embedder import clip_embedder
        from db.vector.store import get_vector_store

        embeddings = await clip_embedder.embed_images([source])

        vs = await get_vector_store(
            settings.image_collection_name, vector_size=settings.clip_dimension
        )
        # Clean re-ingest — drop any prior vector for this image.
        await vs.delete_by_source(source)

        meta: dict[str, str] = {
            "source": source,
            "type": "image",
            "filename": Path(source).name,
        }
        if user_id:
            meta["user_id"] = user_id
        if project_id:
            meta["project_id"] = project_id

        await vs.upsert(
            ids=[f"{source}::0"],
            embeddings=embeddings,
            documents=[Path(source).name],
            metadatas=[meta],
        )
        return 1

    async def ingest_directory(self, directory: str, glob: str = "**/*") -> int:
        """Recursively ingest all supported files in a directory."""
        text_exts = {
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
        }
        supported = text_exts | IMAGE_EXTENSIONS
        total = 0
        for path in Path(directory).glob(glob):
            if path.is_file() and path.suffix.lower() in supported:
                total += await self.ingest(str(path))
        return total


# Module-level singleton
ingest_pipeline = IngestPipeline()
