"""Tests for the memory re-key script (scripts/rekey_memory.py)."""

from __future__ import annotations

import os
import sys

import pytest

# Ensure the backend root is importable so `scripts` resolves under pytest.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "memory_encryption_enabled", True)


def test_rekey_files_round_trip(tmp_path, monkeypatch):
    from config.settings import settings
    from core.security.crypto import MemoryCipher
    from scripts.rekey_memory import rekey_files

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))
    old = MemoryCipher(master_secret="old-secret")
    new = MemoryCipher(master_secret="new-secret")

    cross = tmp_path / "cross_session_userA.md"
    cross.write_text(old.encrypt("## User Profile\n- SSN: 150-31-5288", "userA"), encoding="utf-8")
    sess = tmp_path / "sess1.md"
    sess.write_text(old.encrypt("## Conversation Summary\nhi", "sess1"), encoding="utf-8")
    # a legacy plaintext file (no token) should also get encrypted under new key
    legacy = tmp_path / "cross_session_userB.md"
    legacy.write_text("# Cross-Session Memory\n## User Profile\n- Gender: Male", encoding="utf-8")

    n = rekey_files(old, new, dry_run=False)
    assert n == 3

    # Now decryptable under the NEW key only.
    assert new.decrypt(cross.read_text(), "userA") == "## User Profile\n- SSN: 150-31-5288"
    assert old.try_decrypt(cross.read_text(), "userA") is None
    assert "Gender: Male" in new.decrypt(legacy.read_text(), "userB")


def test_rekey_aborts_on_wrong_old_key_without_writing(tmp_path, monkeypatch):
    from config.settings import settings
    from core.security.crypto import MemoryCipher
    from scripts.rekey_memory import RekeyError, rekey_files

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))
    old = MemoryCipher(master_secret="old-secret")
    new = MemoryCipher(master_secret="new-secret")
    wrong = MemoryCipher(master_secret="WRONG-secret")

    cross = tmp_path / "cross_session_userA.md"
    original = old.encrypt("## User Profile\n- SSN: 150-31-5288", "userA")
    cross.write_text(original, encoding="utf-8")

    # Wrong old key → abort before any write.
    with pytest.raises(RekeyError):
        rekey_files(wrong, new, dry_run=False)

    # File is untouched and still decrypts under the real old key.
    assert cross.read_text() == original
    assert old.try_decrypt(cross.read_text(), "userA") is not None


def test_rekey_dry_run_writes_nothing(tmp_path, monkeypatch):
    from config.settings import settings
    from core.security.crypto import MemoryCipher
    from scripts.rekey_memory import rekey_files

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))
    old = MemoryCipher(master_secret="old-secret")
    new = MemoryCipher(master_secret="new-secret")

    cross = tmp_path / "cross_session_userA.md"
    original = old.encrypt("## User Profile\n- Gender: Male", "userA")
    cross.write_text(original, encoding="utf-8")

    n = rekey_files(old, new, dry_run=True)
    assert n == 1
    assert cross.read_text() == original  # unchanged
