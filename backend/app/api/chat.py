"""WebSocket chat transport for room-based arena discussions."""

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from .control import clear_turn_task, register_turn_task
from ..agents.graph import build_graph
from ..core.route_policy import AccessPolicy, get_ws_policy
from ..core.security import resolve_websocket_auth_context
from ..core.websockets import manager
from ..core.llm import get_non_agent_model_config
from ..models import schema
from ..models.db import get_db
from ..services.chat_runtime import (
    broadcast_inference_status,
    broadcast_turn_completion,
    build_initial_state,
    get_activity_stats,
    handle_graph_event,
    load_agents,
    load_settings,
    persist_human_message,
    sync_loaded_processes,
    schedule_semantic_update,
)

router = APIRouter(prefix="/api/chat", tags=["Chat"])
graph = build_graph()


async def _run_turn(
    *,
    room_id: int,
    db: Session,
    initial_state: dict[str, Any],
    active_agents: list[dict[str, Any]],
    agent_budgets: dict[str, int],
    inference_processes: dict[str, dict[str, Any]],
) -> None:
    # Accumulate streamed content per agent for persistence
    agent_outputs: dict[str, str] = {}
    latest_telemetry: list[dict[str, Any]] = []
    stream_runtime: dict[str, dict[str, float]] = {}

    async for event in graph.astream_events(initial_state, version="v2"):
        telemetry = await handle_graph_event(
            event=event,
            room_id=room_id,
            db=db,
            active_agents=active_agents,
            initial_state=initial_state,
            agent_budgets=agent_budgets,
            agent_outputs=agent_outputs,
            inference_processes=inference_processes,
            stream_runtime=stream_runtime,
        )
        if telemetry:
            latest_telemetry = telemetry

    await broadcast_turn_completion(room_id, db, latest_telemetry, agent_budgets)
    await schedule_semantic_update(room_id, db, inference_processes=inference_processes)


@router.websocket("/{room_id}/stream")
async def websocket_endpoint(
    websocket: WebSocket, room_id: int, db: Session = Depends(get_db)
):
    ws_policy = get_ws_policy(websocket.url.path)
    auth_context = resolve_websocket_auth_context(websocket)
    if ws_policy == AccessPolicy.AUTHENTICATED and not auth_context.is_authenticated:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    await manager.connect(websocket, room_id)
    agent_budgets: dict = {}  # persists across turns in this connection
    inference_processes: dict[str, dict[str, Any]] = {}

    # Initial activity stats
    await manager.send_json_to_room({
        "type": "activity_stats",
        "stats": get_activity_stats(room_id, db)
    }, room_id)

    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    initial_default_budget, _ = load_settings(db)
    initial_agents = load_agents(room, db, default_budget=initial_default_budget)
    non_agent_provider, non_agent_model = get_non_agent_model_config()
    inference_processes = sync_loaded_processes(
        active_agents=initial_agents,
        non_agent_provider=non_agent_provider,
        non_agent_model=non_agent_model,
        existing=inference_processes,
    )
    await broadcast_inference_status(room_id, inference_processes)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await manager.send_json_to_room({"type": "error", "error": "Invalid message payload"}, room_id)
                continue

            user_text = payload.get("text", "").strip()
            if not user_text:
                continue

            # Reload global settings for latest budget and system instructions
            current_default_budget, current_global_instruction = load_settings(db)

            room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
            active_agents = load_agents(room, db, default_budget=current_default_budget)
            non_agent_provider, non_agent_model = get_non_agent_model_config()
            inference_processes = sync_loaded_processes(
                active_agents=active_agents,
                non_agent_provider=non_agent_provider,
                non_agent_model=non_agent_model,
                existing=inference_processes,
            )
            await broadcast_inference_status(room_id, inference_processes)

            persist_human_message(db, room_id, user_text)

            initial_state = build_initial_state(
                room_id=room_id,
                user_text=user_text,
                mentions=payload.get("mentions", []),
                active_agents=active_agents,
                agent_budgets=agent_budgets,
                global_instruction=current_global_instruction,
                auth_context=auth_context.to_state_payload(),
            )

            try:
                turn_task = asyncio.create_task(
                    _run_turn(
                        room_id=room_id,
                        db=db,
                        initial_state=initial_state,
                        active_agents=active_agents,
                        agent_budgets=agent_budgets,
                        inference_processes=inference_processes,
                    )
                )
                register_turn_task(room_id, turn_task)
                await turn_task

            except asyncio.CancelledError:
                await manager.send_json_to_room({"type": "interrupted"}, room_id)
            except Exception as exc:
                await manager.send_json_to_room({"type": "error", "error": str(exc)}, room_id)
            finally:
                clear_turn_task(room_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)

