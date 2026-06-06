# Bootstrap — Development from Scratch

End-to-end setup for a new machine. Follow the sections in order; each one assumes the previous is complete.

---

## 0. Prerequisites

| Tool | Min version | Install |
|---|---|---|
| Python | 3.11 | `brew install python@3.11` |
| Node.js | 18 | `brew install node` |
| Rust + Cargo | stable | `curl https://sh.rustup.rs -sSf \| sh` |
| Xcode CLT | any | `xcode-select --install` (macOS, required by Tauri) |
| Docker Desktop | any | [docs.docker.com](https://docs.docker.com/desktop/install/mac-install/) |
| Ollama | any | `brew install ollama` |

Verify:

```bash
python3.11 --version   # Python 3.11.x
node --version         # v18+
cargo --version        # cargo 1.x
docker info            # must show Server running
ollama --version
```

---

## 1. Clone

```bash
git clone https://github.com/your-org/lyndonLLM.git
cd lyndonLLM
```

---

## 2. Local LLM (Ollama)

The backend speaks the OpenAI-compatible API. Ollama exposes it at `http://localhost:11434/v1`.

```bash
# Start the Ollama daemon (runs in background)
ollama serve &

# Pull the default chat model
ollama pull llama3.2

# Pull the embedding model (required for RAG and long-term memory)
ollama pull nomic-embed-text
```

> **Swap models freely.** Any model in `ollama list` works — update `LLM_MODEL` in `backend/.env`.  
> **Using EXO instead?** Set `LLM_BASE_URL=http://localhost:52415/v1` and `EMBEDDING_BASE_URL` accordingly.

---

## 3. Backend

### 3.1 Virtual environment & dependencies

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate

# Install runtime + dev extras (ruff, pytest, mypy)
pip install -e ".[dev]"
```

### 3.2 Environment file

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```dotenv
# LLM — point to Ollama (default) or EXO
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=local
LLM_MODEL=llama3.2

# Embeddings — same host as LLM for Ollama
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_API_KEY=local
EMBEDDING_MODEL=nomic-embed-text

# JWT — generate a random key and paste it here
# openssl rand -hex 32
JWT_SECRET_KEY=<paste output here>
JWT_ALGORITHM=HS256
JWT_EXPIRE_DAYS=30
```

Everything else in `.env.example` has safe defaults for local development. Optional integrations:

| Setting | When needed |
|---|---|
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | LLM observability via Langfuse |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login |
| `GOOGLE_API_KEY` / `GOOGLE_CSE_ID` | Google web search provider |
| `TAVILY_API_KEY` / `SERPAPI_API_KEY` | Alternative web search providers |

### 3.3 Data directory & database

The backend stores SQLite and ChromaDB data under `backend/data/` (gitignored).

```bash
mkdir -p data
```

Run Alembic migrations to create the schema:

```bash
.venv/bin/alembic upgrade head
```

### 3.4 Vector store (ChromaDB)

Start ChromaDB via Docker Compose (data persists in a named volume):

```bash
cd ..                    # back to project root
docker compose up chroma -d
```

ChromaDB is now available at `http://localhost:8001`.  
Confirm with: `curl http://localhost:8001/api/v1/heartbeat`

### 3.5 Start the backend

```bash
cd backend
source .venv/bin/activate
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Confirm: `curl http://localhost:8000/health`  
Interactive API docs: `http://localhost:8000/docs`

---

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` with hot-reload. It proxies all `/api/*` requests to the backend at `http://localhost:8000`.

Lint and format checks:

```bash
npx eslint . --ext ts,tsx --max-warnings 0
npx prettier --write "src/**/*.{ts,tsx,css}"
```

---

## 5. Desktop (Tauri) — optional

The desktop app wraps the React frontend in a native macOS window. Skip this if you're developing in the browser.

```bash
cd desktop
npm install
npm run tauri dev
```

Tauri automatically:
1. Runs `npm --prefix ../frontend run dev` (starts the Vite dev server)
2. Opens a native window pointed at `http://localhost:5173`

Hot-reload works — changes in `frontend/src/` reload instantly in the window.

**Build a distributable `.dmg`:**

```bash
npm run tauri build
# Output: desktop/src-tauri/target/release/bundle/
#   macos/LyndonLLM.app
#   dmg/LyndonLLM_0.1.0_aarch64.dmg
```

---

## 6. Running services checklist

| Service | URL | How to start |
|---|---|---|
| Ollama | `http://localhost:11434` | `ollama serve` |
| ChromaDB | `http://localhost:8001` | `docker compose up chroma -d` |
| Backend | `http://localhost:8000` | `uvicorn api.main:app --reload` |
| Frontend | `http://localhost:5173` | `npm run dev` (in `frontend/`) |
| Desktop | native window | `npm run tauri dev` (in `desktop/`) |

Quick health check for all three server processes:

```bash
curl -s http://localhost:11434/api/tags | python3 -m json.tool  # Ollama models
curl http://localhost:8001/api/v1/heartbeat                      # ChromaDB
curl http://localhost:8000/health                                 # Backend
```

---

## 7. Lint & tests

**Backend:**

```bash
cd backend
.venv/bin/ruff check .
.venv/bin/pytest
```

**Frontend:**

```bash
cd frontend
npx eslint . --ext ts,tsx --max-warnings 0
npx prettier --check "src/**/*.{ts,tsx,css}"
```

---

## 8. Alternative: Docker Compose (backend + ChromaDB together)

Skip steps 3.4–3.5 and run the full backend stack in containers instead:

```bash
# From project root
docker compose up --build
```

This builds the backend image from `backend/Dockerfile`, starts ChromaDB, and mounts `./backend` for live code sync (`docker compose watch`).  
The frontend still runs locally via `npm run dev`.

---

## 9. Production deployment (Helm)

See `deploy/` for the Kubernetes Helm chart.

```bash
# One-time secrets setup — see .sops.yaml for age key instructions
cp deploy/values-secrets.yaml.example deploy/values-secrets.yaml
# fill in deploy/values-secrets.yaml, then:
sops --encrypt --in-place deploy/values-secrets.yaml

# Deploy
helm secrets install lyndon-llm ./deploy \
  -f deploy/values.yaml \
  -f deploy/values-secrets.yaml
```

Required tools: `age`, `sops`, `helm`, `helm-secrets` plugin.  
See `doc/backend/config.md` for the full environment variable reference.
