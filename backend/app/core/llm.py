import os
from langchain_community.chat_models import ChatLiteLLM
from sqlalchemy.orm import Session
from ..models.db import SessionLocal
from ..models.schema import GlobalSettings

# When running inside Docker, Ollama lives on the host — not localhost.
# Docker Desktop resolves host.docker.internal → host IP automatically on Mac/Windows.
# Override with OLLAMA_BASE_URL env var for custom setups (e.g. Ollama on a remote machine).
DEFAULT_OLLAMA_URL = os.environ.get(
    "OLLAMA_BASE_URL", "http://host.docker.internal:11434"
)


def get_settings_from_db():
    db: Session = SessionLocal()
    settings = db.query(GlobalSettings).first()
    db.close()
    if settings:
        return {
            "OPENAI_API_KEY": settings.openai_api_key or os.environ.get("OPENAI_API_KEY"),
            "ANTHROPIC_API_KEY": settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY"),
            "GEMINI_API_KEY": settings.google_api_key or os.environ.get("GEMINI_API_KEY"),
            "OLLAMA_BASE_URL": settings.ollama_base_url or DEFAULT_OLLAMA_URL
        }
    return {"OLLAMA_BASE_URL": DEFAULT_OLLAMA_URL}


def get_llm(provider: str, model_name: str, temperature: float = 0.7):
    """
    Returns a unified LangChain ChatLiteLLM instance.
    Provider mapping examples:
    - openai   → model="gpt-4o"
    - anthropic → model="claude-3-5-sonnet-20241022"
    - gemini   → model="gemini/gemini-2.0-flash"
    - ollama   → model="llama3.2:1b"  (routed to OLLAMA_BASE_URL)
    """
    settings = get_settings_from_db()
    
    # Set standard API keys in environment for LiteLLM
    for key in ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]:
        if settings.get(key):
            os.environ[key] = settings[key]

    # Build the LiteLLM model string
    no_prefix_providers = {"openai"}
    already_prefixed = f"{provider}/" in model_name
    full_model_string = (
        model_name
        if provider in no_prefix_providers or already_prefixed
        else f"{provider}/{model_name}"
    )

    kwargs = {"model": full_model_string, "temperature": temperature, "streaming": True}

    # Ollama: use dynamic URL from DB if available, else default
    if provider == "ollama":
        kwargs["api_base"] = settings.get("OLLAMA_BASE_URL") or DEFAULT_OLLAMA_URL

    return ChatLiteLLM(**kwargs)
