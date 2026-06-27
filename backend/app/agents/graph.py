from langgraph.graph import StateGraph, END
from langgraph.types import Send
from .state import ArenaState
from .nodes.router import router_node
from .nodes.agent import agent_node


def orchestrate_next_speakers(state: ArenaState):
    speakers = state.get("next_speakers", [])
    if not speakers:
        return END

    sends = []
    for name in speakers:
        agent_config = next(
            (a for a in state["active_agents"] if a["name"] == name), None
        )
        if agent_config:
            sends.append(
                Send(
                    "agent_node",
                    {
                        "messages": state["messages"],
                        "current_agent": agent_config,
                        # Forward all fields the agent_node needs
                        "emergency_stop": state.get("emergency_stop", False),
                        "agent_budgets": state.get("agent_budgets", {}),
                        "turn_number": state.get("turn_number", 0),
                        "room_id": state.get("room_id", 0),
                        "global_instruction": state.get("global_instruction", ""),
                        # These are required by ArenaState but not used by agent_node
                        "active_agents": state.get("active_agents", []),
                        "next_speakers": [],
                        "interrupted": False,
                        "telemetry": [],
                    },
                )
            )
    return sends


def build_graph():
    builder = StateGraph(ArenaState)

    builder.add_node("router", router_node)
    builder.add_node("agent_node", agent_node)

    builder.set_entry_point("router")

    builder.add_conditional_edges(
        "router", orchestrate_next_speakers, ["agent_node", END]
    )

    # Return to router to allow for autonomous agent-to-agent interactions
    builder.add_edge("agent_node", "router")

    return builder.compile()
