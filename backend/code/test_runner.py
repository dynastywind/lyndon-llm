"""Test Runner — executes the project's test suite and parses results."""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class TestResult:
    passed: int = 0
    failed: int = 0
    errors: int = 0
    output: str = ""
    failures: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return self.failed == 0 and self.errors == 0


class TestRunner:
    def __init__(self, repo_path: str) -> None:
        self.repo_path = repo_path

    async def run(self, test_path: str | None = None, timeout: int = 120) -> TestResult:
        """
        Auto-detect the test framework and run tests.
        Supports pytest (Python) and npm test / vitest (JS/TS).
        """
        cmd = self._detect_command(test_path)
        try:
            proc = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=self.repo_path,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            output = stdout.decode(errors="replace")
            return self._parse_output(output, proc.returncode)
        except asyncio.TimeoutError:
            return TestResult(output=f"Tests timed out after {timeout}s")
        except Exception as e:
            return TestResult(output=str(e))

    def _detect_command(self, test_path: str | None) -> str:
        p = Path(self.repo_path)
        if (p / "pytest.ini").exists() or (p / "pyproject.toml").exists():
            target = test_path or ""
            return f"python -m pytest {target} -v --tb=short"
        if (p / "package.json").exists():
            return "npm test -- --run" if (p / "vite.config.ts").exists() else "npm test"
        return f"python -m pytest {test_path or ''} -v"

    def _parse_output(self, output: str, returncode: int) -> TestResult:
        result = TestResult(output=output)

        # pytest summary line: "3 passed, 1 failed, 0 errors"
        m = re.search(r"(\d+) passed", output)
        if m:
            result.passed = int(m.group(1))
        m = re.search(r"(\d+) failed", output)
        if m:
            result.failed = int(m.group(1))
        m = re.search(r"(\d+) error", output)
        if m:
            result.errors = int(m.group(1))

        # Collect individual failure names
        result.failures = re.findall(r"FAILED (.+?) -", output)

        # If no pytest summary found, use returncode
        if result.passed == 0 and result.failed == 0 and result.errors == 0:
            if returncode != 0:
                result.errors = 1

        return result
