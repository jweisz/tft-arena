"""Persistence helpers for chat runtime messages."""

from sqlalchemy.orm import Session

from ...core.utils import sanitize_agent_content
from ...models import schema


def persist_human_message(db: Session, room_id: int, user_text: str) -> None:
    db.add(schema.Message(room_id=room_id, role="human", content=user_text))
    db.commit()


def persist_agent_messages(
    db: Session,
    room_id: int,
    telemetry: list[dict],
    agent_outputs: dict[str, str],
) -> None:
    if not telemetry:
        return

    agent_names = [entry["agent_name"] for entry in telemetry]
    agents = db.query(schema.Agent).filter(schema.Agent.name.in_(agent_names)).all()
    agents_by_name = {agent.name: agent for agent in agents}

    message_records: list[schema.Message] = []
    for telemetry_entry in telemetry:
        agent_name = telemetry_entry["agent_name"]
        raw_content = agent_outputs.get(agent_name, "")
        content = sanitize_agent_content(raw_content, agent_name)
        if not content.strip():
            continue

        agent_db = agents_by_name.get(agent_name)
        message_records.append(
            schema.Message(
                room_id=room_id,
                role="agent",
                content=content,
                agent_id=agent_db.id if agent_db else None,
                tokens_used=telemetry_entry.get("tokens_used", 0),
                latency_ms=telemetry_entry.get("latency_ms", 0.0),
            )
        )
        agent_outputs[agent_name] = ""

    if message_records:
        db.add_all(message_records)
        db.commit()
