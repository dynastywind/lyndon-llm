# RAG Module

**Path**: `backend/chat/rag/`
**Purpose**: Document ingestion pipeline and hybrid retrieval for the personal knowledge base.

---

## Key Files

| File | Role |
|---|---|
| `chat/rag/ingestion/pipeline.py` | `IngestPipeline` — end-to-end ingest orchestration |
| `chat/rag/ingestion/loader.py` | Source loaders (PDF, HTML, Markdown, plain text) |
| `chat/rag/ingestion/chunker.py` | `RecursiveChunker` — splits text into overlapping chunks |
| `chat/rag/retriever.py` | `HybridRetriever` — dense + BM25 + Reciprocal Rank Fusion |

---

## Ingestion Pipeline

```
POST /api/rag/ingest  { source: filepath | URL }
        │
        ▼
IngestPipeline.ingest(source, user_id)
    │
    ├── 1. Load
    │       get_loader(source) → loader based on extension / URL
    │       loader.load() → list[Document]  (each: page_content, metadata)
    │
    ├── 2. Chunk
    │       RecursiveChunker.chunk(documents)
    │       → list[Document] (chunk_size=512, chunk_overlap=64 chars)
    │
    ├── 3. Embed
    │       LLMGateway.embed(texts, batch_size=32)
    │       → list[list[float]]  (768-dim by default)
    │
    ├── 4. Clean replace
    │       VectorStore.delete_by_source(source, user_id)
    │       → removes any previously ingested version of this source
    │
    └── 5. Upsert
            VectorStore.upsert(ids, embeddings, documents, metadatas)
            → stores chunks in rag_knowledge_base collection
            → metadata: { source, user_id, chunk_index, page? }
```

Re-ingesting the same source (after editing a file) is safe: step 4 deletes the old chunks before inserting new ones.

---

## Supported Source Types

| Extension / Type | Loader |
|---|---|
| `.pdf` | PDF.js page-by-page extraction |
| `.md`, `.markdown` | Plain text (preserves markdown) |
| `.html`, `.htm` | BeautifulSoup4 text extraction |
| `.txt`, `.csv`, `.log` | Plain text |
| `http://`, `https://` | HTTPX fetch → HTML loader |

---

## Chunking

`RecursiveChunker` splits on paragraph boundaries first, then sentences, then characters. This keeps semantic units together when possible.

```
rag_chunk_size: int = 512    # max chars per chunk
rag_chunk_overlap: int = 64  # overlap between consecutive chunks
```

Each chunk carries forward the source document's metadata plus a `chunk_index` field.

---

## Hybrid Retriever

`HybridRetriever.retrieve(query, user_id, top_k)` combines dense and sparse retrieval:

```
retrieve(query, user_id)
    │
    ├── Dense retrieval
    │       LLMGateway.embed([query]) → query vector
    │       VectorStore.query(
    │           query_embeddings=[vector],
    │           n_results = rag_top_k * 2,   # over-fetch for RRF
    │           where = { "user_id": user_id }
    │       ) → dense_results
    │
    ├── Sparse retrieval (BM25)
    │       TF-IDF rank on the text of dense_results candidates
    │       → sparse_scores
    │
    └── Reciprocal Rank Fusion
            combined_score = (1 - rag_bm25_weight) * dense_rank_score
                           + rag_bm25_weight * sparse_rank_score
            sort by combined_score descending
            → top rag_top_k (default 6) RetrievedChunk objects
```

### RetrievedChunk

```python
@dataclass
class RetrievedChunk:
    content: str
    source: str      # filename or URL
    score: float     # combined RRF score
    metadata: dict   # chunk_index, page, user_id, …
```

### RAG Context Injection

`ChatEngine` formats the top chunks into a plain-text block and prepends it to the system prompt (capped at `MAX_CONTEXT_CHARS = 6000`). Format:

```
## Retrieved Context

[Source: report.pdf]
<chunk content>

[Source: notes.md]
<chunk content>
```

The model is instructed to cite source filenames in its response.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `rag_chunk_size` | `512` | Max chars per chunk |
| `rag_chunk_overlap` | `64` | Overlap between chunks |
| `rag_top_k` | `6` | Chunks returned per retrieval |
| `rag_bm25_weight` | `0.3` | Weight for sparse (BM25) component |

---

## Integration Points

| Dependency | Used for |
|---|---|
| `LLMGateway.embed()` | Embed chunks during ingest and query at retrieval |
| `VectorStore` (`rag_knowledge_base` collection) | Store and query chunks |
| `ChatEngine._retrieve()` | Called when `decision.needs_rag` is true |
| `RAGQueryTool` | On-demand retrieval during the agentic tool loop |
