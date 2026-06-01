#!/bin/bash
# Backend startup wrapper — activates the venv via env vars (avoids pyvenv.cfg read)
BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$BACKEND_DIR/.venv"

export VIRTUAL_ENV="$VENV"
export PATH="$VENV/bin:$PATH"
unset PYTHONHOME

cd "$BACKEND_DIR"
exec "$VENV/bin/python" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
