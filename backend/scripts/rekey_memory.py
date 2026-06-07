"""
Re-key memory at rest after a JWT_SECRET_KEY rotation.

The per-scope encryption keys are derived from JWT_SECRET_KEY. If that secret is
rotated, everything already encrypted under the old secret becomes unreadable
(the runtime falls back to returning ciphertext). This script decrypts all
memory with the OLD secret and re-encrypts it with the NEW secret.

Usage (run from the backend dir, with the NEW key already in `.env`):

    OLD_JWT_SECRET_KEY="<the previous secret>" .venv/bin/python -m scripts.rekey_memory
    # dry run (report only, write nothing):
    OLD_JWT_SECRET_KEY="<previous>" REKEY_DRY_RUN=1 .venv/bin/python -m scripts.rekey_memory

Safety
------
Two-pass and fail-closed: every ciphertext item is first decrypted with the OLD
key in memory. If ANY ciphertext item fails to decrypt (wrong OLD key), the run
ABORTS before writing anything — so a mistyped old key can never corrupt data.
Re-runnable: legacy plaintext is simply encrypted with the new key.

See doc/RUNBOOK.md for the full rotation procedure.
"""

from __future__ import annotations

import os
from pathlib import Path

from chat.memory.long_term import candidate_scopes
from config.settings import settings
from core.security.crypto import MemoryCipher

_CROSS_PREFIX = "cross_session_"
_TOKEN_PREFIX = "gA"


class RekeyError(RuntimeError):
    pass


def _scope_for(path: Path) -> str:
    stem = path.stem
    if stem.startswith(_CROSS_PREFIX):
        return stem[len(_CROSS_PREFIX):]  # user_id
    return stem  # session_id


def _decrypt_or_fail(old: MemoryCipher, raw: str, scope: str, where: str) -> str:
    """Decrypt a single-scope artifact (file) with the old key; abort if it can't."""
    pt = old.try_decrypt(raw, scope)
    if pt is None:
        raise RekeyError(
            f"could not decrypt {where} with OLD_JWT_SECRET_KEY — wrong old key? "
            "Aborting before any data is written."
        )
    return pt


def _decrypt_doc_or_fail(old: MemoryCipher, doc: str, meta: dict, where: str) -> str:
    """Decrypt a Chroma document by trying every candidate scope; abort if none work."""
    if not doc.startswith(_TOKEN_PREFIX):
        return doc  # legacy plaintext
    for scope in candidate_scopes(meta):
        pt = old.try_decrypt(doc, scope)
        if pt is not None:
            return pt
    raise RekeyError(
        f"could not decrypt {where} with OLD_JWT_SECRET_KEY under any scope — "
        "wrong old key? Aborting before any data is written."
    )


def rekey_files(old: MemoryCipher, new: MemoryCipher, dry_run: bool) -> int:
    mem_dir = Path(settings.session_memory_dir)
    if not mem_dir.exists():
        return 0
    paths = sorted(mem_dir.glob("*.md"))
    # Pass 1 — decrypt all with the old key (abort on any failure).
    pending: list[tuple[Path, str, str]] = []
    for path in paths:
        raw = path.read_text(encoding="utf-8")
        scope = _scope_for(path)
        pt = _decrypt_or_fail(old, raw, scope, f"file {path.name}")
        pending.append((path, scope, pt))
    # Pass 2 — re-encrypt with the new key.
    if dry_run:
        return len(pending)
    for path, scope, pt in pending:
        token = new.encrypt(pt, scope)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(token, encoding="utf-8")
        os.replace(tmp, path)
    return len(pending)


def rekey_chroma(old: MemoryCipher, new: MemoryCipher, dry_run: bool) -> int:
    import chromadb

    client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
    try:
        col = client.get_collection("long_term_memory")
    except Exception:
        print("  no long_term_memory collection — skipping Chroma")
        return 0

    res = col.get(include=["documents", "metadatas", "embeddings"], limit=10000)
    ids = list(res.get("ids") or [])
    docs = res.get("documents")
    docs = list(docs) if docs is not None else []
    metas = res.get("metadatas")
    metas = list(metas) if metas is not None else []
    embs = res.get("embeddings")
    embs = list(embs) if embs is not None else []

    # Pass 1 — decrypt all (abort on failure). A document may have been written
    # under either its user_id or its session_id, so try all candidate scopes.
    pending: list[tuple[str, list, dict, str, str]] = []
    for id_, doc, meta, emb in zip(ids, docs, metas, embs, strict=False):
        canonical = meta.get("user_id") or meta.get("session_id") or ""
        if not canonical:
            continue
        pt = _decrypt_doc_or_fail(old, doc, meta, f"chroma doc {id_}")
        embedding = emb.tolist() if hasattr(emb, "tolist") else emb
        pending.append((id_, embedding, meta, pt, canonical))
    # Pass 2 — re-encrypt under the canonical scope and record it (enc_scope) so
    # future reads are unambiguous.
    if dry_run:
        return len(pending)
    for id_, embedding, meta, pt, canonical in pending:
        meta = {**meta, "enc_scope": canonical}
        token = new.encrypt(pt, canonical)
        col.upsert(ids=[id_], embeddings=[embedding], documents=[token], metadatas=[meta])
    return len(pending)


def main() -> None:
    old_secret = os.environ.get("OLD_JWT_SECRET_KEY")
    if not old_secret:
        raise SystemExit("OLD_JWT_SECRET_KEY env var is required (the previous secret).")
    new_secret = os.environ.get("NEW_JWT_SECRET_KEY") or settings.jwt_secret_key
    dry_run = os.environ.get("REKEY_DRY_RUN") in {"1", "true", "True"}

    if old_secret == new_secret:
        print("OLD and NEW secrets are identical — nothing to re-key.")
        return

    old = MemoryCipher(master_secret=old_secret)
    new = MemoryCipher(master_secret=new_secret)

    mode = "DRY RUN — no writes" if dry_run else "re-keying"
    print(f"{mode}: old key → new key")
    try:
        n_files = rekey_files(old, new, dry_run)
        print(f"  files:  {n_files} {'would be ' if dry_run else ''}re-keyed")
        n_chroma = rekey_chroma(old, new, dry_run)
        print(f"  chroma: {n_chroma} {'would be ' if dry_run else ''}re-keyed")
    except RekeyError as err:
        raise SystemExit(f"ABORTED: {err}") from err
    print("Done." if not dry_run else "Dry run complete — re-run without REKEY_DRY_RUN to apply.")


if __name__ == "__main__":
    main()
