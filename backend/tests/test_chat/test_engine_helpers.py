"""
Regression tests for pure helper functions in chat/engine.py.

These functions have no I/O and are easy to test directly.  A regression
here would silently corrupt messages sent to the LLM or stored in the DB.

Covers:
  - _parse_tool_calls_from_content  (EXO/Llama 3.x synthetic tool-call parser)
  - _inject_attachments             (multimodal message patching)
  - _inject_first_message_context   (system/session prompt injection)
  - _inject_tool_results            (EXO fallback: results into user message)
  - _chart_spec_to_markdown         (chart spec round-trip format)
  - _extract_json_objects           (brace-counting JSON extractor)
"""

from __future__ import annotations

import base64
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


# ── _extract_json_objects ─────────────────────────────────────────────────────


def test_extract_json_objects_single():
    from chat.engine import _extract_json_objects

    result = _extract_json_objects('{"name": "web_search", "parameters": {"query": "test"}}')
    assert len(result) == 1
    assert result[0]["name"] == "web_search"


def test_extract_json_objects_multiple_in_text():
    from chat.engine import _extract_json_objects

    text = 'Some prefix {"name": "a"} middle {"name": "b"} suffix'
    result = _extract_json_objects(text)
    assert len(result) == 2
    assert result[0]["name"] == "a"
    assert result[1]["name"] == "b"


def test_extract_json_objects_nested():
    from chat.engine import _extract_json_objects

    text = '{"name": "search", "parameters": {"q": "hello", "n": 3}}'
    result = _extract_json_objects(text)
    assert len(result) == 1
    assert result[0]["parameters"]["q"] == "hello"


def test_extract_json_objects_ignores_malformed():
    from chat.engine import _extract_json_objects

    text = '{"bad": json} {"good": "yes"}'
    result = _extract_json_objects(text)
    assert len(result) == 1
    assert result[0]["good"] == "yes"


def test_extract_json_objects_empty_string():
    from chat.engine import _extract_json_objects

    assert _extract_json_objects("") == []
    assert _extract_json_objects("no json here") == []


# ── _parse_tool_calls_from_content ────────────────────────────────────────────


class _FakeTool:
    pass


def _tools(*names):
    return {n: _FakeTool() for n in names}


def test_parse_tool_calls_llama3_native_format():
    from chat.engine import _parse_tool_calls_from_content

    content = '{"name": "web_search", "parameters": {"query": "AI news"}}'
    calls = _parse_tool_calls_from_content(content, _tools("web_search"))
    assert len(calls) == 1
    assert calls[0].function.name == "web_search"
    args = json.loads(calls[0].function.arguments)
    assert args["query"] == "AI news"


def test_parse_tool_calls_openai_alike_format():
    from chat.engine import _parse_tool_calls_from_content

    content = '{"name": "render_chart", "arguments": {"type": "bar"}}'
    calls = _parse_tool_calls_from_content(content, _tools("render_chart"))
    assert len(calls) == 1
    args = json.loads(calls[0].function.arguments)
    assert args["type"] == "bar"


def test_parse_tool_calls_strips_llama_special_tokens():
    from chat.engine import _parse_tool_calls_from_content

    # Llama 3.x wraps content in special tokens
    content = (
        "<|start_header_id|>assistant<|end_header_id|>\n\n"
        '{"name": "web_search", "parameters": {"query": "test"}}'
        "<|eot_id|>"
    )
    calls = _parse_tool_calls_from_content(content, _tools("web_search"))
    assert len(calls) == 1
    assert calls[0].function.name == "web_search"


def test_parse_tool_calls_unknown_tool_ignored():
    """Tool names not in available_tools must be silently ignored."""
    from chat.engine import _parse_tool_calls_from_content

    content = '{"name": "unknown_tool", "parameters": {}}'
    calls = _parse_tool_calls_from_content(content, _tools("web_search"))
    assert calls == []


def test_parse_tool_calls_deduplicates_same_tool():
    """Two calls to the same tool in one response → only the first is used."""
    from chat.engine import _parse_tool_calls_from_content

    content = (
        '{"name": "web_search", "parameters": {"query": "first"}} '
        '{"name": "web_search", "parameters": {"query": "second"}}'
    )
    calls = _parse_tool_calls_from_content(content, _tools("web_search"))
    assert len(calls) == 1
    args = json.loads(calls[0].function.arguments)
    assert args["query"] == "first"  # first occurrence wins


def test_parse_tool_calls_multiple_different_tools():
    from chat.engine import _parse_tool_calls_from_content

    content = (
        '{"name": "web_search", "parameters": {"query": "news"}} '
        '{"name": "render_chart", "arguments": {"type": "line"}}'
    )
    calls = _parse_tool_calls_from_content(content, _tools("web_search", "render_chart"))
    assert len(calls) == 2
    names = {c.function.name for c in calls}
    assert names == {"web_search", "render_chart"}


def test_parse_tool_calls_empty_content():
    from chat.engine import _parse_tool_calls_from_content

    assert _parse_tool_calls_from_content("", _tools("web_search")) == []
    assert _parse_tool_calls_from_content(None, _tools("web_search")) == []  # type: ignore[arg-type]


def test_parse_tool_calls_string_params_decoded():
    """Parameters that are JSON strings should be decoded to dicts."""
    from chat.engine import _parse_tool_calls_from_content

    params_str = json.dumps({"query": "decoded"})
    content = json.dumps({"name": "web_search", "parameters": params_str})
    calls = _parse_tool_calls_from_content(content, _tools("web_search"))
    assert len(calls) == 1
    args = json.loads(calls[0].function.arguments)
    assert args["query"] == "decoded"


# ── _chart_spec_to_markdown ───────────────────────────────────────────────────


def test_chart_spec_to_markdown_format():
    from chat.engine import _chart_spec_to_markdown

    spec = {"type": "bar", "title": "Revenue", "data": [{"x": 1}]}
    md = _chart_spec_to_markdown(spec)

    assert md.startswith("\n\n```chart\n")
    assert md.endswith("\n```\n\n")
    inner = md.strip().removeprefix("```chart").removesuffix("```").strip()
    assert json.loads(inner) == spec


def test_chart_spec_to_markdown_unicode_preserved():
    from chat.engine import _chart_spec_to_markdown

    spec = {"title": "Données — Résumé", "emoji": "📊"}
    md = _chart_spec_to_markdown(spec)
    inner = md.strip().removeprefix("```chart").removesuffix("```").strip()
    parsed = json.loads(inner)
    assert parsed["title"] == "Données — Résumé"
    assert parsed["emoji"] == "📊"


def test_chart_spec_to_markdown_round_trip():
    """Serialize then re-parse must yield the identical dict."""
    import re

    from chat.engine import _chart_spec_to_markdown

    spec = {
        "type": "line",
        "title": "Q1–Q4",
        "series": [{"key": "revenue", "color": "#abc"}],
        "data": [{"q": "Q1", "revenue": 100}, {"q": "Q2", "revenue": 150}],
    }
    md = _chart_spec_to_markdown(spec)
    # Extract the JSON block as the frontend/renderer would
    match = re.search(r"```chart\n(.*?)\n```", md, re.DOTALL)
    assert match, "Could not find ```chart block in markdown"
    recovered = json.loads(match.group(1))
    assert recovered == spec


# ── _inject_attachments ───────────────────────────────────────────────────────



def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _img_b64() -> str:
    # 1×1 transparent PNG in base64
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


def test_inject_attachments_no_attachments_unchanged():
    from chat.engine import _inject_attachments

    messages = [{"role": "user", "content": "hello"}]
    result = _inject_attachments(messages, [])
    assert result == messages


def test_inject_attachments_image_becomes_multimodal():
    from chat.engine import _inject_attachments

    messages = [{"role": "user", "content": "look at this"}]
    att = [{"type": "image/png", "name": "photo.png", "data": _img_b64()}]
    result = _inject_attachments(messages, att)

    content = result[-1]["content"]
    assert isinstance(content, list), "Content should become a list for images"
    types = [b["type"] for b in content]
    assert "text" in types
    assert "image_url" in types


def test_inject_attachments_image_url_format():
    from chat.engine import _inject_attachments

    messages = [{"role": "user", "content": "see attached"}]
    data = _img_b64()
    att = [{"type": "image/jpeg", "name": "pic.jpg", "data": data}]
    result = _inject_attachments(messages, att)

    image_blocks = [b for b in result[-1]["content"] if b["type"] == "image_url"]
    assert len(image_blocks) == 1
    url = image_blocks[0]["image_url"]["url"]
    assert url == f"data:image/jpeg;base64,{data}"


def test_inject_attachments_text_file_prepended():
    from chat.engine import _inject_attachments

    messages = [{"role": "user", "content": "review this"}]
    code = "def hello():\n    print('hi')"
    att = [{"type": "text/plain", "name": "script.py", "data": _b64(code)}]
    result = _inject_attachments(messages, att)

    content = result[-1]["content"]
    assert isinstance(content, str)
    assert "script.py" in content
    assert "hello" in content


def test_inject_attachments_text_file_capped_at_4000_chars():
    from chat.engine import _inject_attachments

    messages = [{"role": "user", "content": "big file"}]
    big_text = "x" * 10_000
    att = [{"type": "text/plain", "name": "big.txt", "data": _b64(big_text)}]
    result = _inject_attachments(messages, att)

    content = result[-1]["content"]
    assert "(truncated)" in content
    # Ensure the content doesn't blow up to the full 10k
    assert len(content) < 6000


def test_inject_attachments_only_patches_last_user_message():
    from chat.engine import _inject_attachments

    messages = [
        {"role": "user", "content": "first message"},
        {"role": "assistant", "content": "reply"},
        {"role": "user", "content": "second message"},
    ]
    att = [{"type": "image/png", "name": "x.png", "data": _img_b64()}]
    result = _inject_attachments(messages, att)

    assert result[0]["content"] == "first message"  # unchanged
    assert result[1]["content"] == "reply"           # unchanged
    assert isinstance(result[2]["content"], list)    # patched


def test_inject_attachments_already_multimodal_left_as_is():
    """If the last user message is already multimodal, leave it unchanged (documented behavior)."""
    from chat.engine import _inject_attachments

    existing_content = [{"type": "text", "text": "already multimodal"}]
    messages = [{"role": "user", "content": existing_content}]
    att = [{"type": "image/png", "name": "extra.png", "data": _img_b64()}]
    result = _inject_attachments(messages, att)

    # Current behavior: silently leave as-is (see comment in source)
    assert result[-1]["content"] == existing_content


# ── _inject_first_message_context ────────────────────────────────────────────


def test_inject_first_message_context_plain_text():
    from chat.engine import _inject_first_message_context

    messages = [{"role": "user", "content": "hello"}]
    result = _inject_first_message_context(messages, "Be concise.", None)

    content = result[-1]["content"]
    assert "Be concise." in content
    assert "hello" in content
    assert content.index("Be concise.") < content.index("hello")


def test_inject_first_message_context_both_prompts():
    from chat.engine import _inject_first_message_context

    messages = [{"role": "user", "content": "my question"}]
    result = _inject_first_message_context(
        messages, "Always be polite.", "This is about cooking."
    )
    content = result[-1]["content"]
    assert "Always be polite." in content
    assert "This is about cooking." in content
    assert "my question" in content


def test_inject_first_message_context_none_prompts_unchanged():
    from chat.engine import _inject_first_message_context

    messages = [{"role": "user", "content": "hello"}]
    result = _inject_first_message_context(messages, None, None)
    assert result == messages


def test_inject_first_message_context_empty_prompts_unchanged():
    from chat.engine import _inject_first_message_context

    messages = [{"role": "user", "content": "hello"}]
    result = _inject_first_message_context(messages, "  ", "")
    assert result == messages


def test_inject_first_message_context_multimodal_text_block_patched():
    from chat.engine import _inject_first_message_context

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe this image"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        }
    ]
    result = _inject_first_message_context(messages, "Be concise.", None)

    text_blocks = [b for b in result[-1]["content"] if b["type"] == "text"]
    assert len(text_blocks) == 1
    assert "Be concise." in text_blocks[0]["text"]
    assert "describe this image" in text_blocks[0]["text"]


def test_inject_first_message_context_image_only_multimodal_not_corrupted():
    """
    When the last user message has only image blocks (no text block),
    the function should not crash and should not silently drop the prompt.
    Current behavior: no text block found → header is not injected.
    This test documents that behavior so any future change is caught.
    """
    from chat.engine import _inject_first_message_context

    image_only = [{"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}}]
    messages = [{"role": "user", "content": image_only}]
    result = _inject_first_message_context(messages, "Some instruction.", None)

    # Document current behavior: no exception, content unchanged
    assert result[-1]["content"] == image_only


def test_inject_first_message_context_only_patches_last_user():
    from chat.engine import _inject_first_message_context

    messages = [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "reply"},
        {"role": "user", "content": "second"},
    ]
    result = _inject_first_message_context(messages, "rule", None)

    assert result[0]["content"] == "first"   # first user message unchanged
    assert "rule" in result[2]["content"]    # only last user message patched


# ── _inject_tool_results ──────────────────────────────────────────────────────


def test_inject_tool_results_appends_to_last_user_message():
    from chat.engine import _inject_tool_results

    messages = [{"role": "user", "content": "what is the weather?"}]
    result = _inject_tool_results(messages, [("web_search", "It is 72°F and sunny.")])

    content = result[-1]["content"]
    assert "what is the weather?" in content
    assert "web_search" in content
    assert "72°F" in content


def test_inject_tool_results_multiple_tools():
    from chat.engine import _inject_tool_results

    messages = [{"role": "user", "content": "query"}]
    results = [("web_search", "result1"), ("rag_query", "result2")]
    content = _inject_tool_results(messages, results)[-1]["content"]

    assert "web_search" in content
    assert "result1" in content
    assert "rag_query" in content
    assert "result2" in content


def test_inject_tool_results_empty_results_unchanged():
    from chat.engine import _inject_tool_results

    messages = [{"role": "user", "content": "hello"}]
    result = _inject_tool_results(messages, [])
    assert result == messages


def test_inject_tool_results_only_patches_last_user():
    from chat.engine import _inject_tool_results

    messages = [
        {"role": "user", "content": "old question"},
        {"role": "assistant", "content": "old answer"},
        {"role": "user", "content": "new question"},
    ]
    result = _inject_tool_results(messages, [("tool", "data")])

    assert result[0]["content"] == "old question"
    assert "data" in result[2]["content"]
    assert "data" not in result[0]["content"]
