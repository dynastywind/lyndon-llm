"""
Document Loaders — reads source files into raw text.
Supported: PDF, Markdown, plain text, web pages, code files.
"""

from __future__ import annotations

from pathlib import Path
import re
from typing import Protocol


class RawDocument:
    def __init__(self, content: str, source: str, metadata: dict | None = None):
        self.content = content
        self.source = source
        self.metadata = metadata or {}


class Loader(Protocol):
    async def load(self, source: str) -> list[RawDocument]: ...


class PDFLoader:
    async def load(self, path: str) -> list[RawDocument]:
        try:
            import pypdf
        except ImportError as exc:
            raise ImportError("Install pypdf: pip install pypdf") from exc

        reader = pypdf.PdfReader(path)
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(
                    RawDocument(
                        content=text,
                        source=path,
                        metadata={"page": i + 1, "total_pages": len(reader.pages)},
                    )
                )
        return pages


class MarkdownLoader:
    async def load(self, path: str) -> list[RawDocument]:
        text = Path(path).read_text(encoding="utf-8")
        return [RawDocument(content=text, source=path, metadata={"type": "markdown"})]


class TextLoader:
    async def load(self, path: str) -> list[RawDocument]:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
        return [RawDocument(content=text, source=path, metadata={"type": "text"})]


class CodeLoader:
    """Loads source code files with language metadata."""

    EXTENSION_MAP = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".go": "go",
        ".rs": "rust",
        ".java": "java",
        ".cpp": "cpp",
        ".c": "c",
        ".rb": "ruby",
        ".sh": "bash",
        ".yaml": "yaml",
        ".toml": "toml",
    }

    async def load(self, path: str) -> list[RawDocument]:
        p = Path(path)
        text = p.read_text(encoding="utf-8", errors="replace")
        lang = self.EXTENSION_MAP.get(p.suffix.lower(), "unknown")
        return [
            RawDocument(
                content=text,
                source=path,
                metadata={"type": "code", "language": lang, "filename": p.name},
            )
        ]


class WebPageLoader:
    async def load(self, url: str) -> list[RawDocument]:
        try:
            from bs4 import BeautifulSoup
            import httpx
        except ImportError as exc:
            raise ImportError("Install httpx and beautifulsoup4") from exc

        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            response = await client.get(url)
            response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        # Remove nav, footer, scripts
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()

        text = soup.get_text(separator="\n")
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return [RawDocument(content=text, source=url, metadata={"type": "webpage"})]


def get_loader(source: str) -> Loader:
    """Auto-detect loader from source string."""
    if source.startswith("http://") or source.startswith("https://"):
        return WebPageLoader()
    p = Path(source)
    ext = p.suffix.lower()
    if ext == ".pdf":
        return PDFLoader()
    if ext in {".md", ".mdx"}:
        return MarkdownLoader()
    if ext in CodeLoader.EXTENSION_MAP:
        return CodeLoader()
    return TextLoader()
