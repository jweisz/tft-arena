from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..models import schema
from ..schemas import pydantic_models
from ..models.db import get_db

router = APIRouter(prefix="/api/settings", tags=["Settings"])

# Global settings for the single authorized user
@router.get("/", response_model=dict)
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(schema.GlobalSettings).first()
    if not settings:
        return {}
    return {
        "openai_api_key": settings.openai_api_key is not None,
        "anthropic_api_key": settings.anthropic_api_key is not None,
        "google_api_key": settings.google_api_key is not None,
        "ollama_base_url": settings.ollama_base_url,
        "theme_preferences": settings.theme_preferences,
        "default_agent_turn_budget": settings.default_agent_turn_budget,
        "global_system_instruction": settings.global_system_instruction
    }

@router.post("/")
def update_settings(settings_in: dict, db: Session = Depends(get_db)):
    settings = db.query(schema.GlobalSettings).first()
    if not settings:
        # Assuming single user system for v1
        settings = schema.GlobalSettings()
        db.add(settings)
    
    if "openai_api_key" in settings_in:
        settings.openai_api_key = settings_in["openai_api_key"]
    if "anthropic_api_key" in settings_in:
        settings.anthropic_api_key = settings_in["anthropic_api_key"]
    if "google_api_key" in settings_in:
        settings.google_api_key = settings_in["google_api_key"]
    if "ollama_base_url" in settings_in:
        settings.ollama_base_url = settings_in["ollama_base_url"]
    if "theme_preferences" in settings_in:
        settings.theme_preferences = settings_in["theme_preferences"]
    if "default_agent_turn_budget" in settings_in:
        settings.default_agent_turn_budget = settings_in["default_agent_turn_budget"]
    if "global_system_instruction" in settings_in:
        settings.global_system_instruction = settings_in["global_system_instruction"]
        
    db.commit()
    return {"status": "updated"}
