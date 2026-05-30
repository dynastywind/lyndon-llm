"""
Sandbox runner — execute user code in an isolated environment.

Execution strategy (tried in order):
  1. Docker  — network-disabled, read-only container with memory + CPU caps.
               Compiled languages write binaries to /tmp inside the container.
  2. Process — subprocess with asyncio timeout in a disposable temp dir.
               Used automatically when Docker is unavailable.

Output is capped at OUTPUT_LIMIT chars to prevent runaway prints.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import time
from dataclasses import dataclass, field

OUTPUT_LIMIT = 20_000   # characters

# ---------------------------------------------------------------------------
# Language registry
# ---------------------------------------------------------------------------

@dataclass
class LangSpec:
    label:           str
    extension:       str       # source file extension
    docker_image:    str       # Docker image name
    local_bins:      list[str] # binaries checked for subprocess-fallback availability
    # Docker entrypoint:
    #   If shell_cmd is set → runs as: sh -c "shell_cmd"
    #     Use /code/main.<ext> for the source file path.
    #     Write any compiled outputs to /tmp/ (the only writable dir).
    #   Else → direct exec via cmd list ({file} → /code/main.<ext>)
    cmd:             list[str] = field(default_factory=list)
    shell_cmd:       str | None = None
    # Subprocess fallback:
    #   If local_shell_cmd is set → bash -c "local_shell_cmd"
    #     Placeholders: {file}=source path, {out}=output binary, {tmpdir}=temp dir
    #   Else → [interpreter, source_file]
    local_shell_cmd: str | None = None


# ---------------------------------------------------------------------------
# All supported languages
# ---------------------------------------------------------------------------

LANGUAGES: dict[str, LangSpec] = {

    # ── Interpreted ──────────────────────────────────────────────────────

    "python": LangSpec(
        label="Python", extension="py",
        docker_image="python:3.12-slim",
        cmd=["python3", "{file}"],
        local_bins=["python3", "python"],
    ),
    "javascript": LangSpec(
        label="JavaScript", extension="js",
        docker_image="node:20-slim",
        cmd=["node", "{file}"],
        local_bins=["node"],
    ),
    "typescript": LangSpec(
        label="TypeScript", extension="ts",
        docker_image="node:20-slim",
        shell_cmd="HOME=/tmp npm_config_cache=/tmp/npm npx --yes ts-node /code/main.ts",
        local_bins=["ts-node", "npx"],
        local_shell_cmd=(
            "ts_node=$(which ts-node 2>/dev/null); "
            'if [ -n "$ts_node" ]; then "$ts_node" {file}; '
            "else HOME={tmpdir} npm_config_cache={tmpdir}/npm npx --yes ts-node {file}; fi"
        ),
    ),
    "bash": LangSpec(
        label="Bash", extension="sh",
        docker_image="bash:latest",
        cmd=["bash", "{file}"],
        local_bins=["bash"],
    ),
    "ruby": LangSpec(
        label="Ruby", extension="rb",
        docker_image="ruby:3.3-slim",
        cmd=["ruby", "{file}"],
        local_bins=["ruby"],
    ),
    "php": LangSpec(
        label="PHP", extension="php",
        docker_image="php:8.3-cli-alpine",
        cmd=["php", "{file}"],
        local_bins=["php"],
    ),
    "perl": LangSpec(
        label="Perl", extension="pl",
        docker_image="perl:latest",
        cmd=["perl", "{file}"],
        local_bins=["perl"],
    ),
    "lua": LangSpec(
        label="Lua", extension="lua",
        docker_image="nickblah/lua:5.4-lua",
        cmd=["lua", "{file}"],
        local_bins=["lua"],
    ),
    "r": LangSpec(
        label="R", extension="r",
        docker_image="r-base:latest",
        cmd=["Rscript", "{file}"],
        local_bins=["Rscript"],
    ),
    "elixir": LangSpec(
        label="Elixir", extension="exs",
        docker_image="elixir:1.16-slim",
        cmd=["elixir", "{file}"],
        local_bins=["elixir"],
    ),
    "swift": LangSpec(
        label="Swift", extension="swift",
        docker_image="swift:5.10-slim",
        cmd=["swift", "{file}"],
        local_bins=["swift"],
    ),
    "dart": LangSpec(
        label="Dart", extension="dart",
        docker_image="dart:stable",
        shell_cmd="dart run /code/main.dart",
        local_bins=["dart"],
        local_shell_cmd="dart run {file}",
    ),
    "groovy": LangSpec(
        label="Groovy", extension="groovy",
        docker_image="groovy:4.0-jdk21",
        cmd=["groovy", "{file}"],
        local_bins=["groovy"],
    ),

    # ── Compiled / two-phase ─────────────────────────────────────────────

    "c": LangSpec(
        label="C", extension="c",
        docker_image="gcc:latest",
        shell_cmd="gcc /code/main.c -o /tmp/main -lm 2>&1 && /tmp/main",
        local_bins=["gcc", "clang"],
        local_shell_cmd="gcc {file} -o {out} -lm && {out}",
    ),
    "cpp": LangSpec(
        label="C++", extension="cpp",
        docker_image="gcc:latest",
        shell_cmd="g++ /code/main.cpp -o /tmp/main -std=c++17 2>&1 && /tmp/main",
        local_bins=["g++", "clang++"],
        local_shell_cmd="g++ {file} -o {out} -std=c++17 && {out}",
    ),
    "java": LangSpec(
        label="Java", extension="java",
        docker_image="openjdk:21-slim",
        # Extract the public class name so the filename matches; fall back to "Main"
        shell_cmd=(
            "CN=$(grep -oP '(?<=public class )\\w+' /code/main.java | head -1 || echo Main) && "
            "cp /code/main.java /tmp/$CN.java && "
            "cd /tmp && javac $CN.java 2>&1 && java $CN"
        ),
        local_bins=["javac", "java"],
        local_shell_cmd=(
            'CN=$(grep -oP "(?<=public class )\\w+" {file} | head -1 || echo Main) && '
            "cp {file} {tmpdir}/$CN.java && "
            "cd {tmpdir} && javac $CN.java && java $CN"
        ),
    ),
    "go": LangSpec(
        label="Go", extension="go",
        docker_image="golang:1.22-alpine",
        shell_cmd="GOPATH=/tmp/go HOME=/tmp go run /code/main.go",
        local_bins=["go"],
        local_shell_cmd="go run {file}",
    ),
    "rust": LangSpec(
        label="Rust", extension="rs",
        docker_image="rust:slim",
        shell_cmd="rustc /code/main.rs -o /tmp/main 2>&1 && /tmp/main",
        local_bins=["rustc"],
        local_shell_cmd="rustc {file} -o {out} && {out}",
    ),
    "csharp": LangSpec(
        label="C#", extension="cs",
        docker_image="mcr.microsoft.com/dotnet/sdk:8.0",
        shell_cmd=(
            "mkdir -p /tmp/p && "
            r"printf '<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup>"
            r"<OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework>"
            r"</PropertyGroup></Project>' > /tmp/p/p.csproj && "
            "cp /code/main.cs /tmp/p/Program.cs && "
            "cd /tmp/p && dotnet run 2>&1"
        ),
        local_bins=["dotnet"],
        local_shell_cmd=(
            "mkdir -p {tmpdir}/p && "
            r"printf '<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup>"
            r"<OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework>"
            r"</PropertyGroup></Project>' > {tmpdir}/p/p.csproj && "
            "cp {file} {tmpdir}/p/Program.cs && "
            "cd {tmpdir}/p && dotnet run"
        ),
    ),
    "kotlin": LangSpec(
        label="Kotlin", extension="kt",
        docker_image="zenika/kotlin:latest",
        shell_cmd=(
            "cd /tmp && kotlinc /code/main.kt -include-runtime -d main.jar 2>&1 "
            "&& java -jar main.jar"
        ),
        local_bins=["kotlinc"],
        local_shell_cmd=(
            "cd {tmpdir} && kotlinc {file} -include-runtime -d main.jar && "
            "java -jar main.jar"
        ),
    ),
    "scala": LangSpec(
        label="Scala", extension="scala",
        docker_image="virtuslab/scala-cli:latest",
        shell_cmd="scala-cli run /code/main.scala 2>&1",
        local_bins=["scala-cli", "scala"],
        local_shell_cmd="scala-cli run {file} || scala {file}",
    ),
    "haskell": LangSpec(
        label="Haskell", extension="hs",
        docker_image="haskell:9.8",
        shell_cmd="runghc /code/main.hs",
        local_bins=["runghc", "runhaskell"],
        local_shell_cmd="runghc {file}",
    ),
    "ocaml": LangSpec(
        label="OCaml", extension="ml",
        docker_image="ocaml/opam:ubuntu-24.04-ocaml-5.1",
        shell_cmd="ocaml /code/main.ml",
        local_bins=["ocaml"],
        local_shell_cmd="ocaml {file}",
    ),
    "erlang": LangSpec(
        label="Erlang", extension="erl",
        docker_image="erlang:26-slim",
        # escript requires a -module header; use erl eval for simple scripts
        shell_cmd="escript /code/main.erl",
        local_bins=["escript", "erl"],
        local_shell_cmd="escript {file}",
    ),
    "clojure": LangSpec(
        label="Clojure", extension="clj",
        docker_image="clojure:temurin-21-tools-deps",
        shell_cmd="clojure /code/main.clj",
        local_bins=["clojure"],
        local_shell_cmd="clojure {file}",
    ),
    "objc": LangSpec(
        label="Objective-C", extension="m",
        docker_image="swift:5.10-slim",  # includes clang with ObjC + Foundation
        shell_cmd=(
            "clang -x objective-c /code/main.m -framework Foundation "
            "-o /tmp/main 2>&1 && /tmp/main"
        ),
        local_bins=["clang"],
        local_shell_cmd=(
            "clang -x objective-c {file} -framework Foundation -o {out} && {out}"
        ),
    ),
}


def available_languages() -> list[dict]:
    """Return language specs with availability and runtime info."""
    has_docker = bool(shutil.which("docker"))
    result = []
    for key, spec in LANGUAGES.items():
        local_bin = next((shutil.which(b) for b in spec.local_bins if shutil.which(b)), None)
        result.append({
            "id":        key,
            "label":     spec.label,
            "available": has_docker or local_bin is not None,
            "runtime":   "docker" if has_docker else ("process" if local_bin else "unavailable"),
        })
    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def run_code(
    language: str,
    code: str,
    timeout: int = 30,
) -> dict:
    """
    Execute *code* in *language* and return a result dict:
      stdout      — captured standard output (capped)
      stderr      — captured standard error  (capped)
      exit_code   — process exit code (None on timeout)
      duration_ms — wall time in milliseconds
      timed_out   — True if the timeout was hit
      runtime     — "docker" | "process" | "error"
    """
    spec = LANGUAGES.get(language)
    if spec is None:
        return _err(f"Unsupported language: {language!r}.  "
                    f"Supported: {', '.join(sorted(LANGUAGES))}")

    if shutil.which("docker"):
        return await _run_docker(spec, code, timeout)
    return await _run_process(spec, code, timeout)


# ---------------------------------------------------------------------------
# Docker execution
# ---------------------------------------------------------------------------

async def _run_docker(spec: LangSpec, code: str, timeout: int) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        fname = f"main.{spec.extension}"
        fpath = os.path.join(tmpdir, fname)
        with open(fpath, "w") as fh:
            fh.write(code)

        # Build the Docker entrypoint
        if spec.shell_cmd:
            entrypoint = ["sh", "-c", spec.shell_cmd]
        else:
            entrypoint = [
                c.replace("{file}", f"/code/{fname}") for c in spec.cmd
            ]

        docker_cmd = [
            "docker", "run",
            "--rm",
            "--network", "none",
            "--memory",  "256m",
            "--memory-swap", "256m",
            "--cpus",    "0.5",
            "--read-only",
            "--tmpfs",   "/tmp:size=128m",  # 128m for compiled artefacts
            "-v",        f"{tmpdir}:/code:ro",
            spec.docker_image,
            *entrypoint,
        ]

        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *docker_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout + 5
                )
                return {
                    "stdout":      stdout_b.decode(errors="replace")[:OUTPUT_LIMIT],
                    "stderr":      stderr_b.decode(errors="replace")[:OUTPUT_LIMIT],
                    "exit_code":   proc.returncode,
                    "duration_ms": _ms(t0),
                    "timed_out":   False,
                    "runtime":     "docker",
                }
            except asyncio.TimeoutError:
                try: proc.kill()
                except Exception: pass
                return _timeout(t0, "docker")
        except FileNotFoundError:
            pass  # docker not found — fall through to subprocess

    return await _run_process(spec, code, timeout)


# ---------------------------------------------------------------------------
# Subprocess execution (fallback)
# ---------------------------------------------------------------------------

async def _run_process(spec: LangSpec, code: str, timeout: int) -> dict:
    interp = next((shutil.which(b) for b in spec.local_bins if shutil.which(b)), None)
    if interp is None:
        return _err(
            f"No interpreter / compiler found for {spec.label}.  "
            f"Tried: {', '.join(spec.local_bins)}"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        fname = f"main.{spec.extension}"
        fpath = os.path.join(tmpdir, fname)
        with open(fpath, "w") as fh:
            fh.write(code)

        if spec.local_shell_cmd:
            out = os.path.join(tmpdir, "out")
            cmd_str = (
                spec.local_shell_cmd
                .replace("{file}",   fpath)
                .replace("{out}",    out)
                .replace("{tmpdir}", tmpdir)
            )
            cmd = ["bash", "-c", cmd_str]
        else:
            cmd = [interp, fpath]

        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=tmpdir,
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
                return {
                    "stdout":      stdout_b.decode(errors="replace")[:OUTPUT_LIMIT],
                    "stderr":      stderr_b.decode(errors="replace")[:OUTPUT_LIMIT],
                    "exit_code":   proc.returncode,
                    "duration_ms": _ms(t0),
                    "timed_out":   False,
                    "runtime":     "process",
                }
            except asyncio.TimeoutError:
                try: proc.kill()
                except Exception: pass
                return _timeout(t0, "process")
        except Exception as exc:
            return _err(str(exc))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ms(t0: float) -> int:
    return round((time.monotonic() - t0) * 1000)


def _timeout(t0: float, runtime: str) -> dict:
    return {
        "stdout":      "",
        "stderr":      "Execution timed out.",
        "exit_code":   None,
        "duration_ms": _ms(t0),
        "timed_out":   True,
        "runtime":     runtime,
    }


def _err(message: str) -> dict:
    return {
        "stdout":      "",
        "stderr":      message,
        "exit_code":   1,
        "duration_ms": 0,
        "timed_out":   False,
        "runtime":     "error",
    }
