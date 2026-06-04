"""
Unit tests for the SKILL.md parser (skills/parser.py).

All tests are synchronous and operate purely on in-memory bytes —
no filesystem, DB, or network I/O required.
"""

from __future__ import annotations

import io
import os
import sys
import textwrap
import zipfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from skills.parser import (  # noqa: E402
    ParsedSkill,
    ParsedSkillTool,
    parse_skill_folder,
    parse_skill_zip,
)

# ── helpers ───────────────────────────────────────────────────────────────────


def make_zip(files: dict[str, bytes]) -> bytes:
    """Return the bytes of a zip archive containing the given {path: content} mapping."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path, data in files.items():
            zf.writestr(path, data)
    return buf.getvalue()


MINIMAL_SKILL_MD = textwrap.dedent("""\
    ---
    name: test-skill
    description: A test skill
    version: "1.0"
    tools:
      - name: say_hello
        description: Greet the user
        language: python
        script: hello.py
        parameters:
          - name: name
            type: string
            description: Who to greet
            required: true
    ---
""").encode()

HELLO_PY = b'print(f"Hello, {name}!")\n'


# ── parse_skill_zip ───────────────────────────────────────────────────────────


def test_parse_skill_zip_minimal():
    zb = make_zip({"SKILL.md": MINIMAL_SKILL_MD, "hello.py": HELLO_PY})
    skill = parse_skill_zip(zb)

    assert isinstance(skill, ParsedSkill)
    assert skill.name == "test-skill"
    assert skill.description == "A test skill"
    assert skill.version == "1.0"
    assert len(skill.tools) == 1

    tool = skill.tools[0]
    assert isinstance(tool, ParsedSkillTool)
    assert tool.tool_name == "say_hello"
    assert tool.language == "python"
    assert 'print' in tool.script_content


def test_parse_skill_zip_tool_parameters_schema():
    zb = make_zip({"SKILL.md": MINIMAL_SKILL_MD, "hello.py": HELLO_PY})
    skill = parse_skill_zip(zb)
    schema = skill.tools[0].parameters_schema

    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert schema["properties"]["name"]["type"] == "string"
    assert "name" in schema["required"]


def test_parse_skill_zip_nested_in_subdir():
    """SKILL.md and scripts stored inside a subdirectory (common when zipping a folder)."""
    zb = make_zip(
        {
            "myskill/SKILL.md": MINIMAL_SKILL_MD,
            "myskill/hello.py": HELLO_PY,
        }
    )
    skill = parse_skill_zip(zb)
    assert skill.name == "test-skill"
    assert skill.tools[0].script_content == HELLO_PY.decode()


def test_parse_skill_zip_missing_skill_md_raises():
    zb = make_zip({"hello.py": HELLO_PY})
    with pytest.raises(ValueError, match="No SKILL.md"):
        parse_skill_zip(zb)


def test_parse_skill_zip_missing_script_raises():
    zb = make_zip({"SKILL.md": MINIMAL_SKILL_MD})  # hello.py absent
    with pytest.raises(ValueError, match="not found in zip"):
        parse_skill_zip(zb)


# ── parse_skill_folder ────────────────────────────────────────────────────────


def test_parse_skill_folder_minimal():
    files = {"SKILL.md": MINIMAL_SKILL_MD, "hello.py": HELLO_PY}
    skill = parse_skill_folder(files)

    assert skill.name == "test-skill"
    assert len(skill.tools) == 1
    assert skill.tools[0].tool_name == "say_hello"


def test_parse_skill_folder_nested_paths():
    files = {
        "myskill/SKILL.md": MINIMAL_SKILL_MD,
        "myskill/hello.py": HELLO_PY,
    }
    skill = parse_skill_folder(files)
    assert skill.tools[0].script_content == HELLO_PY.decode()


def test_parse_skill_folder_missing_skill_md_raises():
    with pytest.raises(ValueError, match="No SKILL.md"):
        parse_skill_folder({"only.py": b"pass"})


def test_parse_skill_folder_missing_script_raises():
    with pytest.raises(ValueError, match="not found in upload"):
        parse_skill_folder({"SKILL.md": MINIMAL_SKILL_MD})


# ── manifest validation ───────────────────────────────────────────────────────


def _make_manifest(**overrides) -> bytes:
    base = {
        "name": "s",
        "description": "d",
        "version": "1",
        "tools": [
            {
                "name": "t",
                "language": "python",
                "script": "t.py",
            }
        ],
    }
    base.update(overrides)
    import yaml

    return ("---\n" + yaml.dump(base) + "---\n").encode()


def test_missing_name_raises():
    md = _make_manifest(name="")
    with pytest.raises(ValueError, match="'name' is required"):
        parse_skill_folder({"SKILL.md": md, "t.py": b"pass"})


def test_missing_description_raises():
    md = _make_manifest(description="")
    with pytest.raises(ValueError, match="'description' is required"):
        parse_skill_folder({"SKILL.md": md, "t.py": b"pass"})


def test_missing_tool_name_raises():
    md = _make_manifest(
        tools=[{"name": "", "language": "python", "script": "t.py"}]
    )
    with pytest.raises(ValueError, match="name is required"):
        parse_skill_folder({"SKILL.md": md, "t.py": b"pass"})


def test_missing_tool_language_raises():
    md = _make_manifest(
        tools=[{"name": "t", "language": "", "script": "t.py"}]
    )
    with pytest.raises(ValueError, match="language is required"):
        parse_skill_folder({"SKILL.md": md, "t.py": b"pass"})


def test_missing_tool_script_raises():
    md = _make_manifest(
        tools=[{"name": "t", "language": "python", "script": ""}]
    )
    with pytest.raises(ValueError, match="script is required"):
        parse_skill_folder({"SKILL.md": md, "t.py": b"pass"})


def test_no_frontmatter_raises():
    with pytest.raises(ValueError, match="frontmatter"):
        parse_skill_folder({"SKILL.md": b"just plain text\nno yaml"})


# ── optional fields ───────────────────────────────────────────────────────────


def test_optional_parameter_not_required():

    manifest = textwrap.dedent("""\
        ---
        name: opt-skill
        description: Optional param test
        tools:
          - name: greet
            language: python
            script: g.py
            parameters:
              - name: greeting
                type: string
                required: false
        ---
    """).encode()
    skill = parse_skill_folder({"SKILL.md": manifest, "g.py": b"pass"})
    schema = skill.tools[0].parameters_schema
    assert "greeting" not in schema.get("required", [])


def test_multiple_tools_parsed():

    manifest = textwrap.dedent("""\
        ---
        name: multi
        description: Two tools
        tools:
          - name: tool_a
            language: python
            script: a.py
          - name: tool_b
            language: bash
            script: b.sh
        ---
    """).encode()
    skill = parse_skill_folder(
        {"SKILL.md": manifest, "a.py": b"pass", "b.sh": b"echo hi"}
    )
    assert len(skill.tools) == 2
    names = {t.tool_name for t in skill.tools}
    assert names == {"tool_a", "tool_b"}
