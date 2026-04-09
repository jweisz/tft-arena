"""Semantic agent pipeline utilities for websocket chat."""

import asyncio
import json
import time
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.orm import Session

from ...agents.nodes.semantic import run_semantic_agent
from ...core.websockets import manager
from ...models import schema
from .inference import compute_tokens_per_second, ordered_processes, set_process_runtime


_semantic_tasks: dict[int, asyncio.Task[None]] = {}


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

async def send_semantic_update(
    room_id: int,
    semantic_messages,
    inference_processes: dict[str, dict[str, Any]] | None = None,
) -> None:
    if inference_processes is not None:
        set_process_runtime(inference_processes, "semantic", active=True, tokens_per_sec=None)
        await manager.send_json_to_room({
            "type": "inference_status",
            "processes": ordered_processes(inference_processes),
        }, room_id)

    try:
        started = time.perf_counter()
        sem_result = await run_semantic_agent(semantic_messages)
        latency_ms = (time.perf_counter() - started) * 1000
        estimated_tokens = len(json.dumps(sem_result).split())

        if inference_processes is not None:
            set_process_runtime(
                inference_processes,
                "semantic",
                active=False,
                tokens_per_sec=compute_tokens_per_second(estimated_tokens, latency_ms),
            )
            await manager.send_json_to_room({
                "type": "inference_status",
                "processes": ordered_processes(inference_processes),
            }, room_id)

        await manager.send_json_to_room({
            "type": "semantic",
            "annotations": sem_result.get("annotations", []),
            "scratchpad": sem_result.get("scratchpad", {}),
        }, room_id)
    except Exception as exc:  # pragma: no cover - defensive transport guard
        if inference_processes is not None:
            set_process_runtime(inference_processes, "semantic", active=False, tokens_per_sec=None)
            await manager.send_json_to_room({
                "type": "inference_status",
                "processes": ordered_processes(inference_processes),
            }, room_id)
        print(f"Semantic agent failed: {exc}")


async def schedule_semantic_update(
    room_id: int,
    db: Session,
    inference_processes: dict[str, dict[str, Any]] | None = None,
) -> None:
    semantic_messages = load_semantic_messages(db, room_id)
    existing = _semantic_tasks.get(room_id)
    if existing and not existing.done():
        existing.cancel()

    task = asyncio.create_task(send_semantic_update(room_id, semantic_messages, inference_processes=inference_processes))
    _semantic_tasks[room_id] = task

    def _cleanup(done_task: asyncio.Task[None]) -> None:
        current = _semantic_tasks.get(room_id)
        if current is done_task:
            _semantic_tasks.pop(room_id, None)

    task.add_done_callback(_cleanup)
