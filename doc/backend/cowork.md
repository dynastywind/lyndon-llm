# Cowork Module

**Path**: `backend/cowork/`
**Purpose**: Multi-step goal decomposition, plan approval, and automated execution with shell, file I/O, and Mac GUI control.

---

## Key Files

| File | Role |
|---|---|
| `cowork/planner.py` | `Planner` — LLM-powered goal → structured plan |
| `cowork/executor.py` | `Executor` — step-by-step plan execution with event emission |
| `cowork/tools/shell.py` | `ShellTool` — execute shell commands |
| `cowork/tools/file_io.py` | `FileReadTool`, `FileWriteTool` — read/write files |
| `cowork/tools/mac_control.py` | `MacControlTool` — AppleScript GUI automation |

---

## Data Models

```python
class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

@dataclass
class PlanStep:
    id: str          # UUID
    order: int
    title: str
    description: str
    tool: str | None         # tool name to call
    args: dict | None        # arguments for the tool
    risk: RiskLevel
    depends_on: list[str]    # step IDs that must complete first

@dataclass
class Plan:
    plan_id: str
    goal: str
    steps: list[PlanStep]
    approved: bool = False
    session_id: str | None = None
```

---

## Planner

`Planner.create_plan(goal, session_id)` asks the LLM to decompose the goal into a structured plan:

```
POST /api/cowork/plan  { goal }
        │
        ▼
Planner.create_plan(goal, session_id)
    │
    ├── Build prompt with available tools (shell, file_read, file_write, mac_control)
    ├── LLMGateway.complete(messages) → JSON plan
    ├── Parse → Plan + PlanStep[] Pydantic models
    ├── _normalize_depends_on() — converts order-number references to step UUIDs
    ├── Save CoworkPlan to DB
    └── Return Plan
```

The system prompt lists the available tools with their schemas so the LLM knows what each step can do. Normalisation handles the common LLM pattern of referencing steps by order number (`"depends_on": [1, 2]`) instead of UUIDs.

### Difference from ChatPlanner

| Aspect | ChatPlanner | Cowork Planner |
|---|---|---|
| Tool set | Chat READ tools only | shell, file_io, mac_control |
| Execution | Agentic tool loop | Explicit Executor.run() |
| User approval | Not required | Phase 2 — user must confirm |
| Persistence | Not saved to DB | Saved as `CoworkPlan` row |

---

## Executor

`Executor.run(plan)` executes each step sequentially, respecting dependencies:

```
POST /api/cowork/approve  { plan_id }
        │
        ▼
Executor.run(plan) → async generator of events
    │
    for step in plan.steps (ordered by depends_on):
        ├── Validate: all depends_on steps must be DONE
        ├── emit EventBus: STEP_STARTED
        ├── Resolve tool from ToolRegistry
        ├── tool.run(**step.args)
        ├── On success: emit STEP_DONE, store output
        └── On failure: emit STEP_FAILED, mark step as FAILED
            (subsequent steps that depend on this are SKIPPED)
    emit EventBus: TASK_DONE
```

Max steps: `cowork_max_plan_steps` (default 20). Steps beyond this limit are skipped.

---

## Cowork Tools

All cowork tools require `Permission.WRITE` or `Permission.EXEC`, which triggers the approval gate in Cowork mode.

### ShellTool

```python
permission = Permission.EXEC

async def run(self, command: str) -> ToolResult:
    # Runs: bash -c command
    # Timeout: cowork_shell_timeout (default 30s)
    # Returns stdout + stderr, exit_code
```

### FileReadTool / FileWriteTool

```python
FileReadTool:  permission = Permission.READ
FileWriteTool: permission = Permission.WRITE

FileReadTool.run(path: str) → file contents as string
FileWriteTool.run(path: str, content: str) → writes file, returns confirmation
```

### MacControlTool

```python
permission = Permission.EXEC

async def run(self, script: str) -> ToolResult:
    # Runs: osascript -e "script"
    # Timeout: mac_control_timeout (default 15s)
    # Returns AppleScript output
```

Used for GUI automation: opening apps, clicking buttons, setting system settings via AppleScript.

---

## Frontend Plan Confirmation Flow

```
1. POST /api/cowork/plan  → plan_preview event (or JSON response)
2. Frontend shows PlanPreviewCard with steps and risk levels
3. User clicks "Confirm"
4. POST /api/cowork/approve  → SSE stream of step events
5. Frontend updates step badges: pending → running → done/failed
6. User can cancel any time (DELETE /api/cowork/plan/{id})
```

---

## Permission Gate in Cowork Mode

| Permission | Allowed | Requires Approval |
|---|---|---|
| READ | Yes | No |
| WRITE | Yes | **Yes** |
| EXEC | Yes | **Yes** |

The approval is implicit — the user clicking "Confirm" on the plan is the approval gate. Individual tools do not prompt again; the entire plan is approved as a unit.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `cowork_shell_timeout` | `30` s | Max time for a shell command |
| `mac_control_timeout` | `15` s | Max time for an AppleScript call |
| `cowork_max_plan_steps` | `20` | Max steps per plan |

---

## Integration Points

| Dependency | Used for |
|---|---|
| `LLMGateway` | Plan generation |
| `ToolRegistry` (COWORK mode) | Tool lookup during execution |
| `PermissionGate(Mode.COWORK)` | WRITE/EXEC enforcement |
| `EventBus` | `STEP_STARTED`, `STEP_DONE`, `STEP_FAILED`, `TASK_DONE` events |
| `CoworkPlan` DB model | Plan persistence across restarts |
