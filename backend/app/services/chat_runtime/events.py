"""Graph event handling and websocket turn-completion helpers."""

from typing import Any

from sqlalchemy.orm import Session

from ...core.websockets import manager
from ...core.utils import sanitize_agent_content
from .persistence import persist_agent_messages
from .queries import get_activity_stats


async def broadcast_turn_completion(
    room_id: int,
    db: Session,
    telemetry: list[dict[str, Any]],
    agent_budgets: dict[str, int],
) -> None:
    if telemetry:
        await manager.send_json_to_room({
            "type": "telemetry",
            "data": telemetry,
            "budgets": agent_budgets,
        }, room_id)

        await manager.send_json_to_room({
            "type": "activity_stats",
            "stats": get_activity_stats(room_id, db),
        }, room_id)

    await manager.send_json_to_room({"type": "done"}, room_id)


async def handle_graph_event(
    event: dict[str, Any],
    room_id: int,
    db: Session,
    active_agents: list[dict[str, Any]],
    initial_state: dict[str, Any],
    agent_budgets: dict[str, int],
    agent_outputs: dict[str, str],
) -> list[dict[str, Any]]:
    kind = event.get("event")
    node_name = event.get("name", "")

    if kind in ("on_node_start", "on_chain_start") and node_name == "router":
        await manager.send_json_to_room({
            "type": "status_update",
            "statuses": {agent["name"]: "Thinking" for agent in initial_state["active_agents"]},
        }, room_id)
        return []

    if kind in ("on_node_end", "on_chain_end"):
        final_output = event.get("data", {}).get("output", {})
        if node_name == "router" and final_output and "agent_statuses" in final_output:
            await manager.send_json_to_room({
                "type": "status_update",
                "statuses": final_output["agent_statuses"],
                "scores": final_output.get("agent_scores", {}),
                "reasons": final_output.get("agent_reasons", {}),
                "emojis": {agent["name"]: agent["emoji"] for agent in active_agents},
            }, room_id)
            return []

        if node_name.startswith("agent_node") and final_output:
            agent_budgets.update(final_output.get("agent_budgets", {}))
            telemetry = final_output.get("telemetry", [])
            for telemetry_entry in telemetry:
                agent_name = telemetry_entry["agent_name"]
                final_content = sanitize_agent_content(agent_outputs.get(agent_name, ""), agent_name)
                await manager.send_json_to_room({
                    "type": "agent_message_done",
                    "agent": agent_name,
                    "content": final_content,
                }, room_id)
            persist_agent_messages(db, room_id, telemetry, agent_outputs)
            return telemetry

    if kind == "on_chat_model_stream":
        chunk = event["data"]["chunk"]
        token = chunk.content if hasattr(chunk, "content") else str(chunk)
        agent_name = (
            event.get("metadata", {}).get("agent_name")
            or event.get("metadata", {}).get("langgraph_node", "agent")
        )
        agent_outputs[agent_name] = agent_outputs.get(agent_name, "") + token
        await manager.send_json_to_room({
            "type": "token",
            "agent": agent_name,
            "token": token,
        }, room_id)

    return []