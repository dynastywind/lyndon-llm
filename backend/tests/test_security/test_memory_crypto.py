"""Tests for memory-at-rest encryption (core/security/crypto.py)."""

from __future__ import annotations

import pytest


@pytest.fixture
def cipher(monkeypatch):
    """A fresh MemoryCipher with encryption enabled and a fixed master key."""
    from config.settings import settings
    from core.security.crypto import MemoryCipher

    monkeypatch.setattr(settings, "memory_encryption_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret_key", "test-master-secret")
    return MemoryCipher()


def test_round_trip_per_scope(cipher):
    plaintext = "## User Profile\n- SSN: 150-31-5288"
    token = cipher.encrypt(plaintext, "user-A")
    assert token != plaintext
    assert "150-31-5288" not in token  # no PII in ciphertext
    assert token.startswith("gA")  # Fernet token shape
    assert cipher.decrypt(token, "user-A") == plaintext


def test_wrong_scope_does_not_reveal_plaintext(cipher):
    plaintext = "- Address: 55 River Oaks Pl"
    token = cipher.encrypt(plaintext, "user-A")
    # Decrypting with a different scope must NOT return the real plaintext.
    result = cipher.decrypt(token, "user-B")
    assert result != plaintext
    assert "River Oaks" not in result
    # It returns the (still-encrypted) token, never another scope's data.
    assert result == token


def test_legacy_plaintext_passes_through(cipher):
    # Content written before encryption was enabled has no token prefix.
    legacy = "# Cross-Session Memory\n## User Profile\n- Gender: Male"
    assert cipher.decrypt(legacy, "user-A") == legacy


def test_disabled_is_passthrough(monkeypatch):
    from config.settings import settings
    from core.security.crypto import MemoryCipher

    monkeypatch.setattr(settings, "memory_encryption_enabled", False)
    monkeypatch.setattr(settings, "jwt_secret_key", "test-master-secret")
    c = MemoryCipher()

    plaintext = "- SSN: 150-31-5288"
    token = c.encrypt(plaintext, "user-A")
    assert token == plaintext  # no-op
    assert c.decrypt(token, "user-A") == plaintext


def test_empty_scope_or_text_is_noop(cipher):
    assert cipher.encrypt("hello", "") == "hello"  # no scope → cannot derive key
    assert cipher.encrypt("", "user-A") == ""
    assert cipher.decrypt("", "user-A") == ""


def test_try_decrypt_signals_failure(monkeypatch):
    """try_decrypt returns None on a wrong key (used by re-key tooling to abort)."""
    from config.settings import settings
    from core.security.crypto import MemoryCipher

    monkeypatch.setattr(settings, "memory_encryption_enabled", True)

    old = MemoryCipher(master_secret="old-secret")
    new = MemoryCipher(master_secret="new-secret")

    token = old.encrypt("- SSN: 150-31-5288", "user-A")
    # Right key → plaintext; wrong key → None (not silent ciphertext).
    assert old.try_decrypt(token, "user-A") == "- SSN: 150-31-5288"
    assert new.try_decrypt(token, "user-A") is None
    # Legacy plaintext (no token prefix) passes through.
    assert old.try_decrypt("# plain header", "user-A") == "# plain header"


def test_rekey_round_trip(monkeypatch):
    """Decrypt with old key, re-encrypt with new key — readable only under new."""
    from config.settings import settings
    from core.security.crypto import MemoryCipher

    monkeypatch.setattr(settings, "memory_encryption_enabled", True)

    old = MemoryCipher(master_secret="old-secret")
    new = MemoryCipher(master_secret="new-secret")

    plaintext = "## User Profile\n- Gender: Male"
    old_token = old.encrypt(plaintext, "user-A")

    # Re-key: decrypt with old, re-encrypt with new.
    recovered = old.try_decrypt(old_token, "user-A")
    assert recovered == plaintext
    new_token = new.encrypt(recovered, "user-A")

    assert new.decrypt(new_token, "user-A") == plaintext  # readable under new key
    assert new_token != old_token
