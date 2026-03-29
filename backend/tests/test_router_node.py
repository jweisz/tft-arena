from langchain_core.messages import HumanMessage

from app.agents.nodes import router as router_module
from app.services.prompt_loader import prompt_loader


class BrokenRouterLLM:
    async def ainvoke(self, _messages):
        class Response:
            content = "not valid json"

        return Response()


def test_prompt_loader_exposes_relevance_instructions_for_presets():
    presets = {preset["name"]: preset for preset in prompt_loader.list_prompts()}

    muse = presets["Muse"]
    assert muse["role_description"]
    assert muse["system_prompt"]
    assert "creative options" in muse["relevance_instructions"].lower()


async def test_router_heuristic_fallback_avoids_first_agent_bias(monkeypatch):
    monkeypatch.setattr(router_module, "get_llm", lambda provider, model_name, temperature=0: BrokenRouterLLM())

    state = {
        "messages": [HumanMessage(content="I need creative directions and naming ideas for this concept.")],
        "active_agents": [
            {
                "id": 1,
                "name": "Logos Architect",
                "role_description": "Strengthens logical structure and evidence.",
                "relevance_instructions": "Respond to logic, evidence, argument quality, and proof.",
                "system_prompt": "stub",
                "emoji": "⚖️",
                "model": "gpt-4o-mini",
                "provider": "openai",
                "token_budget": 3,
            },
            {
                "id": 2,
                "name": "Muse",
                "role_description": "Generates creative directions and expansive possibilities.",
                "relevance_instructions": "Respond to ideation, naming, creative options, and inspiration.",
                "system_prompt": "stub",
                "emoji": "💡",
                "model": "gpt-4o-mini",
                "provider": "openai",
                "token_budget": 3,
            },
        ],
        "agent_budgets": {},
        "agent_statuses": {},
        "next_speakers": [],
        "interrupted": False,
        "emergency_stop": False,
        "telemetry": [],
        "mentions": [],
        "agent_scores": {},
        "agent_reasons": {},
        "room_id": 1,
        "turn_number": 0,
        "global_instruction": "",
    }

    result = await router_module.router_node(state)

    assert result["next_speakers"] == ["Muse"]
    assert result["agent_scores"]["Muse"] > result["agent_scores"]["Logos Architect"]
    assert result["agent_scores"]["Logos Architect"] < router_module.PARTICIPATION_THRESHOLD
