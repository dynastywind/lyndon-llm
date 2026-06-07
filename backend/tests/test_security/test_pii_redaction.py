"""Tests for PII boundary redaction (core/security/pii.py)."""

from __future__ import annotations

from core.security.pii import mask_langfuse, redact


def test_free_text_identifiers_masked():
    text = "Contact me at john.doe@example.com or 415-555-1234. SSN 150-31-5288."
    out = redact(text)
    assert "john.doe@example.com" not in out
    assert "150-31-5288" not in out
    assert "415-555-1234" not in out
    assert "[REDACTED]" in out  # email masked


def test_credit_card_masked():
    out = redact("card 4111 1111 1111 1111 on file")
    assert "4111 1111 1111 1111" not in out
    assert "1111" in out  # last-4 hint preserved


def test_structured_field_masking():
    profile = (
        "## User Profile\n"
        "- Age: 32\n"
        "- Hobbies: Video Games\n"
        "- Social Security Number: 150315 28828\n"
        "- Address: 55 River Oaks Pl Apt 586, San Jose, CA 95134\n"
        "- Employer: TIKTOK INC\n"
    )
    out = redact(profile)
    # Non-sensitive fields preserved.
    assert "- Age: 32" in out
    assert "- Hobbies: Video Games" in out
    # Sensitive values masked, field names kept.
    assert "150315 28828" not in out
    assert "55 River Oaks Pl" not in out
    assert "TIKTOK INC" not in out
    assert "Social Security Number:" in out
    assert "Address:" in out
    assert "Employer:" in out


def test_mask_langfuse_recurses():
    data = {
        "messages": [
            {"role": "system", "content": "Profile SSN 150-31-5288"},
            {"role": "user", "content": "hi"},
        ]
    }
    masked = mask_langfuse(data)
    assert "150-31-5288" not in masked["messages"][0]["content"]
    assert masked["messages"][1]["content"] == "hi"


def test_redact_handles_empty():
    assert redact("") == ""
    assert redact(None) is None
