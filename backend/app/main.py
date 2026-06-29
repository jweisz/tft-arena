from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import inspect, text
from app.models.db import engine, Base
from app.api.rooms import router as rooms_router
from app.api.settings import router as settings_router
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.control import router as control_router
from app.api.agents import router as agents_router
from app.api.avatars import router as avatars_router
from app.api.messages import router as messages_router
from app.api.providers import router as providers_router
from app.api.gauntlet import router as gauntlet_router

# Create tables on startup if they don't exist
Base.metadata.create_all(bind=engine)

# --- Lightweight Migrations ---
inspector = inspect(engine)
columns = [c["name"] for c in inspector.get_columns("agents")]
if "emoji" not in columns:
    print("--- MIGRATION: Adding 'emoji' column to 'agents' table ---")
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE agents ADD COLUMN emoji VARCHAR DEFAULT '🤖'"))
        conn.commit()
if "relevance_instructions" not in columns:
    print("--- MIGRATION: Adding 'relevance_instructions' column to 'agents' table ---")
    with engine.connect() as conn:
        conn.execute(
            text(
                "ALTER TABLE agents ADD COLUMN relevance_instructions TEXT DEFAULT '' NOT NULL"
            )
        )
        conn.commit()
if "sort_order" not in columns:
    print("--- MIGRATION: Adding 'sort_order' column to 'agents' table ---")
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE agents ADD COLUMN sort_order INTEGER"))
        conn.execute(text("UPDATE agents SET sort_order = id WHERE sort_order IS NULL"))
        conn.commit()

if inspector.has_table("megaman_sessions") and not inspector.has_table(
    "gauntlet_sessions"
):
    print("--- MIGRATION: Renaming 'megaman_sessions' to 'gauntlet_sessions' ---")
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE megaman_sessions RENAME TO gauntlet_sessions"))
        conn.commit()

if inspector.has_table("gauntlet_sessions"):
    gs_columns = [c["name"] for c in inspector.get_columns("gauntlet_sessions")]
    if "difficulty" not in gs_columns:
        print("--- MIGRATION: Adding 'difficulty' column to 'gauntlet_sessions' table ---")
        with engine.connect() as conn:
            conn.execute(
                text("ALTER TABLE gauntlet_sessions ADD COLUMN difficulty VARCHAR DEFAULT 'difficult' NOT NULL")
            )
            conn.commit()

if inspector.has_table("battle_bosses"):
    bb_columns = [c["name"] for c in inspector.get_columns("battle_bosses")]
    if "provider_override" not in bb_columns:
        print(
            "--- MIGRATION: Adding 'provider_override' column to 'battle_bosses' table ---"
        )
        with engine.connect() as conn:
            conn.execute(
                text("ALTER TABLE battle_bosses ADD COLUMN provider_override VARCHAR")
            )
            conn.commit()
    if "model_override" not in bb_columns:
        print(
            "--- MIGRATION: Adding 'model_override' column to 'battle_bosses' table ---"
        )
        with engine.connect() as conn:
            conn.execute(
                text("ALTER TABLE battle_bosses ADD COLUMN model_override VARCHAR")
            )
            conn.commit()

if inspector.has_table("battle_messages"):
    bm_columns = [c["name"] for c in inspector.get_columns("battle_messages")]
    if "damage_reason" not in bm_columns:
        print(
            "--- MIGRATION: Adding 'damage_reason' column to 'battle_messages' table ---"
        )
        with engine.connect() as conn:
            conn.execute(
                text("ALTER TABLE battle_messages ADD COLUMN damage_reason TEXT")
            )
            conn.commit()

settings_columns = [c["name"] for c in inspector.get_columns("global_settings")]
if "non_agent_provider" not in settings_columns:
    print(
        "--- MIGRATION: Adding 'non_agent_provider' column to 'global_settings' table ---"
    )
    with engine.connect() as conn:
        conn.execute(
            text("ALTER TABLE global_settings ADD COLUMN non_agent_provider VARCHAR")
        )
        conn.commit()
if "non_agent_model" not in settings_columns:
    print(
        "--- MIGRATION: Adding 'non_agent_model' column to 'global_settings' table ---"
    )
    with engine.connect() as conn:
        conn.execute(
            text("ALTER TABLE global_settings ADD COLUMN non_agent_model VARCHAR")
        )
        conn.commit()

app = FastAPI(title="tft-arena Backend", version="1.0.0")

# Configure CORS for Vite development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")


def _health_payload() -> dict:
    return {
        "status": "ok",
        "version": "1.0.0",
        "endpoints": [
            "/api/rooms",
            "/api/settings",
            "/api/auth",
            "/api/chat/{room_id}/stream",
            "/api/health",
        ],
    }


@app.get("/api/health", tags=["Meta"])
def health_check():
    return _health_payload()


app.include_router(rooms_router)
app.include_router(settings_router)
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(control_router)
app.include_router(agents_router)
app.include_router(avatars_router)
app.include_router(messages_router)
app.include_router(providers_router)
app.include_router(gauntlet_router)
