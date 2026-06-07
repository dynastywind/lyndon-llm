"""
One-time migration: encrypt existing plaintext memory at rest.

Re-encrypts:
  1. Every `data/session_memories/*.md` file
       - cross_session_<user_id>.md  → scope = user_id
       - <session_id>.md             → scope = session_id
  2. Every document in the Chroma `long_term_memory` collection
       - scope = metadata.user_id or metadata.session_id

Idempotent: already-encrypted content (Fernet tokens starting with "gA") is
skipped, so the script is safe to run repeatedly. Run from the backend dir so
settings (and the real JWT_SECRET_KEY) load from `.env`:

    .venv/bin/python -m scripts.migrate_encrypt_memory
"""

from __future__ import annotations

import os
from pathlib import Path

from config.settings import settings
from core.security.crypto import _TOKEN_PREFIX, memory_cipher

_CROSS_PREFIX = "cross_session_"


def _scope_for(path: Path) -> str:
    stem = path.stem  # filename without ".md"
    if stem.startswith(_CROSS_PREFIX):
        return stem[len(_CROSS_PREFIX):]  # user_id
    return stem  # session_id


def migrate_files() -> tuple[int, int]:
    encrypted = skipped = 0
    mem_dir = Path(settings.session_memory_dir)
    if not mem_dir.exists():
        return 0, 0
    for path in sorted(mem_dir.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        if raw.startswith(_TOKEN_PREFIX):
            skipped += 1
            continue
        scope = _scope_for(path)
        token = memory_cipher.encrypt(raw, scope)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(token, encoding="utf-8")
        os.replace(tmp, path)
        encrypted += 1
        print(f"  encrypted file: {path.name} (scope={scope[:8]}…)")
    return encrypted, skipped


def migrate_chroma() -> tuple[int, int]:
    import chromadb

    client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
    try:
        col = client.get_collection("long_term_memory")
    except Exception:
        print("  no long_term_memory collection — skipping Chroma")
        return 0, 0

    res = col.get(include=["documents", "metadatas", "embeddings"], limit=10000)
    # Chroma returns embeddings as a numpy array — compare to None explicitly
    # (truthiness of a multi-element array is ambiguous).
    ids = res.get("ids")
    ids = list(ids) if ids is not None else []
    docs = res.get("documents")
    docs = list(docs) if docs is not None else []
    metas = res.get("metadatas")
    metas = list(metas) if metas is not None else []
    embs = res.get("embeddings")
    embs = list(embs) if embs is not None else []

    encrypted = skipped = 0
    for id_, doc, meta, emb in zip(ids, docs, metas, embs, strict=False):
        if doc.startswith(_TOKEN_PREFIX):
            skipped += 1
            continue
        scope = meta.get("user_id") or meta.get("session_id") or ""
        if not scope:
            skipped += 1
            continue
        meta = {**meta, "enc_scope": scope}  # record the scope for unambiguous reads
        token = memory_cipher.encrypt(doc, scope)
        embedding = emb.tolist() if hasattr(emb, "tolist") else emb
        col.upsert(ids=[id_], embeddings=[embedding], documents=[token], metadatas=[meta])
        encrypted += 1
    return encrypted, skipped


def main() -> None:
    if not settings.memory_encryption_enabled:
        print("memory_encryption_enabled is False — nothing to do.")
        return
    print("Migrating memory files…")
    f_enc, f_skip = migrate_files()
    print(f"  files: {f_enc} encrypted, {f_skip} already encrypted")
    print("Migrating Chroma documents…")
    c_enc, c_skip = migrate_chroma()
    print(f"  chroma: {c_enc} encrypted, {c_skip} already encrypted")
    print("Done.")


if __name__ == "__main__":
    main()
