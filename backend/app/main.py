from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
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

# Create tables on startup if they don't exist
Base.metadata.create_all(bind=engine)

app = FastAPI(title="tft-arena Backend", version="1.0.0")

# Configure CORS for Vite development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")

@app.get("/health", tags=["Meta"])
def health_check():
    return {"status": "ok", "version": "1.0.0", "endpoints": ["/api/rooms", "/api/settings", "/api/auth", "/api/chat/{room_id}/stream"]}

app.include_router(rooms_router)
app.include_router(settings_router)
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(control_router)
app.include_router(agents_router)
app.include_router(avatars_router)
app.include_router(messages_router)
app.include_router(providers_router)
