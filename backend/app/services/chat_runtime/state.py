"""State construction helpers for graph execution."""

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.orm import Session

from ...api.control import get_emergency_flag
from ...models import schema


def _load_recent_messages(db: Session, room_id: int, limit: int = 20):
    rows = (
        db.query(schema.Message)
        .filter(schema.Message.room_id == room_id)
        .order_by(schema.Message.id.desc())
        .limit(limit)
        .all()
    )

    history = []
    for row in reversed(rows):
        if row.role == "human":
            history.append(HumanMessage(content=row.content))
        elif row.role == "agent":
            history.append(
                AIMessage(
                    content=row.content, name=row.agent.name if row.agent else "agent"
                )
            )
        elif row.role == "system":
            history.append(SystemMessage(content=row.content))
    return history


def build_initial_state(
    room_id: int,
    user_text: str,
    mentions: list[str],
    active_agents: list[dict[str, Any]],
    agent_budgets: dict[str, int],
    global_instruction: str,
    db: Session,
    auth_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    history = _load_recent_messages(db, room_id)
    if not history:
        history = [HumanMessage(content=user_text)]
    elif (
        getattr(history[-1], "type", None) != "human"
        or str(history[-1].content) != user_text
    ):
        history.append(HumanMessage(content=user_text))

    state = {
        "messages": history,
        "active_agents": active_agents,
        "agent_budgets": agent_budgets,
        "next_speakers": [],
        "interrupted": False,
        "emergency_stop": get_emergency_flag(db, room_id),
        "telemetry": [],
        "room_id": room_id,
        "turn_number": 0,
        "global_instruction": global_instruction,
        "mentions": mentions,
    }

    if auth_context is not None:
        state["auth_context"] = auth_context

    return state
