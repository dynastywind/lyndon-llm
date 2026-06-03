"""Parse a SKILL.md manifest from a zip archive or a flat file dict."""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field

import yaml


@dataclass
class ParsedSkillTool:
    tool_name: str
    description: str
    language: str
    script_content: str
    parameters_schema: dict  # OpenAI function-calling parameters object


@dataclass
class ParsedSkill:
    name: str
    description: str
    version: str
    tools: list[ParsedSkillTool] = field(default_factory=list)


def parse_skill_zip(zip_bytes: bytes) -> ParsedSkill:
    """Extract a zip in memory and parse the SKILL.md manifest inside."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        skill_md_path = _find_skill_md(names)
        if skill_md_path is None:
            raise ValueError("No SKILL.md found in the zip archive")

        skill_md_text = zf.read(skill_md_path).decode("utf-8")
        base_dir = skill_md_path.rsplit("/", 1)[0] + "/" if "/" in skill_md_path else ""

        def read_file(rel_path: str) -> bytes:
            full = base_dir + rel_path
            if full not in names and rel_path not in names:
                raise ValueError(f"Script file not found in zip: {rel_path}")
            return zf.read(full if full in names else rel_path)

        return _parse_manifest(skill_md_text, read_file)


def parse_skill_folder(files: dict[str, bytes]) -> ParsedSkill:
    """Parse from a {relative_path → bytes} dict (browser folder upload)."""
    skill_md_path = _find_skill_md(list(files.keys()))
    if skill_md_path is None:
        raise ValueError("No SKILL.md found in the uploaded files")

    skill_md_text = files[skill_md_path].decode("utf-8")
    base_dir = skill_md_path.rsplit("/", 1)[0] + "/" if "/" in skill_md_path else ""

    def read_file(rel_path: str) -> bytes:
        full = base_dir + rel_path
        if full in files:
            return files[full]
        if rel_path in files:
            return files[rel_path]
        raise ValueError(f"Script file not found in upload: {rel_path}")

    return _parse_manifest(skill_md_text, read_file)


# ── helpers ───────────────────────────────────────────────────────────────────


def _find_skill_md(names: list[str]) -> str | None:
    # Prefer root-level SKILL.md; fall back to any SKILL.md in subdirs
    for name in names:
        if name == "SKILL.md":
            return name
    for name in names:
        if name.endswith("/SKILL.md"):
            return name
    return None


def _parse_manifest(text: str, read_file) -> ParsedSkill:
    """Parse YAML frontmatter from SKILL.md and load referenced scripts."""
    front, _ = _split_frontmatter(text)
    if front is None:
        raise ValueError("SKILL.md must start with a YAML frontmatter block (--- ... ---)")

    meta = yaml.safe_load(front)
    if not isinstance(meta, dict):
        raise ValueError("SKILL.md frontmatter must be a YAML mapping")

    name = meta.get("name", "").strip()
    description = meta.get("description", "").strip()
    version = str(meta.get("version", "1.0")).strip()

    if not name:
        raise ValueError("SKILL.md: 'name' is required")
    if not description:
        raise ValueError("SKILL.md: 'description' is required")

    tools_raw = meta.get("tools", [])
    if not isinstance(tools_raw, list):
        raise ValueError("SKILL.md: 'tools' must be a list")

    tools: list[ParsedSkillTool] = []
    for i, t in enumerate(tools_raw):
        if not isinstance(t, dict):
            raise ValueError(f"SKILL.md: tools[{i}] must be a mapping")
        tool_name = t.get("name", "").strip()
        tool_desc = t.get("description", "").strip()
        language = t.get("language", "").strip().lower()
        script_path = t.get("script", "").strip()
        params_raw = t.get("parameters", [])

        if not tool_name:
            raise ValueError(f"SKILL.md: tools[{i}].name is required")
        if not language:
            raise ValueError(f"SKILL.md: tools[{i}].language is required")
        if not script_path:
            raise ValueError(f"SKILL.md: tools[{i}].script is required")

        script_bytes = read_file(script_path)
        script_content = script_bytes.decode("utf-8")

        parameters_schema = _build_parameters_schema(params_raw)
        tools.append(
            ParsedSkillTool(
                tool_name=tool_name,
                description=tool_desc,
                language=language,
                script_content=script_content,
                parameters_schema=parameters_schema,
            )
        )

    return ParsedSkill(name=name, description=description, version=version, tools=tools)


def _split_frontmatter(text: str) -> tuple[str | None, str]:
    """Return (yaml_block, body) or (None, full_text) if no frontmatter."""
    text = text.lstrip()
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    yaml_block = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    return yaml_block, body


def _build_parameters_schema(params_raw: list) -> dict:
    """Convert SKILL.md parameter list to an OpenAI function-calling parameters object."""
    if not isinstance(params_raw, list):
        return {"type": "object", "properties": {}}

    properties: dict = {}
    required: list[str] = []

    for p in params_raw:
        if not isinstance(p, dict):
            continue
        pname = p.get("name", "").strip()
        if not pname:
            continue
        ptype = p.get("type", "string")
        pdesc = p.get("description", "")
        is_required = p.get("required", True)

        prop: dict = {"type": ptype}
        if pdesc:
            prop["description"] = pdesc
        if "default" in p:
            prop["default"] = p["default"]
        if ptype == "string" and "enum" in p:
            prop["enum"] = p["enum"]

        properties[pname] = prop
        if is_required:
            required.append(pname)

    schema: dict = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema
