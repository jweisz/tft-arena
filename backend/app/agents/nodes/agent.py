import time
import asyncio
from typing import Dict, Any
from langchain_core.messages import SystemMessage, AIMessage
from ...core.llm import get_llm
from ..state import TelemetryEntry
from ..context import maybe_summarize
from ..memory import retrieve_agent_memories, retrieve_user_profile, store_agent_memory

async def agent_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes a single agent's inference with sequential speaking enforcement.
    """
    if state.get("emergency_stop", False):
        return {}

    from ...core.locks import lock_manager
    from ...core.websockets import manager
    
    agent = state["current_agent"]
    room_id = state.get("room_id", 0)
    messages = list(state["messages"])
    agent_budgets: Dict[str, int] = dict(state.get("agent_budgets", {}))
    turn = state.get("turn_number", 0)
    last_msg = messages[-1] if messages else None

    # Scoped lock prevents multiple agents from 'Speaking' simultaneously in the same room.
    room_lock = lock_manager.get_lock(room_id)
    
    try:
        # Check if another agent is already speaking
        if room_lock.locked():
            await manager.send_json_to_room({
                "type": "status_update",
                "statuses": {agent["name"]: "Queued"}
            }, room_id)
        
        async with room_lock:
            # Acquire speaking status
            await manager.send_json_to_room({
                "type": "status_update",
                "statuses": {agent["name"]: "Speaking"}
            }, room_id)
            
            # --- Context Window Eviction and Memory Retrieval ---
            evicted_messages, memories_prefix, profile_prefix = await _prepare_context(messages, agent, room_id)

            # Build enriched system prompt (Sandwich Technique)
            global_instr = state.get("global_instruction", "")
            system_parts = []
            
            if global_instr:
                system_parts.append(f"MISSION CONSTRAINT:\n{global_instr}")
                
            system_parts.append(
                f"ROLE PROFILE:\n{agent['role_description']}\n\n"
                f"PERSONA INSTRUCTION:\n{agent['system_prompt']}\n\n"
                f"CORE CHAT PROTOCOL:\n"
                f"- DO NOT prefix your response with your name or any label (e.g., '{agent['name']}:').\n"
                f"- Start your response directly with the content of your message.\n"
                f"- Maintain your assigned persona without explicitly stating it."
            )
            
            if global_instr:
                system_parts.append(f"FINAL REMINDER:\n{global_instr}")
                
            if profile_prefix:
                system_parts.append(f"USER BACKGROUND:\n{profile_prefix}")
            if memories_prefix:
                system_parts.append(f"PAST CONVERSATION MEMORIES:\n{memories_prefix}")

            system_msg = SystemMessage(content="\n\n".join(system_parts))
            llm = get_llm(provider=agent["provider"], model_name=agent["model"])

            start = time.perf_counter()
            response = await llm.ainvoke(
                [system_msg] + evicted_messages,
                config={"metadata": {"agent_name": agent["name"]}}
            )
            elapsed_ms = (time.perf_counter() - start) * 1000
            
    except Exception as e:
        print(f"Error in agent_node for {agent['name']}: {e}")
        return {} # Early exit, finally will reset status
    finally:
        # Reset live status to Idle (UI)
        await manager.send_json_to_room({
            "type": "status_update",
            "statuses": {agent["name"]: "Idle"}
        }, room_id)

    # --- BELOW TASKS RUN OUTSIDE THE ROOM LOCK TO AVOID HANGS ---
    try:
        tokens_used = getattr(response, "usage_metadata", {}) or {}
        tokens_used = tokens_used.get("output_tokens", len(response.content.split()))

        # Deduct 1 TURN from budget
        current_budget = agent_budgets.get(agent["name"], 0)
        new_budgets = {**agent_budgets, agent["name"]: max(0, current_budget - 1)}
        
        # Broadcast budget update immediately
        await manager.send_json_to_room({
            "type": "budget_update",
            "budgets": new_budgets
        }, room_id)

        ai_msg = AIMessage(content=response.content, name=agent["name"])

        telemetry_entry: TelemetryEntry = {
            "agent_name": agent["name"],
            "tokens_used": tokens_used,
            "latency_ms": round(elapsed_ms, 1),
            "turn": turn,
        }

        # Background: store memory
        try:
            await store_agent_memory(room_id, agent["name"], response.content[:500])
        except Exception:
            pass

        return {
            "messages": [ai_msg],
            "agent_budgets": new_budgets,
            "agent_statuses": {agent["name"]: "Idle"},
            "telemetry": [telemetry_entry],
        }
    except Exception as e:
        print(f"Error in post-inference tasks for {agent['name']}: {e}")
        return {}


async def _prepare_context(messages, agent, room_id):
    """Runs context eviction and memory retrieval concurrently."""
    last_human = next((m.content for m in reversed(messages) if m.type == "human"), "")

    evicted_messages, _ = await maybe_summarize(messages)
    memories, profile = await asyncio.gather(
        retrieve_agent_memories(room_id, agent["name"], last_human),
        retrieve_user_profile(),
    )
    return evicted_messages, memories, profile
