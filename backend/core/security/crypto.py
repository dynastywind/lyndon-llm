"""
Memory-at-rest encryption.

PII accumulated by the memory system (cross-session / session files, Chroma
documents) is encrypted before it touches disk and decrypted only in-process
when the prompt is assembled for the LOCAL model. Anyone reading the files, a
DB dump, or a backup sees only ciphertext.

Key management
--------------
A per-scope key is derived from the server master secret
(``settings.jwt_secret_key``) with HKDF-SHA256, using the scope id as the HKDF
``info``. The scope id is:

  - ``user_id``    for the cross-session file (one key per user)
  - ``session_id`` for per-session files
  - ``user_id or session_id`` for Chroma documents (matches the retrieval
    filter, so the same key is always re-derivable on read)

This protects against stolen disk / DB / backups. A fully compromised server
that holds the master secret can still decrypt — an accepted trade-off so that
background memory updates work while the user is offline.

Backward compatibility
-----------------------
``decrypt`` returns the input unchanged when it is not a valid token for the
given scope (``InvalidToken``). Pre-existing plaintext files/docs therefore keep
loading and are re-encrypted on their next write. A wrong-scope token also fails
to decrypt and is returned as-is (ciphertext) — never another scope's plaintext.
"""

from __future__ import annotations

import base64
import logging

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from config.settings import settings

logger = logging.getLogger(__name__)

# Static application salt — domain-separates these keys from any other HKDF use
# of the same master secret. Not secret; safe to keep in source.
_APP_SALT = b"lyndonllm.memory.encryption.v1"

# Fernet tokens are url-safe base64 beginning with the version byte 0x80 → "gA".
# Used as a cheap pre-check to skip decryption of obvious plaintext.
_TOKEN_PREFIX = "gA"


class MemoryCipher:
    """Per-scope envelope encryption for memory at rest."""

    def __init__(self, master_secret: str | None = None) -> None:
        # master_secret=None → derive keys from settings.jwt_secret_key (the
        # normal runtime path). An explicit secret is used only by the re-key
        # tooling, which needs to operate two ciphers (old key + new key) at once.
        self._cache: dict[str, Fernet] = {}
        self._warned_default = False
        self._master_secret = master_secret

    @property
    def enabled(self) -> bool:
        # An explicitly-keyed cipher (re-key tooling) is always active, even if
        # the runtime toggle is off.
        return self._master_secret is not None or settings.memory_encryption_enabled

    def _secret(self) -> str:
        return self._master_secret if self._master_secret is not None else settings.jwt_secret_key

    def _fernet(self, scope_id: str) -> Fernet:
        cached = self._cache.get(scope_id)
        if cached is not None:
            return cached

        secret = self._secret()
        if secret == "change-me-in-production" and not self._warned_default:
            logger.warning(
                "memory encryption is using the default jwt_secret_key — set a real "
                "JWT_SECRET_KEY in production or stored PII is trivially decryptable"
            )
            self._warned_default = True

        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=_APP_SALT,
            info=scope_id.encode("utf-8"),
        )
        key = hkdf.derive(secret.encode("utf-8"))
        fernet = Fernet(base64.urlsafe_b64encode(key))
        self._cache[scope_id] = fernet
        return fernet

    def encrypt(self, plaintext: str, scope_id: str) -> str:
        """Encrypt *plaintext* for *scope_id*. No-op when disabled or scope is empty."""
        if not self.enabled or not scope_id or plaintext == "":
            return plaintext
        token = self._fernet(scope_id).encrypt(plaintext.encode("utf-8"))
        return token.decode("ascii")

    def decrypt(self, token: str, scope_id: str) -> str:
        """Decrypt *token* for *scope_id*.

        Returns the input unchanged if it is not a valid token for this scope
        (legacy plaintext, wrong scope, or encryption disabled), so reads never
        raise and never leak another scope's data.
        """
        if not self.enabled or not scope_id or not token:
            return token
        if not token.startswith(_TOKEN_PREFIX):
            return token  # plaintext written before encryption was enabled
        try:
            return self._fernet(scope_id).decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError):
            return token

    def try_decrypt(self, token: str, scope_id: str) -> str | None:
        """Strict decrypt for re-key tooling.

        Returns the plaintext, or ``None`` when *token* is genuine ciphertext
        that cannot be decrypted with this scope/key. Legacy plaintext (no token
        prefix) is returned unchanged. Unlike :meth:`decrypt`, a decryption
        failure is signalled (None) rather than silently returning ciphertext —
        so a re-key run can abort on a wrong old key before overwriting data.
        """
        if not token or not scope_id:
            return token
        if not token.startswith(_TOKEN_PREFIX):
            return token  # plaintext
        try:
            return self._fernet(scope_id).decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError):
            return None


# Module-level singleton — import this everywhere.
memory_cipher = MemoryCipher()
