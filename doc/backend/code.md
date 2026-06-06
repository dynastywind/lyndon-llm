# Code Module

**Path**: `backend/code/`
**Purpose**: Git-aware code operations — repository management, LLM-assisted file editing, code review, and test execution.

---

## Key Files

| File | Role |
|---|---|
| `code/repo.py` | `RepoManager` — Git operations wrapper |
| `code/editor.py` | `Editor` — LLM-driven file edit operations |
| `code/reviewer.py` | `Reviewer` — LLM code review on diffs |
| `code/test_runner.py` | `TestRunner` — run project test suite |
| `code/context/` | (stub) — future code context enrichment |
| `code/deploy/` | (stub) — future deployment pipeline (Vercel etc.) |

---

## RepoManager

`RepoManager` wraps GitPython to provide async-friendly repository operations. It is scoped to `code_default_repo_path` (configurable per session via the `x-repo-path` header or settings).

### Key Operations

| Method | Description |
|---|---|
| `get_status()` | Returns modified, staged, untracked file lists |
| `get_log(n)` | Last N commits with hash, author, date, message |
| `get_diff(staged, file)` | Diff of staged or unstaged changes |
| `read_file(path)` | Read file contents from working tree |
| `write_file(path, content)` | Write file (creates parent dirs if needed) |
| `delete_file(path)` | Delete a file |
| `commit(message)` | Stage all changes and commit |
| `get_branches()` | List local branches |
| `switch_branch(name)` | Checkout a branch |

All write operations require `Permission.WRITE` and are subject to user approval in Code mode.

---

## Editor

`Editor` translates natural-language edit instructions into concrete file changes using the LLM.

```
POST /api/code/edit  { instruction, file_path? }
        │
        ▼
Editor.edit(instruction, repo_path)
    │
    ├── Read current file content (RepoManager.read_file)
    ├── Build LLM prompt: current content + instruction
    ├── LLMGateway.complete() → new file content or FileDiff
    ├── Write updated file (RepoManager.write_file)
    └── Return FileDiff { path, old_content, new_content }
```

The LLM is prompted to return the complete updated file. Line-level diffs are computed locally from the before/after content.

---

## Reviewer

`Reviewer` performs LLM-assisted code review on the current repository diff.

```
POST /api/code/review  { diff?, focus? }
        │
        ▼
Reviewer.review(repo_path, diff)
    │
    ├── Get diff from RepoManager (staged or full working tree)
    ├── Truncate to context limit if needed
    ├── LLMGateway.complete(messages, system=REVIEW_SYSTEM_PROMPT)
    └── Return list[ReviewComment] { file, line?, severity, message, suggestion? }
```

`ReviewComment` severity levels: `info`, `warning`, `error`.

---

## TestRunner

`TestRunner.run(repo_path, test_path?)` executes the project's test suite via subprocess.

```
POST /api/code/test  { test_path? }
        │
        ▼
TestRunner.run(repo_path)
    │
    ├── Detect test framework (pytest, jest, etc.) from project files
    ├── subprocess.run(["pytest", "-x", ...], cwd=repo_path, timeout=120)
    ├── Capture stdout + stderr
    ├── Parse exit code → TESTS_PASSED / TESTS_FAILED
    └── Return { passed, failed, output }
```

---

## Permission Gate in Code Mode

| Permission | Allowed | Requires Approval |
|---|---|---|
| READ | Yes | No |
| WRITE | Yes | **Yes** (file edits, commit) |
| EXEC | Yes | **Yes** (test runs, shell commands) |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/code/status` | Git status |
| `GET` | `/api/code/log` | Commit log |
| `GET` | `/api/code/diff` | Working tree diff |
| `POST` | `/api/code/edit` | Edit file via LLM instruction |
| `POST` | `/api/code/review` | Review current diff |
| `POST` | `/api/code/test` | Run test suite |

---

## Stub Modules

### `code/context/`
Intended to provide richer context for the LLM — e.g., extracting symbol definitions, call graphs, or import trees to give the model a better understanding of the codebase before editing. Not yet implemented.

### `code/deploy/`
Intended to wrap deployment workflows (Vercel, Railway, etc.). The `VERCEL_TOKEN` setting and the `vercel_token` config field are already present in preparation. Not yet implemented.

---

## Integration Points

| Dependency | Used for |
|---|---|
| `LLMGateway` | Edit instructions and code review |
| `ToolRegistry` (CODE mode) | `ShellTool`, `FileReadTool`, `FileWriteTool` |
| `PermissionGate(Mode.CODE)` | WRITE/EXEC enforcement |
| `EventBus` | `DIFF_READY`, `COMMIT_DONE`, `DEPLOY_DONE` events |
