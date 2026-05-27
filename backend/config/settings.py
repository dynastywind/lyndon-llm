from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from enum import Enum


class Environment(str, Enum):
    development = "development"
    production = "production"


class VectorStoreBackend(str, Enum):
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
    llm_api_key: str = "local"          # local models typically ignore this
    llm_model: str = "local-model"      # override with actual model name
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.7
    llm_stream: bool = True

    # Embedding model (for RAG + memory)
    embedding_model: str = "nomic-embed-text"   # served via local model server
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
    short_term_max_tokens: int = 6000       # trigger summarisation above this
    long_term_top_k: int = 5                # memories injected per conversation
    memory_consolidation_interval: int = 10 # consolidate every N sessions

    # RAG
    rag_chunk_size: int = 512
    rag_chunk_overlap: int = 64
    rag_top_k: int = 6
    rag_bm25_weight: float = 0.3            # hybrid retrieval weight

    # Web search
    web_search_provider: str = "tavily"     # tavily | serpapi
    tavily_api_key: str = ""
    serpapi_api_key: str = ""
    web_search_max_results: int = 5

    # Cowork
    cowork_shell_timeout: int = 30          # seconds
    cowork_max_plan_steps: int = 20

    # Code
    code_default_repo_path: str = ""        # default repo to open
    vercel_token: str = ""

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Session
    session_ttl_seconds: int = 86400        # 24 hours


settings = Settings()
