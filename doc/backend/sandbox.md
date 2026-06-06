# Sandbox

> Referenced by [chat.md](chat.md) (`RunCodeTool`) and [api.md](api.md) (`/api/sandbox` routes).

---

# Sandbox Design

The sandbox executes user-submitted code in isolation. It is used by the `run_code` internal tool (chat engine) and exposed directly via the REST API at `/api/sandbox`.

---

## Execution Strategy

Two tiers are tried in order. The runner checks for `docker` on `$PATH` at call time and falls through to the subprocess tier if it is absent.

```
run_code(language, code, timeout)
    │
    ├── docker on PATH? ──YES──► _run_docker()
    │                                │
    │                           TimeoutError or FileNotFoundError?
    │                                │
    │                               YES──► _run_process()  (fallback)
    │
    └── NO──────────────────────────────► _run_process()
```

---

## Tier 1 — Docker

Each language runs in a dedicated Docker image. The source file is written to a host temp directory and bind-mounted read-only at `/code` inside the container. Compiled artefacts (binaries, JARs, `.class` files) are written to `/tmp` inside the container.

### Container flags

| Flag | Value | Purpose |
|---|---|---|
| `--network none` | — | No outbound network access |
| `--read-only` | — | Immutable root filesystem |
| `--tmpfs /tmp` | `size=128m` | Writable scratch space for compiled artefacts |
| `-v <host_tmpdir>:/code` | `:ro` | Source file, read-only |
| `--memory` / `--memory-swap` | `256m` | Hard memory cap |
| `--cpus` | `0.5` | Half a core |

### Timeout

`asyncio.wait_for(proc.communicate(), timeout=timeout + 5)` — the extra 5 seconds absorbs Docker image pull latency on a cold start. On hit, the container is killed and `timed_out: true` is returned.

---

## Tier 2 — Subprocess (fallback)

Used when Docker is unavailable. Checks `$PATH` for each language's `local_bins` in order and runs the first one found. No resource isolation — relies only on the asyncio timeout.

---

## Language Registry

Each language is a `LangSpec` dataclass with two execution paths: Docker (`cmd` / `shell_cmd`) and subprocess (`local_shell_cmd`). Path placeholders:

| Placeholder | Resolves to |
|---|---|
| `{file}` | Absolute path to the source file |
| `{out}` | Path for the compiled binary |
| `{tmpdir}` | Temp directory for intermediate files |

### Supported languages and images

| Language | Key | Docker image | Execution |
|---|---|---|---|
| Python | `python` | `python:3.12-slim` | Interpreted |
| JavaScript | `javascript` | `node:20-slim` | Interpreted |
| TypeScript | `typescript` | `node:20-slim` | `npx ts-node` via `sh -c` |
| Bash | `bash` | `bash:latest` | Interpreted |
| Ruby | `ruby` | `ruby:3.3-slim` | Interpreted |
| PHP | `php` | `php:8.3-cli-alpine` | Interpreted |
| Perl | `perl` | `perl:latest` | Interpreted |
| Lua | `lua` | `nickblah/lua:5.4-lua` | Interpreted |
| R | `r` | `r-base:latest` | `Rscript` |
| Elixir | `elixir` | `elixir:1.16-slim` | Interpreted |
| Swift | `swift` | `swift:5.10-slim` | Interpreted |
| Dart | `dart` | `dart:stable` | `dart run` via `sh -c` |
| Groovy | `groovy` | `groovy:4.0-jdk21` | Interpreted |
| C | `c` | `gcc:latest` | `gcc … && /tmp/main` |
| C++ | `cpp` | `gcc:latest` | `g++ -std=c++17 … && /tmp/main` |
| Java | `java` | `openjdk:21-slim` | Extract class name → `javac` → `java` |
| Go | `go` | `golang:1.22-alpine` | `go run` |
| Rust | `rust` | `rust:slim` | `rustc … && /tmp/main` |
| C# | `csharp` | `mcr.microsoft.com/dotnet/sdk:8.0` | Scaffold `.csproj` → `dotnet run` |
| Kotlin | `kotlin` | `zenika/kotlin:latest` | `kotlinc … -d main.jar && java -jar` |
| Scala | `scala` | `virtuslab/scala-cli:latest` | `scala-cli run` |
| Haskell | `haskell` | `haskell:9.8` | `runghc` |
| OCaml | `ocaml` | `ocaml/opam:ubuntu-24.04-ocaml-5.1` | `ocaml` |
| Erlang | `erlang` | `erlang:26-slim` | `escript` |
| Clojure | `clojure` | `clojure:temurin-21-tools-deps` | `clojure` |
| Objective-C | `objc` | `swift:5.10-slim` | `clang -x objective-c … -framework Foundation` |

> Objective-C reuses the Swift image, which ships `clang` and the Foundation framework headers.

---

## Result Schema

```python
{
    "stdout":      str,   # captured stdout, capped at 20 000 chars
    "stderr":      str,   # captured stderr, capped at 20 000 chars
    "exit_code":   int | None,  # None on timeout
    "duration_ms": int,   # wall-clock milliseconds
    "timed_out":   bool,
    "runtime":     "docker" | "process" | "error",
}
```

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `sandbox_timeout` | `60` s | Hard ceiling applied by both the tool and the API route. The tool uses `min(60, settings.sandbox_timeout)`; the API accepts 1–60 s per request. |

---

## API Surface

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/sandbox/run` | Execute code. Body: `{language, code, timeout?}` |
| `GET` | `/api/sandbox/languages` | List languages with `available` and `runtime` fields |

---

## Integration with the Chat Engine

The `RunCodeTool` (`backend/chat/tools/run_code.py`) wraps `run_code()` for LLM use:

1. Fuzzy-matches the model's language string against known aliases (e.g. `"C++"` → `"cpp"`, `"js"` → `"javascript"`).
2. Caps the timeout at `min(60, settings.sandbox_timeout)`.
3. Formats the result into a human-readable block that includes the code, stdout, stderr, exit code, wall time, and a timeout warning if applicable.
4. Returns a `ToolResult` — success when `exit_code == 0`, error otherwise.

The orchestrator routes messages to `run_code` when `_CODE_EXEC_RE` matches (e.g. "run this python code", "what does this snippet output").
