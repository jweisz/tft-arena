import json
from typing import Dict, Any, List
from langchain_core.messages import HumanMessage, SystemMessage
from ..state import ArenaState
from ...core.llm import get_llm

# Turns replenished to each agent's budget when the user sends a message
BUDGET_REPLENISH_AMOUNT = 5
# Minimum score (0-10) for an agent to participate in a turn
PARTICIPATION_THRESHOLD = 3.0

async def eval_speaker_importance(messages: List[Any], agents: List[Dict[str, Any]]) -> Dict[str, float]:
    """
    Uses a fast LLM to rank the relevance of each agent to the current conversation.
    Returns a mapping of agent_name -> score (0-10).
    """
    if not agents: return {}
    
    # Context window: Use the last 5 messages to provide thematic flow.
    recent_msgs = messages[-5:]
    history_context = "\n".join([
        f"- {m.type.upper()}: {str(m.content)[:300]}" for m in recent_msgs
    ])

    agent_context = "\n".join([f"- {a['name']}: {a['role_description']}" for a in agents])
    
    prompt = f"""
    You are a conversation moderator for an AI Arena.
    Your goal is to ensure a high-quality, focused discussion by selecting the most relevant agents for the next turn.

    CONVERSATION HISTORY (Last 5 messages):
    {history_context}

    AVAILABLE AGENTS:
    {agent_context}

    DISTRIBUTIONAL GOAL:
    - Ideally, mark only the 2-3 most relevant agents with high scores.
    - Be discriminating. Most agents should score low (0-2) unless they have a direct reason to contribute.
    - An agent scores HIGH (10) only if they are directly addressed or their persona perfectly matches the current topic.
    - An agent scores LOW (0-2) if they would only provide "noise" or generic filler.

    SCORING SCALE:
    - 0-2: Irrelevant / Generic listener.
    - 3-5: Tangentially relevant / Can add secondary perspective.
    - 6-8: Strongly relevant / Core to the current thread.
    - 9-10: Perfect thematic match / Directly mentioned.

    Return ONLY a valid JSON object where keys are agent names and values are numerical scores.
    Example: {{"Devil's Advocate": 1.5, "Muse": 8.0}}
    """
    
    try:
        # Use a fast model for routing decisions
        llm = get_llm(provider="openai", model_name="gpt-4o-mini", temperature=0)
        response = await llm.ainvoke([SystemMessage(content=prompt)])
        
        # Clean response text in case of markdown formatting
        raw_content = response.content.strip()
        if raw_content.startswith("```json"):
            raw_content = raw_content[7:-3].strip()
        if raw_content.startswith("{"): # Ensure it's valid JSON start
            scores = json.loads(raw_content)
            return {name: float(score) for name, score in scores.items()}
    except Exception as e:
        print(f"Warning: Speaker importance evaluation failed: {e}")
        
    # Default to a low 'noise floor' on error to prevent flooding.
    return {a["name"]: 1.0 for a in agents}


async def router_node(state: ArenaState) -> Dict[str, Any]:
    """
    1. If emergency_stop is set → halt everything permanently.
    2. If interrupted → abort current turn, reset flag, re-evaluate.
    3. Replenish budgets when last message is from human.
    4. Select agents with remaining budget to speak.
    5. Set status to 'Thinking' for all agents being considered.
    6. [NEW] Score importance and sort next_speakers by relevance.
    7. [NEW] Filter agents below PARTICIPATION_THRESHOLD.
    """
    messages = state["messages"]
    active_agents = state["active_agents"]
    agent_budgets: Dict[str, int] = dict(state.get("agent_budgets", {}))
    agent_statuses: Dict[str, str] = dict(state.get("agent_statuses", {}))
    agent_scores: Dict[str, float] = {}
    turn = state.get("turn_number", 0)

    # --- Initialize for any new agents ---
    for agent in active_agents:
        if agent["name"] not in agent_budgets:
            agent_budgets[agent["name"]] = agent["token_budget"]
        if agent["name"] not in agent_statuses:
            agent_statuses[agent["name"]] = "Idle"

    # --- Emergency Stop ---
    if state.get("emergency_stop", False):
        for name in agent_statuses: agent_statuses[name] = "Idle"
        return {
            "next_speakers": [], 
            "agent_budgets": agent_budgets, 
            "agent_statuses": agent_statuses,
            "agent_scores": {}
        }

    # --- Interruption ---
    if state.get("interrupted", False):
        for name in agent_statuses: agent_statuses[name] = "Idle"
        return {
            "next_speakers": [], 
            "interrupted": False, 
            "agent_budgets": agent_budgets, 
            "agent_statuses": agent_statuses,
            "agent_scores": {}
        }

    if not messages:
        return {"next_speakers": [], "agent_budgets": agent_budgets, "agent_statuses": agent_statuses, "agent_scores": {}}

    last_msg = messages[-1]
    next_speakers = []

    if last_msg.type == "human":
        # Replenish budgets when last message is from human
        for agent in active_agents:
            agent_budgets[agent["name"]] = min(
                agent_budgets.get(agent["name"], 0) + BUDGET_REPLENISH_AMOUNT,
                agent["token_budget"]
            )
        
        # --- Handle @Mention Override ---
        mentions = state.get("mentions", [])
        if mentions:
            # Check which mentioned agents are active
            active_mentioned = [name for name in mentions if any(a["name"] == name for a in active_agents)]
            if active_mentioned:
                next_speakers = active_mentioned
                # Ensure each has at least 1 turn for the direct response
                # and turn off thinking status for non-mentioned
                for agent in active_agents:
                    if agent["name"] in active_mentioned:
                        agent_budgets[agent["name"]] = max(agent_budgets.get(agent["name"], 0), 1)
                        agent_statuses[agent["name"]] = "Thinking"
                        agent_scores[agent["name"]] = 10.0 # Perfect relevance for direct mentions
                    else:
                        agent_statuses[agent["name"]] = "Idle"
                        agent_scores[agent["name"]] = 0.0
                
                return {
                    "next_speakers": next_speakers,
                    "agent_budgets": agent_budgets,
                    "agent_statuses": agent_statuses,
                    "agent_scores": agent_scores,
                    "turn_number": turn + 1,
                    "mentions": [] # Clear for next turn
                }

        # Standard selection logic (Legacy-ish but now with Intelligence)
        candidates = []
        for agent in active_agents:
            if agent_budgets.get(agent["name"], 0) > 0:
                candidates.append(agent)

        if not candidates:
            return {"next_speakers": [], "agent_budgets": agent_budgets, "agent_statuses": agent_statuses, "agent_scores": {}}

        # --- Evaluate Importance and Sort ---
        scores = await eval_speaker_importance(messages, candidates)
        agent_scores = scores
        
        # Sort candidates by score descending
        sorted_candidates = sorted(candidates, key=lambda a: scores.get(a["name"], 0), reverse=True)
        
        # Filter: If an agent's score is too low, skip them
        next_speakers = [
            a["name"] for a in sorted_candidates 
            if scores.get(a["name"], 0) >= PARTICIPATION_THRESHOLD
        ]
        
        for name in next_speakers:
            agent_statuses[name] = "Thinking"
        for agent in active_agents:
            if agent["name"] not in next_speakers:
                agent_statuses[agent["name"]] = "Idle"
    else:
        # If last message was from an agent, others might still be Idle or Thinking
        pass

    return {
        "next_speakers": next_speakers,
        "agent_budgets": agent_budgets,
        "agent_statuses": agent_statuses,
        "agent_scores": agent_scores,
        "turn_number": turn + 1,
    }
