"""Database query helpers for chat runtime."""

from typing import Any

from sqlalchemy.orm import Session

from ...models import schema


def load_agents(room: schema.Room | None, db: Session, default_budget: int = 3) -> list[dict[str, Any]]:
    if not room:
        return []

    active_mappings = db.query(schema.RoomAgent).filter(
        schema.RoomAgent.room_id == room.id,
        schema.RoomAgent.is_active,
    ).all()
    active_agent_ids = [mapping.agent_id for mapping in active_mappings]

    if not active_agent_ids:
        return []

    agents = db.query(schema.Agent).filter(schema.Agent.id.in_(active_agent_ids)).all()
    return [
        {
            "id": agent.id,
            "name": agent.name,
            "role_description": agent.role_description,
            "relevance_instructions": agent.relevance_instructions or "",
            "system_prompt": agent.system_prompt,
            "emoji": agent.emoji or "🤖",
            "model": agent.model,
            "provider": agent.provider,
            "token_budget": agent.token_budget or default_budget,
        }
        for agent in agents
    ]


def load_settings(db: Session) -> tuple[int, str]:
    settings = db.query(schema.GlobalSettings).first()
    if not settings:
        return 3, ""

    return settings.default_agent_turn_budget or 3, settings.global_system_instruction or ""


def get_activity_stats(room_id: int, db: Session) -> dict[str, int]:
    """Return total message counts per agent for the room."""
    from sqlalchemy import func

    results = db.query(
        schema.Agent.name,
        func.count(schema.Message.id),
    ).join(
        schema.Message, schema.Agent.id == schema.Message.agent_id,
    ).filter(
        schema.Message.room_id == room_id,
        schema.Message.role == "agent",
    ).group_by(schema.Agent.name).all()

    return {name: count for name, count in results}
