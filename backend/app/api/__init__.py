from .rooms import router as rooms_router
from .settings import router as settings_router
from .auth import router as auth_router
from .chat import router as chat_router

__all__ = ["rooms_router", "settings_router", "auth_router", "chat_router"]
