"""
Repo Manager — git operations for the Code block.
Wraps gitpython with an async-friendly interface.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from config.settings import settings


class RepoDiff:
    def __init__(self, file_path: str, diff_text: str, is_new: bool = False):
        self.file_path = file_path
        self.diff_text = diff_text
        self.is_new = is_new


class RepoManager:
    def __init__(self, repo_path: str | None = None) -> None:
        self._path = Path(repo_path or settings.code_default_repo_path)
        self._repo = None

    def _get_repo(self):
        if self._repo is None:
            import git
            self._repo = git.Repo(str(self._path))
        return self._repo

    # ------------------------------------------------------------------ #
    #  Info                                                                #
    # ------------------------------------------------------------------ #

    def current_branch(self) -> str:
        return self._get_repo().active_branch.name

    def status(self) -> dict[str, list[str]]:
        repo = self._get_repo()
        return {
            "modified":  [item.a_path for item in repo.index.diff(None)],
            "staged":    [item.a_path for item in repo.index.diff("HEAD")],
            "untracked": repo.untracked_files,
        }

    def log(self, max_count: int = 10) -> list[dict[str, str]]:
        repo = self._get_repo()
        return [
            {
                "sha":     c.hexsha[:8],
                "message": c.message.strip(),
                "author":  str(c.author),
                "date":    c.committed_datetime.isoformat(),
            }
            for c in repo.iter_commits(max_count=max_count)
        ]

    def get_diff(self, staged: bool = False) -> list[RepoDiff]:
        repo = self._get_repo()
        diffs = []
        target = repo.index.diff("HEAD") if staged else repo.index.diff(None)
        for diff in target:
            diffs.append(RepoDiff(
                file_path=diff.a_path,
                diff_text=diff.diff.decode(errors="replace") if diff.diff else "",
            ))
        return diffs

    def file_content(self, path: str) -> str:
        full_path = self._path / path
        return full_path.read_text(encoding="utf-8", errors="replace")

    def tree_summary(self, max_files: int = 100) -> list[str]:
        """Return a flat list of tracked file paths (for LLM context)."""
        repo = self._get_repo()
        files = []
        for item in repo.tree().traverse():
            if hasattr(item, "path"):
                files.append(item.path)
                if len(files) >= max_files:
                    break
        return files

    # ------------------------------------------------------------------ #
    #  Mutations                                                           #
    # ------------------------------------------------------------------ #

    def checkout_branch(self, branch: str, create: bool = False) -> None:
        repo = self._get_repo()
        if create:
            repo.git.checkout("-b", branch)
        else:
            repo.git.checkout(branch)

    def stage(self, paths: list[str]) -> None:
        self._get_repo().index.add(paths)

    def commit(self, message: str) -> str:
        repo = self._get_repo()
        commit = repo.index.commit(message)
        return commit.hexsha[:8]

    def push(self, remote: str = "origin", branch: str | None = None) -> None:
        repo = self._get_repo()
        b = branch or self.current_branch()
        repo.remotes[remote].push(b)

    def write_file(self, relative_path: str, content: str) -> None:
        full_path = self._path / relative_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")

    def apply_patch(self, patch: str) -> None:
        """Apply a unified diff patch to the working tree."""
        import subprocess
        result = subprocess.run(
            ["git", "apply", "--whitespace=fix"],
            input=patch.encode(),
            capture_output=True,
            cwd=str(self._path),
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode())
