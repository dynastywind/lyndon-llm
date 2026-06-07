"""End-to-end: PII is ciphertext on disk but decrypts transparently on load."""

from __future__ import annotations


def test_cross_session_file_is_encrypted_on_disk(tmp_path, monkeypatch):
    from chat.memory import cross_session_file as csf
    from config.settings import settings

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))
    monkeypatch.setattr(settings, "memory_encryption_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret_key", "test-master-secret")

    mem = csf.CrossSessionFileMemory("user-A")
    mem.save("## User Profile\n- SSN: 150-31-5288\n- Address: 55 River Oaks Pl")

    # On disk: no plaintext PII, looks like a Fernet token.
    raw = mem._path.read_text(encoding="utf-8")
    assert "150-31-5288" not in raw
    assert "River Oaks" not in raw
    assert "User Profile" not in raw
    assert raw.startswith("gA")

    # In-process load() returns the real plaintext (what the local model sees).
    loaded = mem.load()
    assert "150-31-5288" in loaded
    assert "55 River Oaks Pl" in loaded


def test_session_file_is_encrypted_on_disk(tmp_path, monkeypatch):
    from chat.memory.session_file import SessionFileMemory
    from config.settings import settings

    monkeypatch.setattr(settings, "session_memory_dir", str(tmp_path))
    monkeypatch.setattr(settings, "memory_encryption_enabled", True)
    monkeypatch.setattr(settings, "jwt_secret_key", "test-master-secret")

    sf = SessionFileMemory()
    sf.save("sess-1", "## Conversation Summary\nUser shared SSN 150-31-5288.")

    raw = sf._path("sess-1").read_text(encoding="utf-8")
    assert "150-31-5288" not in raw
    assert raw.startswith("gA")

    assert "150-31-5288" in sf.load("sess-1")
