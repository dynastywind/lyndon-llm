"""
PII redaction for boundaries that leave the device.

Memory is decrypted in-process and revealed in full to the LOCAL model, but it
must be masked anywhere it crosses a trust boundary:
  - ``/memory`` and ``/memories`` API responses (rendered in the UI)
  - Langfuse spans (exported to a cloud host)

Two complementary strategies:
  1. Field-name masking for our structured ``- Field: value`` memory lines whose
     key matches a PII allowlist (the value is masked, the field name kept).
  2. Free-text regex masking for SSN / credit-card / phone / email anywhere.
"""

from __future__ import annotations

import re

# --- Free-text identifiers ---------------------------------------------------- #

_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_SSN_RE = re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b")
_CREDIT_CARD_RE = re.compile(r"\b(?:\d[ -]?){13,16}\b")
# Phone: optional +cc then 10+ digits with common separators. Kept conservative
# to avoid masking ordinary numbers; applied after SSN so it doesn't double-hit.
_PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b")

# --- Structured field allowlist ----------------------------------------------- #
# Matches the key in a "- <Field>: <value>" memory line (case-insensitive).
_PII_FIELD_RE = re.compile(
    r"^(\s*[-*]?\s*)"  # bullet / indentation
    r"((?:social\s*security(?:\s*number)?|ssn|tax\s*id|"
    r"address|home\s*address|street|"
    r"phone|telephone|mobile|cell|"
    r"e-?mail|"
    r"date\s*of\s*birth|dob|birth\s*date|"
    r"bank|account(?:\s*number)?|routing|iban|"
    r"passport|driver'?s?\s*licen[cs]e|national\s*id|"
    r"employer|salary|income|"
    r"upload\s*file|ip(?:\s*address)?)\s*)"
    r"(:\s*)(.+)$",
    re.IGNORECASE,
)

_MASK = "[REDACTED]"


def _mask_value(value: str) -> str:
    """Mask a value, preserving a last-4 hint for long numeric identifiers."""
    digits = re.sub(r"\D", "", value)
    if len(digits) >= 4:
        return f"***{digits[-4:]}"
    return _MASK


def _redact_freetext(text: str) -> str:
    text = _SSN_RE.sub(lambda m: _mask_value(m.group(0)), text)
    text = _CREDIT_CARD_RE.sub(lambda m: _mask_value(m.group(0)), text)
    text = _PHONE_RE.sub(lambda m: _mask_value(m.group(0)), text)
    text = _EMAIL_RE.sub(_MASK, text)
    return text


def redact(text: str) -> str:
    """Return *text* with PII masked. Safe on None/empty."""
    if not text:
        return text

    out_lines: list[str] = []
    for line in text.splitlines():
        m = _PII_FIELD_RE.match(line)
        if m:
            bullet, field, sep, value = m.groups()
            if value.strip():
                out_lines.append(f"{bullet}{field}{sep}{_mask_value(value.strip())}")
                continue
        out_lines.append(_redact_freetext(line))

    return "\n".join(out_lines)


def mask_langfuse(data):
    """Recursive PII mask for the Langfuse ``mask`` hook.

    Walks dicts/lists/strings and applies :func:`redact` to every string so no
    raw PII is exported in a traced input/output. Best-effort; never raises.
    """
    try:
        if isinstance(data, str):
            return redact(data)
        if isinstance(data, dict):
            return {k: mask_langfuse(v) for k, v in data.items()}
        if isinstance(data, (list, tuple)):
            return type(data)(mask_langfuse(v) for v in data)
    except Exception:
        return _MASK
    return data
