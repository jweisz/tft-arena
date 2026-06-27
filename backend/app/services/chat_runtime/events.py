"""Graph event handling and websocket turn-completion helpers."""

import re
import time
from typing import Any

from sqlalchemy.orm import Session

from ...core.websockets import manager
from ...core.utils import sanitize_agent_content
from .inference import compute_tokens_per_second, ordered_processes, set_process_runtime
from .persistence import persist_agent_messages
from .queries import get_activity_stats


def _estimate_chunk_tokens(raw_chunk: str) -> int:
    """Estimate token count for streamed chunks when provider token metadata is absent."""
    if not raw_chunk:
        return 0
    return max(1, len(re.findall(r"[A-Za-z0-9']+", raw_chunk)))


async def broadcast_inference_status(
    room_id: int, processes: dict[str, dict[str, Any]]
) -> None:
    await manager.send_json_to_room(
        {
            "type": "inference_status",
            "processes": ordered_processes(processes),
        },
        room_id,
    )


async def broadcast_turn_completion(
    room_id: int,
    db: Session,
    telemetry: list[dict[str, Any]],
    agent_budgets: dict[str, int],
) -> None:
    if telemetry:
        await manager.send_json_to_room(
            {
                "type": "telemetry",
                "data": telemetry,
                "budgets": agent_budgets,
            },
            room_id,
        )

        await manager.send_json_to_room(
            {
                "type": "activity_stats",
                "stats": get_activity_stats(room_id, db),
            },
            room_id,
        )

    await manager.send_json_to_room({"type": "done"}, room_id)


async def handle_graph_event(
    event: dict[str, Any],
    room_id: int,
    db: Session,
    active_agents: list[dict[str, Any]],
    initial_state: dict[str, Any],
    agent_budgets: dict[str, int],
    agent_outputs: dict[str, str],
    inference_processes: dict[str, dict[str, Any]],
    stream_runtime: dict[str, dict[str, float]],
) -> list[dict[str, Any]]:
    kind = event.get("event")
    node_name = event.get("name", "")

    if kind in ("on_node_start", "on_chain_start") and node_name == "router":
        set_process_runtime(
            inference_processes, "router", active=True, tokens_per_sec=None
        )
        await broadcast_inference_status(room_id, inference_processes)
        statuses: dict[str, str] = {}
        for agent in initial_state["active_agents"]:
            remaining_budget = agent_budgets.get(
                agent["name"], agent.get("token_budget", 0)
            )
            statuses[agent["name"]] = "Thinking" if remaining_budget > 0 else "Idle"
        await manager.send_json_to_room(
            {
                "type": "status_update",
                "statuses": statuses,
            },
            room_id,
        )
        return []

    if kind in ("on_node_start", "on_chain_start") and node_name.startswith(
        "agent_node"
    ):
        agent_name = (
            event.get("data", {}).get("input", {}).get("current_agent", {}).get("name")
        )
        if agent_name:
            # Agent nodes can be scheduled concurrently, but speaking is serialized by a room lock.
            # Only mark one agent as active during warm-up to avoid UI showing the wrong speaker.
            active_agent_exists = any(
                p.get("process_kind") == "agent" and p.get("active")
                for p in inference_processes.values()
            )
            if not active_agent_exists:
                set_process_runtime(
                    inference_processes,
                    f"agent:{agent_name}",
                    active=True,
                    tokens_per_sec=None,
                )
                await broadcast_inference_status(room_id, inference_processes)
        return []

    if kind in ("on_node_end", "on_chain_end"):
        final_output = event.get("data", {}).get("output", {})
        if node_name == "router" and final_output and "agent_statuses" in final_output:
            runtime = final_output.get("router_runtime", {})
            refreshed_budgets = final_output.get("agent_budgets", {})
            if refreshed_budgets:
                agent_budgets.update(refreshed_budgets)
            set_process_runtime(
                inference_processes,
                "router",
                active=False,
                tokens_per_sec=compute_tokens_per_second(
                    runtime.get("tokens_used"),
                    runtime.get("latency_ms"),
                ),
            )
            await broadcast_inference_status(room_id, inference_processes)
            await manager.send_json_to_room(
                {
                    "type": "status_update",
                    "statuses": final_output["agent_statuses"],
                    "scores": final_output.get("agent_scores", {}),
                    "reasons": final_output.get("agent_reasons", {}),
                    "emojis": {
                        agent["name"]: agent["emoji"] for agent in active_agents
                    },
                },
                room_id,
            )
            if refreshed_budgets:
                await manager.send_json_to_room(
                    {
                        "type": "budget_update",
                        "budgets": refreshed_budgets,
                    },
                    room_id,
                )
            return []

        if node_name.startswith("agent_node") and final_output:
            agent_budgets.update(final_output.get("agent_budgets", {}))
            telemetry = final_output.get("telemetry", [])
            for telemetry_entry in telemetry:
                agent_name = telemetry_entry["agent_name"]
                process_id = f"agent:{agent_name}"
                set_process_runtime(
                    inference_processes,
                    process_id,
                    active=False,
                    tokens_per_sec=compute_tokens_per_second(
                        telemetry_entry.get("tokens_used"),
                        telemetry_entry.get("latency_ms"),
                    ),
                )
                stream_runtime.pop(process_id, None)
                final_content = sanitize_agent_content(
                    agent_outputs.get(agent_name, ""), agent_name
                )
                await manager.send_json_to_room(
                    {
                        "type": "agent_message_done",
                        "agent": agent_name,
                        "content": final_content,
                    },
                    room_id,
                )
            await broadcast_inference_status(room_id, inference_processes)
            persist_agent_messages(db, room_id, telemetry, agent_outputs)
            return telemetry

    if kind == "on_chat_model_stream":
        chunk = event["data"]["chunk"]
        token = chunk.content if hasattr(chunk, "content") else str(chunk)
        agent_name = event.get("metadata", {}).get("agent_name")
        if not agent_name:
            # Ignore internal node streams (for example router scoring traces)
            # unless they are explicitly tagged with a real agent name.
            return []

        active_agent_names = {agent["name"] for agent in active_agents}
        if agent_name not in active_agent_names:
            return []

        process_id = f"agent:{agent_name}"
        runtime_state = stream_runtime.setdefault(
            process_id,
            {
                "start_time": time.perf_counter(),
                "tokens": 0.0,
                "last_emit": 0.0,
            },
        )
        runtime_state["tokens"] += _estimate_chunk_tokens(token)

        elapsed = time.perf_counter() - runtime_state["start_time"]
        tps = round(runtime_state["tokens"] / elapsed, 2) if elapsed > 0 else None
        now = time.perf_counter()

        if now - runtime_state["last_emit"] >= 0.2:
            # The currently streaming agent should be the only active agent process.
            for candidate_process_id, process in inference_processes.items():
                if (
                    process.get("process_kind") == "agent"
                    and candidate_process_id != process_id
                ):
                    set_process_runtime(
                        inference_processes,
                        candidate_process_id,
                        active=False,
                        tokens_per_sec=process.get("tokens_per_sec"),
                    )
            set_process_runtime(
                inference_processes, process_id, active=True, tokens_per_sec=tps
            )
            await broadcast_inference_status(room_id, inference_processes)
            runtime_state["last_emit"] = now

        agent_outputs[agent_name] = agent_outputs.get(agent_name, "") + token
        await manager.send_json_to_room(
            {
                "type": "token",
                "agent": agent_name,
                "token": token,
            },
            room_id,
        )

    return []
