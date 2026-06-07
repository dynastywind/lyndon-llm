# RAG Module

**Path**: `backend/chat/rag/`
**Purpose**: Document & image ingestion pipeline and hybrid retrieval for the personal knowledge base.

---

## Key Files

| File | Role |
|---|---|
| `chat/rag/ingestion/pipeline.py` | `IngestPipeline` — end-to-end ingest orchestration (text + image) |
| `chat/rag/ingestion/loader.py` | Source loaders (PDF, Markdown, code, web page, plain text) |
| `chat/rag/ingestion/chunker.py` | `RecursiveChunker` — splits text into overlapping chunks |
| `chat/rag/retriever.py` | `HybridRetriever` (dense + BM25 + RRF) and `ImageRetriever` (CLIP) |
| `api/routes/rag.py` | Upload / list / reindex / delete endpoints (mounted at `/api/rag`) |

---

## Ingestion Pipeline

```
POST /api/rag/upload  (multipart file)
        │  saved to data/rag_uploads/<user_id>/<filename>
        ▼
IngestPipeline.ingest(source, user_id=None, project_id=None) -> int   (async; returns #chunks)
    │
    ├── Image branch  (.jpg/.jpeg/.png/.gif/.webp → _ingest_image)
    │       clip_embedder.embed_images([source])      # one vector, no chunking
    │       → upsert into `rag_image_knowledge_base`  (vector_size = clip_dimension 512)
    │
    └── Text branch
        ├── 1. Load
        │       get_loader(source) → loader by URL / extension
        │       loader.load(source) → list[RawDocument]  (content, source, metadata)
        │
        ├── 2. Chunk
        │       RecursiveChunker.chunk(doc) per document
        │       → list[Chunk] (chunk_size=512, chunk_overlap=64 chars, + chunk_index)
        │
        ├── 3. Embed
        │       llm_gateway.embed(batch) in batches of 32  → 768-dim vectors
        │
        ├── 4. Clean replace
        │       VectorStore.delete_by_source(source)   # drop prior version of this source
        │
        └── 5. Upsert into `rag_knowledge_base`
                ids       = f"{source}::{i}"   (global running index across all chunks)
                metadatas = { source, **chunk.metadata, user_id?, project_id? }
```

Re-ingesting the same source (or `POST /api/rag/reindex`) is safe: step 4 deletes the old chunks before inserting new ones. `IngestPipeline.ingest_directory(directory, glob="**/*")` recursively ingests every supported file in a tree.

> **Note**: PDF text is extracted with the Python **`pypdf`** library (not PDF.js — that's only used in the frontend viewer).

---

## Supported Source Types

`get_loader()` dispatches by URL prefix, then file extension:

| Source | Loader | Notes |
|---|---|---|
| `http://`, `https://` | `WebPageLoader` | HTTPX fetch → BeautifulSoup4 text extraction |
| `.pdf` | `PDFLoader` | `pypdf`, page-by-page; metadata `{page, total_pages}` (1-indexed) |
| `.md`, `.mdx` | `MarkdownLoader` | Plain text, preserves markdown |
| code: `.py` `.ts` `.tsx` `.js` `.jsx` `.go` `.rs` `.java` `.cpp` `.c` `.rb` `.sh` `.yaml` `.toml` | `CodeLoader` | Tags metadata `{type: "code", language, filename}` |
| images: `.jpg` `.jpeg` `.png` `.gif` `.webp` | (image branch) | CLIP embed, separate collection |
| anything else (e.g. `.txt`) | `TextLoader` | Plain-text fallback |

The **upload** endpoint restricts accepted files to the text extensions above plus image extensions (`ALLOWED_EXTENSIONS` in `api/routes/rag.py`). There is **no dedicated local `.html`/`.htm`/`.csv`/`.log` loader** — such files fall through to `TextLoader` if uploaded.

---

## Chunking

`RecursiveChunker` splits recursively, trying coarser separators first so semantic units stay together:

```python
SEPARATORS = ["\n\n", "\n", ". ", " ", ""]   # paragraph → line → sentence → word → char
rag_chunk_size:    int = 512   # max chars per chunk
rag_chunk_overlap: int = 64    # overlap between consecutive chunks
```

Each `Chunk` carries the source document's metadata plus a `chunk_index` (per-document, resets at 0 for each page/section — the upsert ID uses a separate global index to stay unique).

---

## Hybrid Retriever

`HybridRetriever.retrieve(query, top_k=None, user_id=None, project_id=None)` (async; `top_k` defaults to `rag_top_k`) combines dense and sparse retrieval:

```
retrieve(query)
    │
    ├── Dense retrieval
    │       llm_gateway.embed([query]) → query vector
    │       VectorStore.query(n_results = top_k * 2, where = scope(user_id, project_id))
    │       → dense candidates
    │
    ├── Sparse retrieval (BM25 approximation)
    │       TF-IDF-style scoring over the *dense candidates'* text
    │       → sparse ranking
    │
    └── Reciprocal Rank Fusion  (rank-based, k = 60)
            for rank, chunk in dense:  score[key] += dense_w / (k + rank + 1)
            for rank, chunk in sparse: score[key] += bm25_w / (k + rank + 1)
            #   bm25_w = rag_bm25_weight (0.3),  dense_w = 1 - bm25_w
            #   key = chunk.content[:80]  (dedup of near-identical chunks)
            sort by score desc → list[RetrievedChunk]
```

`ChatEngine._retrieve()` then trims to `rag_top_k` and caps the injected text at `MAX_CONTEXT_CHARS = 6000`.

### RetrievedChunk

```python
@dataclass
class RetrievedChunk:
    content: str
    source: str      # filename or URL
    score: float     # fused RRF score (or cosine similarity for images)
    metadata: dict   # chunk_index, page/total_pages, user_id, project_id, …
```

---

## Image Retriever

`ImageRetriever.retrieve(query, top_k=None, user_id=None, project_id=None)` does **cross-modal** search: the text query is encoded with CLIP's *text* encoder and matched against the image vectors in `rag_image_knowledge_base`.

- Cheap gate: if no images are indexed, it returns immediately without loading the ~350 MB CLIP model.
- Results below `rag_image_min_similarity` (0.20 cosine) are dropped so unrelated images are never injected.
- Returns up to `rag_image_top_k` (2) `RetrievedChunk`s; matched images are attached to the chat as visual content.

---

## RAG Context Injection

`engine._format_context(chunks, image_chunks)` formats retrieved text/images into a block prepended to the system prompt (capped at `MAX_CONTEXT_CHARS = 6000`):

```
## Retrieved context

[1] Source: report.pdf
<chunk content>

---

[2] Source: notes.md
<chunk content>

---

[image] diagram.png (attached below for visual reference)
```

Text chunks are **numbered** and separated by `---`; image markers reference the filename (the image itself is attached below). The model is instructed to cite source filenames in its response.

---

## API Endpoints

All mounted under `/api/rag` (auth required):

| Method & Path | Purpose |
|---|---|
| `POST /upload` | Multipart file upload → save under `data/rag_uploads/<user_id>/` → ingest |
| `GET /sources` | List ingested sources (pagination + search) |
| `GET /sources/check` | Check whether a source already exists |
| `GET /sources/content` | Return a stored file's content for the viewer |
| `POST /reindex` | Re-ingest an already-uploaded file |
| `DELETE /sources` | Remove a source from the vector store (and optionally delete the file) |

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `rag_chunk_size` | `512` | Max chars per chunk |
| `rag_chunk_overlap` | `64` | Overlap between chunks |
| `rag_top_k` | `6` | Text chunks returned per retrieval |
| `rag_bm25_weight` | `0.3` | Weight of the sparse (BM25) component in RRF |
| `embedding_dimension` | `768` | Text embedding dimensionality |
| `clip_model` | `"ViT-B-32"` | CLIP model for image embeddings |
| `clip_pretrained` | `"laion2b_s34b_b79k"` | CLIP pretrained weights |
| `clip_dimension` | `512` | CLIP output dim (image collection vector size) |
| `image_collection_name` | `"rag_image_knowledge_base"` | Vector collection for images |
| `rag_image_top_k` | `2` | Max images retrieved per query |
| `rag_image_min_similarity` | `0.20` | Cosine threshold to inject an image |

---

## Integration Points

| Dependency | Used for |
|---|---|
| `llm_gateway.embed()` | Embed text chunks during ingest and the query at retrieval |
| `clip_embedder` | Embed images (ingest) and text queries (image retrieval) |
| `VectorStore` (`rag_knowledge_base`, `rag_image_knowledge_base`) | Store and query vectors |
| `ChatEngine._retrieve()` | Called when the orchestrator decision needs RAG; merges text + image context |
| `RAGQueryTool` | On-demand retrieval during the agentic tool loop |
| `project_context.py` | Project-scoped ingest/retrieval via the `project_id` metadata field |
