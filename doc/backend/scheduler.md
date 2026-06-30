# Scheduler Module

**Path**: `backend/core/scheduler/`
**Purpose**: Run user-defined tasks on a recurring schedule. Each task executes a **cowork goal** unattended (plan → execute, no human approval) and lands the result as a cowork session in the user's history.

---

## Key Files

| File | Role |
|---|---|
| `core/scheduler/schedule.py` | Pure helpers: `compute_next_run` (interval/daily/weekly) + `validate_schedule` |
| `core/scheduler/runner.py` | `SchedulerRunner` — the asyncio poll loop + `run_task` (unattended cowork run) |
| `db/models/scheduled_task.py` | `ScheduledTask` ORM model (table `scheduled_tasks`) |
| `db/repos/scheduled_task.py` | `ScheduledTaskRepo` — CRUD + `list_due` + run bookkeeping |
| `api/routes/scheduled_tasks.py` | User-scoped REST endpoints (`/api/scheduled-tasks`) |

This is local-first: schedules only fire while the backend process is running.

---

## How It Fires

```
FastAPI lifespan (api/main.py)
  └── scheduler_runner.start()          (gated by settings.scheduler_enabled)
        ├── _recompute_stale_next_runs() — give enabled tasks a future next_run_at
        │                                  (does NOT retro-fire runs missed while down)
        └── asyncio.create_task(_loop())

_loop()  every settings.scheduler_poll_seconds (45s)
  └── _tick(): repo.list_due(now) → for each due task: run_task(id, user_id)
       (try/except around each tick — one bad task never kills the loop)
```

`scheduler_runner.stop()` cancels the loop on shutdown.

---

## Unattended Cowork Execution (`run_task`)

A scheduled run mirrors the two-step cowork flow (`api/routes/cowork.py`) but skips the human review round-trip:

```
run_task(task_id, user_id, advance_schedule=True)
  1. mark_running
  2. ChatRepo.create_session(session_id, mode="cowork", user_id) + rename to task.name
  3. add_message(session_id, "user", goal)
  4. build_project_block(...) → Planner().create_plan(goal, session_id, project_context)
  5. if acting_mode == "auto_safe": drop RiskLevel.HIGH steps
  6. plan.approved = True → Executor(Session(session_id, Mode.COWORK)).run(plan)
  7. add_message(session_id, "assistant", formatted results) + touch_session
  8. mark_run(status, error, session_id, ran_at, next_run_at=compute_next_run(after=now))
```

### Why no approval bypass is needed

`Executor.run` already executes every step. Risk-gated steps call
`session.gate.check(Permission.WRITE, ...)`, and `MODE_PERMISSIONS[Mode.COWORK]`
includes `WRITE`/`EXEC`, so the check passes and never prompts. "Approval" is
purely the frontend's two-step (`POST /plan` to review, `POST /execute` with
`approved=True`). The scheduler simply does plan → `approved=True` → run.

The Executor only emits events to the WebSocket; nothing persists step output.
A scheduled run has no WS listener, so `run_task` writes the goal + a formatted
results summary to `chat_messages` itself.

### Resilience

Steps 2–7 are wrapped in try/except: on failure the task records
`last_status="error"` + `last_error`, **still advances `next_run_at`** (so a
broken task doesn't hammer every tick), and the loop keeps serving other tasks.

### Acting modes

| `acting_mode` | Behaviour |
|---|---|
| `auto` | Run every planned step. |
| `auto_safe` (UI default) | Drop `RiskLevel.HIGH` steps before executing — safer for unattended runs. |

> Caveat: a tool that implements its own interactive approval (e.g. `desktop_control` / `os_control`) could block an unattended run waiting for a frontend response. `auto_safe` mitigates this by dropping high-risk steps.

---

## Schedule Kinds (`schedule.py`)

`compute_next_run(kind, *, interval_seconds, time_of_day, weekday, after)` returns the next firing time strictly after `after`. **All times are UTC** (v1 — no DST).

| `schedule_kind` | Fields | Next run |
|---|---|---|
| `interval` | `interval_seconds` (≥ 60) | `after + interval_seconds` |
| `daily` | `time_of_day` `"HH:MM"` | today at HH:MM, else +1 day |
| `weekly` | `time_of_day`, `weekday` (0=Mon..6=Sun) | next matching weekday at HH:MM (+7d if same day already past) |

`validate_schedule(...)` raises `ValueError` for bad fields (routes return 400).

---

## ScheduledTask Model

```python
class ScheduledTask(Base):           # table: scheduled_tasks
    id: str (PK)
    user_id: str           # FK users.id, ondelete CASCADE, indexed
    name: str
    goal: str              # the cowork goal run each time
    schedule_kind: str     # interval | daily | weekly
    interval_seconds: int | None
    time_of_day: str | None    # "HH:MM" (UTC)
    weekday: int | None        # 0=Mon..6=Sun
    acting_mode: str       # auto | auto_safe (default "auto")
    enabled: bool
    last_run_at / next_run_at: datetime | None   # next_run_at indexed
    last_status: str | None    # ok | error | running
    last_error: str | None
    last_session_id: str | None  # links to the cowork run
    created_at / updated_at: datetime
```

The table is created by `Base.metadata.create_all`; idempotent indexes are added in `_migrate()` (v14). Note: SQLite returns tz-naive datetimes on read; `list_due`'s comparison is done in SQL so it stays correct.

---

## API — `/api/scheduled-tasks` (all `Depends(get_current_user)`, user-scoped)

| Method & Path | Purpose |
|---|---|
| `GET ""` | List the user's tasks |
| `POST ""` | Create (validates schedule → 400 on bad fields; computes `next_run_at`) |
| `PATCH "/{id}"` | Update any field; recomputes `next_run_at` when schedule/enabled change |
| `DELETE "/{id}"` | Delete |
| `POST "/{id}/run-now"` | Fire immediately via `run_task(..., advance_schedule=False)` — does not shift the schedule |

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `scheduler_enabled` | `True` | Start the background loop in the lifespan (tests disable it) |
| `scheduler_poll_seconds` | `45` | How often the loop checks for due tasks |

---

## Frontend

Managed from **Settings → Schedules** (`frontend/src/components/layout/ScheduledTasksPanel.tsx`, reached via the Settings tab or the Sidebar user dropdown). The panel lists tasks (schedule summary, next run, status, enable toggle, Run now, delete) and a create form (name, goal, interval/daily/weekly preset picker, acting-mode radio, UTC-labeled times). Data flows through `useScheduledTasks` + the client CRUD in `src/api/client.ts`; strings are localized under `settings.schedules.*`.

---

## Integration Points

| Dependency | Used for |
|---|---|
| `Planner` / `Executor` (`cowork/`) | Plan + run the goal unattended |
| `Session` + `PermissionGate` (COWORK) | Permission context that allows WRITE/EXEC without prompting |
| `ChatRepo` | Create the cowork session + persist goal/results messages |
| `build_project_block` (`chat/project_context.py`) | Project context for the plan |
| FastAPI `lifespan` (`api/main.py`) | Start/stop the loop |
