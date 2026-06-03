# Development Standards

## Code Quality

### Lint Compliance

All code committed to this repository must pass the project's lint checks without errors or warnings before being considered complete. Lint compliance is not optional and must not be deferred.

**Backend (Python)**

All Python code must satisfy [Ruff](https://docs.astral.sh/ruff/) with the rule set defined in `backend/pyproject.toml`. Verify compliance by running:

```bash
cd backend && .venv/bin/ruff check .
```

The following categories of violations are enforced and must be resolved in source — not suppressed — unless a suppression is the only appropriate remedy:

- `E` / `W` — PEP 8 style errors and warnings
- `F` — Unused imports, undefined names, and other Pyflakes diagnostics
- `I` — Import ordering (isort-compatible)
- `B` — Likely bugs and design issues (flake8-bugbear), including `B904` (raise-from-err) and `B905` (zip strict=)
- `SIM` — Unnecessary complexity (e.g. prefer `contextlib.suppress` over bare `try/except/pass`)
- `UP` / `C4` / `ASYNC` / `TCH` — Modernisation, comprehension clarity, async safety, and type-checking guards

Inline suppressions (`# noqa: <code>`) are permitted only when the flagged pattern is intentional and a comment explains why.

**Frontend (TypeScript / React)**

All TypeScript and TSX code must pass [ESLint](https://eslint.org/) with zero errors and zero warnings at the `--max-warnings 0` threshold, using the configuration in `frontend/.eslintrc.cjs`. Verify compliance by running:

```bash
cd frontend && npx eslint . --ext ts,tsx --max-warnings 0
```

All source files must also conform to [Prettier](https://prettier.io/) formatting. Verify and apply by running:

```bash
cd frontend && npx prettier --write "src/**/*.{ts,tsx,css}"
```

Inline ESLint suppressions (`// eslint-disable-next-line <rule>`) are permitted only for patterns that are provably correct but cannot be restructured to satisfy the rule (e.g. intentional infinite loops with an explicit `break`). Each suppression must be accompanied by a comment explaining the rationale.

### Enforcement

A change that introduces new lint errors — even if the errors are unrelated to the primary modification — must resolve those errors as part of the same commit. Lint fixes must not be committed separately from the code that introduces the violations, except when fixing pre-existing lint debt unrelated to the current change.
