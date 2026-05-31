"""
Chunker — splits raw documents into overlapping chunks for embedding.
Uses recursive character splitting as the default strategy.
"""

from __future__ import annotations

from chat.rag.ingestion.loader import RawDocument
from config.settings import settings


class Chunk:
    def __init__(self, content: str, source: str, chunk_index: int, metadata: dict | None = None):
        self.content = content
        self.source = source
        self.chunk_index = chunk_index
        self.metadata = metadata or {}


class RecursiveChunker:
    """
    Splits text by trying separators in order: paragraphs → sentences → words.
    Produces chunks of ~chunk_size tokens with overlap.
    """

    SEPARATORS = ["\n\n", "\n", ". ", " ", ""]

    def __init__(
        self,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
    ) -> None:
        self.chunk_size = chunk_size or settings.rag_chunk_size
        self.chunk_overlap = chunk_overlap or settings.rag_chunk_overlap

    def chunk(self, doc: RawDocument) -> list[Chunk]:
        pieces = self._split(doc.content, self.SEPARATORS)
        merged = self._merge(pieces)
        return [
            Chunk(
                content=text,
                source=doc.source,
                chunk_index=i,
                metadata={**doc.metadata, "chunk_index": i},
            )
            for i, text in enumerate(merged)
        ]

    def _split(self, text: str, separators: list[str]) -> list[str]:
        if not separators:
            return [text]
        sep = separators[0]
        rest = separators[1:]
        parts = text.split(sep) if sep else list(text)
        result = []
        for part in parts:
            if self._token_len(part) > self.chunk_size:
                result.extend(self._split(part, rest))
            else:
                result.append(part)
        return [p for p in result if p.strip()]

    def _merge(self, pieces: list[str]) -> list[str]:
        chunks: list[str] = []
        current: list[str] = []
        current_len = 0

        for piece in pieces:
            piece_len = self._token_len(piece)
            if current_len + piece_len > self.chunk_size and current:
                chunks.append(" ".join(current))
                # keep overlap
                overlap_pieces: list[str] = []
                overlap_len = 0
                for p in reversed(current):
                    if overlap_len + self._token_len(p) <= self.chunk_overlap:
                        overlap_pieces.insert(0, p)
                        overlap_len += self._token_len(p)
                    else:
                        break
                current = overlap_pieces
                current_len = overlap_len
            current.append(piece)
            current_len += piece_len

        if current:
            chunks.append(" ".join(current))
        return chunks

    @staticmethod
    def _token_len(text: str) -> int:
        return max(1, len(text) // 4)
