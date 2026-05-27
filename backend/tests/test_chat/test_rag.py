"""
End-to-end RAG tests.

Requires:
  - ChromaDB running at localhost:8001  (docker compose up chroma)
  - Ollama running at localhost:11434   (nomic-embed-text loaded)
"""
import os
import sys
import tempfile
import pytest

# Ensure backend/ is on sys.path when running from the repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


@pytest.mark.asyncio
async def test_ingest_and_retrieve_markdown(tmp_path):
    """Ingest a markdown file and retrieve a passage from it."""
    from chat.rag.ingestion.pipeline import IngestPipeline
    from chat.rag.retriever import HybridRetriever

    # Write a small markdown doc
    doc = tmp_path / "test.md"
    doc.write_text(
        "# LyndonLLM Architecture\n\n"
        "LyndonLLM is a personal agent with three blocks: Chat, Cowork, and Code.\n\n"
        "The Chat block handles general Q&A, RAG, and memory management.\n"
        "The Cowork block lets the agent plan and execute multi-step tasks.\n"
        "The Code block connects to a local git repo and writes code.\n"
    )

    pipeline = IngestPipeline()
    count = await pipeline.ingest(str(doc))
    assert count > 0, "Expected at least one chunk to be ingested"

    retriever = HybridRetriever()
    results = await retriever.retrieve("What are the three blocks of LyndonLLM?")
    assert len(results) > 0, "Expected at least one result"

    combined = " ".join(r.content for r in results).lower()
    assert "chat" in combined or "cowork" in combined or "code" in combined


@pytest.mark.asyncio
async def test_ingest_plain_text(tmp_path):
    """Ingest a plain text file."""
    from chat.rag.ingestion.pipeline import IngestPipeline

    doc = tmp_path / "notes.txt"
    doc.write_text(
        "The capital of France is Paris.\n"
        "Paris is known for the Eiffel Tower and fine cuisine.\n"
    )

    pipeline = IngestPipeline()
    count = await pipeline.ingest(str(doc))
    assert count > 0


@pytest.mark.asyncio
async def test_metadata_includes_source(tmp_path):
    """Source path must be stored in metadata so retrieval can surface it."""
    from chat.rag.ingestion.pipeline import IngestPipeline
    from chat.rag.retriever import HybridRetriever

    doc = tmp_path / "info.md"
    doc.write_text("Quantum computing uses qubits instead of classical bits.\n")

    pipeline = IngestPipeline()
    await pipeline.ingest(str(doc))

    retriever = HybridRetriever()
    results = await retriever.retrieve("quantum computing qubits")
    assert results, "Expected retrieval results"
    assert results[0].source != "unknown", (
        f"Source should be the file path, got: {results[0].source!r}"
    )


@pytest.mark.asyncio
async def test_retrieve_returns_empty_on_empty_kb():
    """Retriever should not crash on an empty knowledge base."""
    from chat.rag.retriever import HybridRetriever
    # Use a separate collection name so it doesn't share state with other tests
    retriever = HybridRetriever()
    retriever.COLLECTION_NAME = "test_empty_collection"
    results = await retriever.retrieve("anything")
    assert isinstance(results, list)
