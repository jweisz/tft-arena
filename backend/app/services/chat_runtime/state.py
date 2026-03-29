"""State construction helpers for graph execution."""

from typing import Any

from langchain_core.messages import HumanMessage

from ...api.control import emergency_flags


def build_initial_state(
    room_id: int,
    user_text: str,
    mentions: list[str],
    active_agents: list[dict[str, Any]],
    agent_budgets: dict[str, int],
    global_instruction: str,
    auth_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    state = {
        "messages": [HumanMessage(content=user_text)],
        "active_agents": active_agents,
        "agent_budgets": agent_budgets,
        "next_speakers": [],
        "interrupted": False,
        "emergency_stop": emergency_flags.get(room_id, False),
        "telemetry": [],
        "room_id": room_id,
        "turn_number": 0,
        "global_instruction": global_instruction,
        "mentions": mentions,
    }

    if auth_context is not None:
        state["auth_context"] = auth_context

    return state