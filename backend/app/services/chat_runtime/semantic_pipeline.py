"""Semantic agent pipeline utilities for websocket chat."""

import asyncio

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.orm import Session

from ...agents.nodes.semantic import run_semantic_agent
from ...core.websockets import manager
from ...models import schema


def load_semantic_messages(db: Session, room_id: int, limit: int = 12):
    messages = (
        db.query(schema.Message)
        .filter(schema.Message.room_id == room_id)
        .order_by(schema.Message.id.desc())
        .limit(limit)
        .all()
    )

    semantic_messages = []
    for message in reversed(messages):
        if message.role == "human":
            semantic_messages.append(HumanMessage(content=message.content))
        elif message.role == "agent":
            semantic_messages.append(
                AIMessage(
                    content=message.content,
                    name=message.agent.name if message.agent else "agent",
                )
            )
        elif message.role == "system":
            semantic_messages.append(SystemMessage(content=message.content))

    return semantic_messages


async def send_semantic_update(room_id: int, semantic_messages) -> None:
    try:
        sem_result = await run_semantic_agent(semantic_messages)
        await manager.send_json_to_room({
            "type": "semantic",
            "annotations": sem_result.get("annotations", []),
            "scratchpad": sem_result.get("scratchpad", {}),
        }, room_id)
    except Exception as exc:  # pragma: no cover - defensive transport guard
        print(f"Semantic agent failed: {exc}")


async def schedule_semantic_update(room_id: int, db: Session) -> None:
    semantic_messages = load_semantic_messages(db, room_id)
    asyncio.create_task(send_semantic_update(room_id, semantic_messages))