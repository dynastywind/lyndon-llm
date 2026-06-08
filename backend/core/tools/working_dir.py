"""Working-directory resolution for Cowork/Code tool execution.

The user can pin a "work directory" per chat thread (the DirectoryChip in the
desktop UI).  It is sent with each chat request and stored on the in-memory
session.  These helpers normalise the chosen path and inject it as the default
``cwd`` / base path for the shell and file tools when the model does not name
one explicitly, so commands and file edits run where the user expects rather
than wherever the backend process happens to be.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Tools whose missing argument should default to the work directory.
_CWD_TOOLS = {"shell": "cwd"}
# Tools whose path argument should be resolved against the work directory.
_PATH_TOOLS = {"file_read": "path", "file_write": "path"}


def normalize_working_directory(raw: str | None) -> str | None:
    """Expand ``~``, resolve, and validate a user-chosen work directory.

    Returns the absolute path when it exists and is a directory; otherwise
    ``None`` — an invalid or missing selection is silently ignored rather than
    failing the request, so tools simply fall back to their default behaviour.
    """
    if not raw or not raw.strip():
        return None
    try:
        path = Path(raw.strip()).expanduser()
        if path.is_dir():
            return str(path.resolve())
    except OSError as exc:  # pragma: no cover - defensive
        logger.warning("invalid working directory %r: %s", raw, exc)
        return None
    logger.warning("working directory %r does not exist or is not a directory", raw)
    return None


def is_directory_empty(raw: str | None) -> bool:
    """True when *raw* points at an existing directory with no entries.

    Used to gate ``git clone`` — we refuse to clone into a non-empty directory and
    ask the user to pick an empty one. A non-existent path is *not* empty (the clone
    endpoint requires the directory to exist, since it is chosen via the folder picker).
    """
    if not raw or not raw.strip():
        return False
    try:
        path = Path(raw.strip()).expanduser()
        return path.is_dir() and not any(path.iterdir())
    except OSError:
        return False


def apply_working_directory(fn_name: str, fn_args: dict, working_dir: str | None) -> dict:
    """Return ``fn_args`` with the work directory applied for known tools.

    * ``shell`` — set ``cwd`` when the model did not provide one.
    * ``file_read`` / ``file_write`` — expand ``~`` and resolve a relative
      ``path`` against the work directory (already-absolute paths are kept).

    The input dict is never mutated; a shallow copy is returned only when a
    value actually changes, so unaffected tool calls keep their args verbatim.
    """
    if not working_dir:
        return fn_args

    if fn_name in _CWD_TOOLS:
        arg = _CWD_TOOLS[fn_name]
        if not fn_args.get(arg):
            return {**fn_args, arg: working_dir}
        return fn_args

    if fn_name in _PATH_TOOLS:
        arg = _PATH_TOOLS[fn_name]
        raw_path = fn_args.get(arg)
        if isinstance(raw_path, str) and raw_path:
            expanded = Path(raw_path).expanduser()
            resolved = expanded if expanded.is_absolute() else Path(working_dir) / expanded
            if str(resolved) != raw_path:
                return {**fn_args, arg: str(resolved)}

    return fn_args
