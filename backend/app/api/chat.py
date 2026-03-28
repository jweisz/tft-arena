"""
Improved chat WebSocket endpoint:
- Loads room agents from DB on each connection
- Streams per-token events via astream_events
- Broadcasts structured JSON events (token | done | telemetry | error)
- Respects emergency_stop and interrupted flags
"""
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
from langchain_core.messages import HumanMessage
from ..models import schema
from ..models.db import get_db
from ..core.websockets import manager
from ..agents.graph import build_graph
from ..api.control import emergency_flags
from ..agents.nodes.semantic import run_semantic_agent

router = APIRouter(prefix="/api/chat", tags=["Chat"])
graph = build_graph()


def _load_agents(room, db, default_budget: int = 3) -> list:
    if not room:
        return []
    
    # Query active mappings for this room
    active_mappings = db.query(schema.RoomAgent).filter(
        schema.RoomAgent.room_id == room.id,
        schema.RoomAgent.is_active == True
    ).all()
    active_agent_ids = [m.agent_id for m in active_mappings]
    
    if not active_agent_ids:
        return []
        
    agents = db.query(schema.Agent).filter(schema.Agent.id.in_(active_agent_ids)).all()

    # Budget logic: prioritize agent's specific budget, fallback to global default
    return [
        {
            "id": a.id,
            "name": a.name,
            "role_description": a.role_description,
            "system_prompt": a.system_prompt,
            "model": a.model,
            "provider": a.provider,
            "token_budget": a.token_budget or default_budget,
        }
        for a in agents
    ]

def _get_activity_stats(room_id: int, db: Session) -> dict:
    """Returns total message counts per agent for the room."""
    from sqlalchemy import func
    results = db.query(
        schema.Agent.name, 
        func.count(schema.Message.id)
    ).join(
        schema.Message, schema.Agent.id == schema.Message.agent_id
    ).filter(
        schema.Message.room_id == room_id,
        schema.Message.role == "agent"
    ).group_by(schema.Agent.name).all()
    
    return {name: count for name, count in results}


@router.websocket("/{room_id}/stream")
async def websocket_endpoint(
    websocket: WebSocket, room_id: int, db: Session = Depends(get_db)
):
    await manager.connect(websocket, room_id)
    agent_budgets: dict = {}  # persists across turns in this connection

    # Load global settings for default budget and system instructions
    settings = db.query(schema.GlobalSettings).first()
    default_budget = settings.default_agent_turn_budget if settings else 3
    global_instruction = settings.global_system_instruction if settings else ""

    # Initial activity stats
    await manager.send_json_to_room({
        "type": "activity_stats",
        "stats": _get_activity_stats(room_id, db)
    }, room_id)

    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)
            user_text = payload.get("text", "").strip()
            if not user_text:
                continue

            # Reload global settings for latest budget and system instructions
            settings = db.query(schema.GlobalSettings).first()
            current_default_budget = settings.default_agent_turn_budget if settings else 3
            current_global_instruction = settings.global_system_instruction if settings else ""

            room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
            active_agents = _load_agents(room, db, default_budget=current_default_budget)

            # --- Persist human message ---
            human_msg_record = schema.Message(
                room_id=room_id, role="human", content=user_text
            )
            db.add(human_msg_record)
            db.commit()

            initial_state = {
                "messages": [HumanMessage(content=user_text)],
                "active_agents": active_agents,
                "agent_budgets": agent_budgets,
                "next_speakers": [],
                "interrupted": False,
                "emergency_stop": emergency_flags.get(room_id, False),
                "telemetry": [],
                "room_id": room_id,
                "turn_number": 0,
                "global_instruction": current_global_instruction,
                "mentions": payload.get("mentions", []),
            }

            # Accumulate streamed content per agent for persistence
            agent_outputs: dict[str, str] = {}

            try:
                async for event in graph.astream_events(initial_state, version="v2"):
                    kind = event.get("event")
                    node_name = event.get("name", "")

                    # Handle Status Updates via Node Lifecycle
                    if kind in ("on_node_start", "on_chain_start"):
                        if node_name == "router":
                            await manager.send_json_to_room({
                                "type": "status_update", 
                                "statuses": {a["name"]: "Thinking" for a in initial_state["active_agents"]}
                            }, room_id)
                    
                    if kind in ("on_node_end", "on_chain_end"):
                        if node_name == "router":
                            final_output = event.get("data", {}).get("output", {})
                            if final_output and "agent_statuses" in final_output:
                                await manager.send_json_to_room({
                                    "type": "status_update",
                                    "statuses": final_output["agent_statuses"],
                                    "scores": final_output.get("agent_scores", {})
                                }, room_id)
                        elif node_name.startswith("agent_node"):
                            # Logic for agent_node end (currently handled in agent_node itself)
                            pass

                    if kind == "on_chat_model_stream":
                        chunk = event["data"]["chunk"]
                        token = chunk.content if hasattr(chunk, "content") else str(chunk)
                        agent_name = event.get("metadata", {}).get("agent_name") or event.get("metadata", {}).get("langgraph_node", "agent")
                        agent_outputs[agent_name] = agent_outputs.get(agent_name, "") + token
                        await manager.send_json_to_room({
                            "type": "token",
                            "agent": agent_name,
                            "token": token,
                        }, room_id)

                    elif kind == "on_chain_end" and event.get("name") == "LangGraph":
                        final_output = event.get("data", {}).get("output", {})
                        if final_output:
                            new_budgets = final_output.get("agent_budgets", {})
                            agent_budgets.update(new_budgets)
                            telemetry = final_output.get("telemetry", [])

                            # --- Persist agent messages to DB ---
                            tel_map = {t["agent_name"]: t for t in telemetry}
                            agent_lookup = {a["name"]: a for a in active_agents}
                            for agent_name, content in agent_outputs.items():
                                if content.strip():
                                    tel = tel_map.get(agent_name, {})
                                    agent_db = db.query(schema.Agent).filter(
                                        schema.Agent.name == agent_name
                                    ).first()
                                    db.add(schema.Message(
                                        room_id=room_id,
                                        role="agent",
                                        content=content,
                                        agent_id=agent_db.id if agent_db else None,
                                        tokens_used=tel.get("tokens_used", 0),
                                        latency_ms=tel.get("latency_ms", 0.0),
                                    ))
                            db.commit()
                            agent_outputs = {}

                            await manager.send_json_to_room({
                                "type": "telemetry",
                                "data": telemetry,
                                "budgets": agent_budgets,
                            }, room_id)
                            
                            await manager.send_json_to_room({
                                "type": "activity_stats",
                                "stats": _get_activity_stats(room_id, db)
                            }, room_id)

                await manager.send_json_to_room({"type": "done"}, room_id)

                # Fire semantic agent concurrently (doesn't block the main stream or the 'done' signal)
                async def fire_semantic():
                    try:
                        sem_result = await run_semantic_agent(initial_state["messages"])
                        await manager.send_json_to_room({
                            "type": "semantic",
                            "annotations": sem_result.get("annotations", []),
                            "scratchpad": sem_result.get("scratchpad", {}),
                        }, room_id)
                    except Exception as e:
                        print(f"Semantic agent failed: {e}")

                # Use create_task to run it in the background
                import asyncio
                asyncio.create_task(fire_semantic())

            except asyncio.CancelledError:
                await manager.send_json_to_room({"type": "interrupted"}, room_id)
            except Exception as e:
                await manager.send_json_to_room({"type": "error", "error": str(e)}, room_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)

