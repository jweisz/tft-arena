# TFT Arena

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Backend: FastAPI](https://img.shields.io/badge/backend-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![Frontend: React+Vite](https://img.shields.io/badge/frontend-React%20%2B%20Vite-646CFF.svg)](https://vite.dev/)

Multi-agent reasoning workspace where specialized personas debate ideas in a chat room arena.

![TFT Arena UI screenshot](docs/images/screenshot.png)

## Purpose

TFT Arena explores how AI can be used as a tool for thought — helping people think better, not just get answers faster. Distinct agent personas challenge assumptions, introduce competing perspectives, and surface blind spots that a single assistant response would miss. The goal is to develop clearer, more resilient reasoning through structured multi-agent conversation.

TFT Arena provides:

- multi-persona conversations in a shared room,
- dynamic routing so only relevant agents respond,
- real-time token streaming and telemetry,
- semantic state tracking (consensus, key ideas, open questions),
- and model-provider flexibility (OpenAI, Anthropic, Gemini, Ollama).

## Quick Start

**Prerequisites**:

- [uv](https://docs.astral.sh/uv/getting-started/installation/) — Python package and project manager
- [mise](https://mise.jdx.dev/getting-started.html) — task runner (Option A)
- Node 20+ and npm
- [Docker + Docker Compose](https://docs.docker.com/get-started/get-docker/) — containerized workflow (Option B)

Choose one path:

### Option A: mise runner (quick local workflow)

```bash
mise run app
```

This installs dependencies on first run, then starts backend and frontend together.

### Option B: Docker (fastest containerized run)

```bash
mise run docker-up
```

To stop: `mise run docker-down`

Linux Docker Engine users must use the override directly:

```bash
docker compose -f docker-compose.yml -f docker-compose.linux.yml watch
```

### Option C: Manual local dev (backend + frontend)

1. Start backend:

```bash
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

2. In a new terminal, start frontend:

```bash
cd frontend
npm install
npm run dev
```

### Once running

- Frontend: `http://localhost:5173`
- Backend docs: `http://localhost:8000/docs`
- Backend health: `http://localhost:8000/api/health`

## Project Layout

- `backend/`: FastAPI API, LangGraph orchestration, SQLAlchemy models, pytest tests.
- `frontend/`: React client, Zustand state, Vite tooling, Vitest tests.
- `docker-compose.yml`: Docker dev workflow with sync/watch for hot reload.
- `docker-compose.linux.yml`: Linux host-gateway override for `host.docker.internal`.
- `mise.toml`: convenience tasks for local app startup, Docker lifecycle, and tests.

## Development Workflows

Use Quick Start to launch the app. This section is a command reference for common dev tasks.

### Docker reference

Dev watch mode:

```bash
docker compose watch
```

Build and run once:

```bash
docker compose up --build
```

Stop and clean up:

```bash
docker compose down
```

### Local workflows

Optional compatibility fallback for backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

Optional task-runner shortcuts (if you use mise):

```bash
mise run install      # install all dependencies
mise run app          # install deps + start backend + frontend
mise run app-backend  # backend only
mise run app-frontend # frontend only
mise run test         # backend tests
mise run docker-up    # docker compose watch
mise run docker-down  # docker compose down
```

## API and Health Endpoints

- OpenAPI docs: `GET http://localhost:8000/docs`
- Health: `GET http://localhost:8000/api/health`

Quick check:

```bash
curl http://localhost:8000/api/health
```

## Testing and Quality Checks

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

## Troubleshooting

1. Frontend loads but no data appears: confirm backend is running on port `8000`, then check `http://localhost:8000/api/health`.
2. Docker on Linux cannot reach host services (for example Ollama): use `docker-compose.linux.yml` override with `docker compose -f docker-compose.yml -f docker-compose.linux.yml watch`.
3. Dependency issues after updates: rerun `uv sync --extra dev` in `backend/` and `npm install` in `frontend/`.

## Database Inspection

From `backend/` (with venv active), inspect table row counts:

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

## Contributing

Contributions are welcome. If you want to help, a great starting point is:

1. Run the app locally (Docker or local workflow).
2. Run backend and frontend tests.
3. Open a focused PR with clear reproduction steps for fixes.

## License

Apache 2.0. See [LICENSE](LICENSE).
