# Skills Module

**Path**: `backend/skills/`
**Purpose**: User-uploadable custom tool sets — SKILL.md format, parser, runtime manager, and argument injection.

---

## Key Files

| File | Role |
|---|---|
| `skills/parser.py` | `parse_skill_zip`, `parse_skill_folder` — parse SKILL.md into models |
| `skills/manager.py` | `SkillManager` — load from DB, register tools, manage catalog |
| `api/routes/skills.py` | Upload, list, toggle, delete skills |
| `db/models/skill.py` | `Skill`, `SkillTool` ORM models |
| `db/repos/skill.py` | `SkillRepo` — CRUD operations |

---

## SKILL.md Format

A skill is a ZIP file or folder containing a `SKILL.md` file. The file has a YAML frontmatter block followed by an optional Markdown body:

```markdown
---
name: My Skill
description: What this skill does
version: 1.0.0
tools:
  - name: my_tool
    description: Describe what my_tool does
    language: python        # python | javascript | typescript | bash | shell
    parameters:
      - name: input_text
        type: string
        description: The text to process
        required: true
    script: |
      # Python code that does the work
      result = process(_sa_args_["input_text"])
      print(result)
---

## Overview

Optional markdown body — shown in the Skills panel. For prompt-based skills
(no `tools` with scripts), this body is injected as a system prompt block
when the skill is activated.
```

---

## Two Skill Flavours

### Script-based Skills
Tools have a `script` field. When called, the script runs via the sandbox runner with arguments injected. Appears as a callable tool in the LLM's function-calling schema.

### Prompt-based Skills
No `script` field (or `script` is empty). When activated via slash-command, the SKILL.md body is injected as an additional system prompt block and a `skill_activated` SSE event is emitted. The LLM uses the prompt context but no code runs.

---

## Argument Injection

Scripts receive their arguments via language-specific mechanisms:

| Language | Injection mechanism |
|---|---|
| Python | `_sa_args_` dict in local scope |
| JavaScript / TypeScript | `const _skillArgs_ = {…}` prepended |
| Bash / Shell | Environment variables: `SKILL_ARG_<NAME>=value` |

Example (Python): if the tool declares `parameters: [{ name: "text" }]` and is called with `{ "text": "hello" }`, the script runs with `_sa_args_ = {"text": "hello"}` in scope.

---

## SkillManager

A module-level singleton (`skill_manager`).

```python
class SkillManager:
    _skill_catalog: dict[str, dict]  # skill_id → metadata dict
    # populated in _register_skill(), cleaned in _unregister_skill()
```

### Startup

```python
await skill_manager.reload_all()
    → SkillRepo.get_all_enabled() → all enabled skills from DB
    → for each skill: _register_skill(skill, tools)
```

### `_register_skill(skill, tools)`

For each `SkillTool` in the skill:
1. Generate a unique tool name: `skill__<skill_id_prefix>__<tool_name>`
2. Create a `BaseTool` subclass dynamically (similar to MCP dynamic tool)
3. The tool's `run()` injects arguments and calls `sandbox.runner.run_code(language, script, timeout=30)`
4. Register into `ToolRegistry` via `register_skill(Mode.CHAT, cls)` and `register_skill(Mode.COWORK, cls)`
5. Add entry to `_skill_catalog`

### `_skill_catalog` Entry Shape

```python
{
    "skill_id": str,
    "user_id": str,
    "name": str,
    "description": str,
    "version": str,
    "enabled": bool,
    "installed_at": str,   # ISO datetime
    "tools": [
        { "tool_name": str, "language": str }
    ]
}
```

### `list_skills_for_user(user_id)`

Returns all catalog entries for a given user without a DB call. Used by `ListSkillsTool`.

### `reload_for_user(user_id, db)`

Called after skill upload, toggle, or delete — clears and re-registers all tools for that user.

---

## Upload Flow

```
POST /api/skills/upload  { file: ZIP }
        │
        ▼
parse_skill_zip(file_bytes)
    → read SKILL.md from ZIP
    → parse frontmatter → ParsedSkill { name, description, tools[] }
    → validate tool schemas
        │
        ▼
SkillRepo.create_skill(user_id, parsed)
    → insert Skill + SkillTool rows
    → store raw SKILL.md text in skill_md column
        │
        ▼
skill_manager.reload_for_user(user_id, db)
    → _clear_user_tools(user_id)
    → re-register all user's skills from DB
```

---

## Slash-Command Routing

When the frontend sends `skill_id` in a chat request:
1. `ChatEngine` fetches the Skill and its SkillTools from DB
2. If the skill has script tools → pins the `RouteDecision.tools` to only those tool names
3. If the skill is prompt-only → emits `skill_activated` SSE event and injects the SKILL.md body into the system prompt

---

## Integration Points

| Dependency | Used for |
|---|---|
| `ToolRegistry.register_skill()` | Registering tool classes per mode |
| `sandbox.runner.run_code()` | Executing skill scripts |
| `SkillRepo` | CRUD and reload from DB |
| `ListSkillsTool` | Reads `_skill_catalog` for user-facing skill listing |
| `ChatEngine` | Skill override via `skill_id` request field |
