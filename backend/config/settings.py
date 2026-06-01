from enum import StrEnum

from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(StrEnum):
    development = "development"
    production = "production"


class VectorStoreBackend(StrEnum):
    chroma = "chroma"
    qdrant = "qdrant"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # App
    app_name: str = "LyndonLLM"
    environment: Environment = Environment.development
    debug: bool = True

    # LLM
    llm_base_url: str = "http://localhost:52415/v1"
    llm_api_key: str = "local"  # local models typically ignore this
    llm_model: str = "local-model"  # override with actual model name
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.7
    llm_stream: bool = True

    # Embedding model (for RAG + memory)
    embedding_model: str = "nomic-embed-text"  # served via local model server
    embedding_base_url: str = "http://localhost:52415/v1"
    embedding_api_key: str = "local"
    embedding_dimension: int = 768

    # Vector store
    vector_store_backend: VectorStoreBackend = VectorStoreBackend.chroma
    chroma_host: str = "localhost"
    chroma_port: int = 8001
    chroma_persist_dir: str = "./data/chroma"
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_api_key: str = ""

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/lyndon.db"

    # Memory
    short_term_max_tokens: int = 6000  # trigger summarisation above this
    long_term_top_k: int = 5  # memories injected per conversation
    memory_consolidation_interval: int = 10  # consolidate every N sessions
    session_memory_dir: str = "data/session_memories"  # per-session memory files

    # RAG
    rag_chunk_size: int = 512
    rag_chunk_overlap: int = 64
    rag_top_k: int = 6
    rag_bm25_weight: float = 0.3  # hybrid retrieval weight

    # Chat orchestrator (route: direct | rag | tools | rag_and_tools)
    orchestrator_enabled: bool = True
    orchestrator_strategy: str = "heuristic"  # heuristic | llm (future)

    # Web search
    web_search_provider: str = "duckduckgo"  # duckduckgo | google | tavily | serpapi
    web_search_max_results: int = 5
    # DuckDuckGo — no key required
    # Google Custom Search (optional upgrade)
    google_api_key: str = ""
    google_cse_id: str = ""
    # Tavily / SerpAPI (legacy)
    tavily_api_key: str = ""
    serpapi_api_key: str = ""

    # Cowork
    cowork_shell_timeout: int = 30  # seconds
    cowork_max_plan_steps: int = 20

    # Sandbox
    sandbox_timeout: int = 60  # max seconds per run (60s for compiled langs)

    # Code
    code_default_repo_path: str = ""  # default repo to open
    vercel_token: str = ""

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = [
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # alternate dev port
        "tauri://localhost",  # Tauri desktop app (production build)
        "http://tauri.localhost",  # Tauri on some platforms
    ]

    # Session
    session_ttl_seconds: int = 86400  # 24 hours

    # Auth — JWT
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30

    # Auth — Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/auth/google/callback"
    frontend_url: str = "http://localhost:5173"
    oauth_pending_expire_minutes: int = 10

    # Langfuse observability (leave blank to disable)
    langfuse_secret_key: str = ""
    langfuse_public_key: str = ""
    langfuse_host: str = "https://jp.cloud.langfuse.com"


settings = Settings()
