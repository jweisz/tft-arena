# TFT Arena

Multi-agent reasoning workspace with FastAPI + LangGraph backend and React + Vite frontend.

## Overview

TFT Arena runs multiple configurable agent personas in a shared conversation. A router scores relevance each turn, selected agents respond, and the UI streams token output, telemetry, and semantic scratchpad updates over WebSocket.

Key capabilities:

- Importance-based router for selective participation.
- Streaming token responses with per-agent telemetry and turn budgets.
- Semantic scratchpad updates (consensus, key ideas, open questions).
- Provider support for OpenAI, Anthropic, Gemini, and Ollama.

## Repo Layout

- `backend/`: FastAPI app, LangGraph orchestration, SQLAlchemy models, pytest suite.
- `frontend/`: React app, Vite build, Zustand state, Vitest suite.
- `docker-compose.yml`: Single Docker workflow with file sync/watch and standard `up --build`.

## Prerequisites

- Python 3.11+
- Node 20+
- npm
- Docker + Docker Compose (optional)

## Local Development

### 1) Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install uv
uv sync --extra dev
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Compatibility fallback:

```bash
pip install -r requirements.txt
```

Backend API/docs:

- `http://localhost:8000/docs`

Health checks:

- Canonical: `GET /api/health`
- Legacy alias: `GET /health`

Example:

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/health
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend app:

- `http://localhost:5173`

## Docker Workflows

### Dev watch mode (hot reload)

```bash
docker compose watch
```

Linux Docker Engine needs an extra override so `host.docker.internal` maps to the host gateway:

```bash
docker compose -f docker-compose.yml -f docker-compose.linux.yml watch
```

Ports:

- frontend: `5173`
- backend: `8000`

### Build and run

```bash
docker compose up --build
```

Ports:

- frontend: `5173`
- backend: `8000`

## Auth Mode (Current Behavior)

The project is currently local-first and permissive by default.

- If `ALLOWED_USER_EMAIL` is unset, backend auth mode is `local-open`.
- If `ALLOWED_USER_EMAIL` is set, backend auth mode becomes allowlist JWT validation.

Policy introspection endpoint:

- `GET /api/auth/policy-map`

This endpoint returns the current auth mode and route policy map (REST + WS), used for auth-readiness without forcing full auth rollout yet.

## Quality Gates

Backend:

```bash
cd backend
uv sync --extra dev
uv run python -m pytest
```

Frontend:

```bash
cd frontend
npm run lint
npm test
npm run build
```

## DB Inspection

To check which tables exist and how many rows each contains, run this one-liner from the `backend/` directory with the venv active:

```bash
python - <<'EOF'
from app.models.db import DATABASE_URL, engine
from sqlalchemy import inspect, text
print(f"DATABASE_URL: {DATABASE_URL}")
inspector = inspect(engine)
for table in inspector.get_table_names():
    with engine.connect() as conn:
        count = conn.execute(text(f"SELECT count(*) FROM {table}")).scalar()
    print(f"  {table}: {count} rows")
EOF
```

## License

Apache 2.0. See `LICENSE`.
