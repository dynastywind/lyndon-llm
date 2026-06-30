"""
Pure helpers for the simple-preset schedule kinds.

All times are UTC for v1 (no timezone / DST handling). `compute_next_run`
returns the next firing time strictly after `after`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import re

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_MIN_INTERVAL = 60  # seconds — guard against runaway loops


def validate_schedule(
    kind: str,
    *,
    interval_seconds: int | None,
    time_of_day: str | None,
    weekday: int | None,
) -> None:
    """Raise ValueError if the schedule fields are invalid for the kind."""
    if kind == "interval":
        if interval_seconds is None or interval_seconds < _MIN_INTERVAL:
            raise ValueError(f"interval_seconds must be >= {_MIN_INTERVAL}")
    elif kind == "daily":
        if not time_of_day or not _HHMM.match(time_of_day):
            raise ValueError("time_of_day must be 'HH:MM' (24-hour)")
    elif kind == "weekly":
        if not time_of_day or not _HHMM.match(time_of_day):
            raise ValueError("time_of_day must be 'HH:MM' (24-hour)")
        if weekday is None or not (0 <= weekday <= 6):
            raise ValueError("weekday must be 0 (Mon) .. 6 (Sun)")
    else:
        raise ValueError(f"Unknown schedule kind: {kind!r}")


def _at_time(day: datetime, time_of_day: str) -> datetime:
    hh, mm = (int(p) for p in time_of_day.split(":"))
    return day.replace(hour=hh, minute=mm, second=0, microsecond=0)


def compute_next_run(
    kind: str,
    *,
    interval_seconds: int | None = None,
    time_of_day: str | None = None,
    weekday: int | None = None,
    after: datetime | None = None,
) -> datetime:
    """Return the next firing time strictly after `after` (default: now, UTC)."""
    now = after or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    if kind == "interval":
        seconds = interval_seconds or _MIN_INTERVAL
        return now + timedelta(seconds=seconds)

    if kind == "daily":
        candidate = _at_time(now, time_of_day or "00:00")
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    if kind == "weekly":
        candidate = _at_time(now, time_of_day or "00:00")
        target = weekday if weekday is not None else 0
        delta = (target - candidate.weekday()) % 7
        if delta == 0 and candidate <= now:
            delta = 7
        return candidate + timedelta(days=delta)

    raise ValueError(f"Unknown schedule kind: {kind!r}")
