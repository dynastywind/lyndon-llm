"""
Repo Manager — git operations for the Code block.
Wraps gitpython with an async-friendly interface.
"""

from __future__ import annotations

from contextlib import suppress
from pathlib import Path

from config.settings import settings


class RepoDiff:
    def __init__(self, file_path: str, diff_text: str, is_new: bool = False):
        self.file_path = file_path
        self.diff_text = diff_text
        self.is_new = is_new


def _authed_clone_url(clone_url: str, token: str | None) -> str:
    """Inject a token into an https GitHub URL so private repos clone non-interactively."""
    if not token or not clone_url.startswith("https://"):
        return clone_url
    return clone_url.replace("https://", f"https://x-access-token:{token}@", 1)


def _clean_remote_url(clone_url: str) -> str:
    """Strip any embedded credentials so the token is never written to .git/config."""
    import re

    return re.sub(r"https://[^@/]+@", "https://", clone_url, count=1)


async def clone_repo(
    clone_url: str, target_dir: str, token: str | None = None, branch: str | None = None
) -> str:
    """Clone *clone_url* into *target_dir*. Returns the checked-out branch.

    Runs the synchronous GitPython clone off the event loop. After cloning, the
    ``origin`` remote is reset to the token-free URL so credentials never persist on
    disk. When *branch* is given, that branch is checked out (``--branch``).
    """
    import asyncio

    def _do_clone() -> str:
        import git

        kwargs = {"branch": branch} if branch else {}
        repo = git.Repo.clone_from(_authed_clone_url(clone_url, token), target_dir, **kwargs)
        with suppress(Exception):  # always strip any embedded token from the saved remote
            repo.remote("origin").set_url(_clean_remote_url(clone_url))
        try:
            return repo.active_branch.name
        except TypeError:  # detached HEAD (rare for a fresh clone)
            return repo.head.commit.hexsha[:8]

    return await asyncio.to_thread(_do_clone)


async def pull_repo(repo_path: str, token: str | None = None) -> None:
    """``git pull`` the current branch, authenticating from *token* (off the event loop)."""
    import asyncio

    def _do_pull() -> None:
        import git

        repo = git.Repo(repo_path)
        branch = repo.active_branch.name
        url = next(iter(repo.remote("origin").urls))
        repo.git.pull(_authed_clone_url(url, token), branch)

    await asyncio.to_thread(_do_pull)


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
            "modified": [item.a_path for item in repo.index.diff(None)],
            "staged": [item.a_path for item in repo.index.diff("HEAD")],
            "untracked": repo.untracked_files,
        }

    def ahead_behind(self) -> tuple[int, int]:
        """Commits the local branch is (ahead, behind) its upstream. (0, 0) if no upstream."""
        repo = self._get_repo()
        try:
            branch = repo.active_branch
            tracking = branch.tracking_branch()
            if tracking is None:
                return (0, 0)
            counts = repo.git.rev_list(
                "--left-right", "--count", f"{tracking.name}...{branch.name}"
            )
            behind, ahead = counts.split()
            return (int(ahead), int(behind))
        except (ValueError, TypeError):
            return (0, 0)

    def log(self, max_count: int = 10) -> list[dict[str, str]]:
        repo = self._get_repo()
        return [
            {
                "sha": c.hexsha[:8],
                "message": c.message.strip(),
                "author": str(c.author),
                "date": c.committed_datetime.isoformat(),
            }
            for c in repo.iter_commits(max_count=max_count)
        ]

    def get_diff(self, staged: bool = False) -> list[RepoDiff]:
        repo = self._get_repo()
        diffs = []
        target = repo.index.diff("HEAD") if staged else repo.index.diff(None)
        for diff in target:
            diffs.append(
                RepoDiff(
                    file_path=diff.a_path,
                    diff_text=diff.diff.decode(errors="replace") if diff.diff else "",
                )
            )
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
