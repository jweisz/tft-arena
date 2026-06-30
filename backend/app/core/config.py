"""
Centralized backend configuration.

Three tiers, by what each value is:
  - Secrets / per-deployment infra  -> environment variables (here).
  - Static, non-secret tuning        -> app/config.toml (loaded here).
  - Runtime, user-editable settings  -> the database (GlobalSettings).

The private hosted overlay layers behavior on top via dependency overrides; it
does not modify this file.
"""

import os
import tomllib
from functools import lru_cache
from importlib import resources


# Deployment mode. The public core only ever runs as "self_host". The private
# overlay sets DEPLOYMENT_MODE=hosted and overrides the relevant dependencies.
DEPLOYMENT_MODE = os.environ.get("DEPLOYMENT_MODE", "self_host").strip().lower()

# Default CORS origins for local Vite dev servers (Arena :5173, Gauntlet :5174).
_DEFAULT_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]


def is_hosted() -> bool:
    return DEPLOYMENT_MODE == "hosted"


_DEFAULT_GAME_NAME = "TFT Arena"


@lru_cache(maxsize=1)
def _config() -> dict:
    """Load and cache app/config.toml.

    Read via importlib.resources so it resolves whether the core runs in-tree or
    pip-installed (e.g. by the overlay). Edits require a restart.
    """
    try:
        raw = resources.files("app").joinpath("config.toml").read_text(
            encoding="utf-8"
        )
        return tomllib.loads(raw)
    except Exception:
        return {}


def game_name() -> str:
    """Display name of the game (config.toml [branding].name)."""
    name = _config().get("branding", {}).get("name")
    return (name or _DEFAULT_GAME_NAME).strip() or _DEFAULT_GAME_NAME


@lru_cache(maxsize=1)
def allowed_origins() -> list[str]:
    """CORS origins.

    Set ALLOWED_ORIGINS to a comma-separated list in production
    (e.g. "https://idea-gauntlet.com,https://www.idea-gauntlet.com").
    Falls back to the local dev origins when unset.
    """
    raw = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return list(_DEFAULT_DEV_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
