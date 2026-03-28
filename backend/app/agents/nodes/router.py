import json
import re
from typing import Dict, Any, List
from langchain_core.messages import HumanMessage, SystemMessage
from ..state import ArenaState
from ...core.llm import get_llm

# Turns replenished to each agent's budget when the user sends a message
BUDGET_REPLENISH_AMOUNT = 3
# Minimum score (0-10) for an agent to participate in a turn
PARTICIPATION_THRESHOLD = 3.0

async def eval_speaker_importance(messages: List[Any], agents: List[Dict[str, Any]]) -> tuple[Dict[str, float], Dict[str, str]]:
    """
    Uses a fast LLM to rank the relevance of each agent to the current conversation.
    Returns (scores, reasons): both keyed by agent_name.
    scores: 0-10 float, reasons: one-sentence explanation.
    """
    if not agents: return {}, {}
    
    # Context window: Use the last 5 messages to provide thematic flow.
    recent_msgs = messages[-5:]
    history_context = "\n".join([
        f"- {m.type.upper()}: {str(m.content)[:300]}" for m in recent_msgs
    ])

    agent_context = "\n".join([f"- {a['name']}: {a['role_description']}" for a in agents])
    
    prompt = f"""
    You are a conversation moderator for an AI Arena.
    Your goal is to ensure a high-quality discussion by selecting the most relevant agents for the next turn.

    **CRITICAL**: If the human asks a question or makes a statement, SOMEONE must be the best candidate to respond. Do not leave the user hanging unless the message is completely nonsensical.

    CONVERSATION HISTORY (Last 5 messages):
    {history_context}

    AVAILABLE AGENTS:
    {agent_context}

    DISTRIBUTIONAL GOAL:
    - Ideally, mark the 1-3 most relevant agents with high scores.
    - Be discriminating, but don't be afraid to score an agent above 3.0 if they are even moderately helpful.
    - An agent scores HIGH (10) if they are directly addressed or their persona is an expert match.
    - An agent scores LOW (0-2) only if they are clearly irrelevant or would provide noise.

    SCORING SCALE:
    - 0-2: Irrelevant / Generic listener.
    - 3-5: Tangentially relevant / Can add secondary perspective.
    - 6-8: Strongly relevant / Core to the current thread.
    - 9-10: Perfect thematic match / Directly mentioned.

    Return ONLY a valid JSON object with two keys:
    - "scores": object mapping agent names to numerical scores (0-10)
    - "reasons": object mapping agent names to a single short sentence (max 12 words) explaining why they scored that way

    Example:
    {{"scores": {{"Devil's Advocate": 1.5, "Muse": 8.0}}, "reasons": {{"Devil's Advocate": "Topic is factual, not suited to contrarian debate.", "Muse": "Creative framing directly matches the question asked."}}}}
    """
    
    try:
        # Use a fast model for routing decisions
        llm = get_llm(provider="openai", model_name="gpt-4o-mini", temperature=0)
        response = await llm.ainvoke([SystemMessage(content=prompt)])
        
        # Clean response text in case of markdown formatting or filler
        raw_content = response.content.strip()
        
        # Use regex to find the last JSON block in case of conversational filler
        # This handles cases like: "Sure! Here is the JSON: ```json ... ```" or just "```json ... ```"
        match = re.search(r"(\{.*\})", raw_content, re.DOTALL)
        if match:
            json_str = match.group(1)
            parsed = json.loads(json_str)
            scores = {name: float(score) for name, score in parsed.get("scores", {}).items()}
            reasons = {name: str(reason) for name, reason in parsed.get("reasons", {}).items()}
            return scores, reasons
        else:
            print(f"Warning: No JSON match found in router output: {raw_content[:200]}...")
    except Exception as e:
        print(f"Warning: Speaker importance evaluation failed: {e}")
        
    # Default to a low 'noise floor' on error to prevent flooding.
    return {a["name"]: 1.0 for a in agents}, {a["name"]: "Routing evaluation failed." for a in agents}


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
    agent_reasons: Dict[str, str] = {}
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
            "agent_scores": {},
            "agent_reasons": {},
        }

    # --- Interruption ---
    if state.get("interrupted", False):
        for name in agent_statuses: agent_statuses[name] = "Idle"
        return {
            "next_speakers": [], 
            "interrupted": False, 
            "agent_budgets": agent_budgets, 
            "agent_statuses": agent_statuses,
            "agent_scores": {},
            "agent_reasons": {},
        }

    if not messages:
        return {"next_speakers": [], "agent_budgets": agent_budgets, "agent_statuses": agent_statuses, "agent_scores": {}, "agent_reasons": {}}

    last_msg = messages[-1]
    next_speakers = []

    # --- Step 1: Handle Replenishment & Mentions (Human Only) ---
    if last_msg.type == "human":
        # Replenish budgets when last message is from human
        for agent in active_agents:
            agent_budgets[agent["name"]] = min(
                agent_budgets.get(agent["name"], 0) + BUDGET_REPLENISH_AMOUNT,
                agent["token_budget"]
            )
        
        # Handle @Mention Override
        mentions = state.get("mentions", [])
        if mentions:
            active_mentioned = [name for name in mentions if any(a["name"] == name for a in active_agents)]
            if active_mentioned:
                next_speakers = active_mentioned
                for agent in active_agents:
                    if agent["name"] in active_mentioned:
                        agent_budgets[agent["name"]] = max(agent_budgets.get(agent["name"], 0), 1)
                        agent_statuses[agent["name"]] = "Thinking"
                        agent_scores[agent["name"]] = 10.0
                        agent_reasons[agent["name"]] = "Directly mentioned by the user."
                    else:
                        agent_statuses[agent["name"]] = "Idle"
                        agent_scores[agent["name"]] = 0.0
                        agent_reasons[agent["name"]] = "Not directly mentioned."
                
                return {
                    "next_speakers": next_speakers,
                    "agent_budgets": agent_budgets,
                    "agent_statuses": agent_statuses,
                    "agent_scores": agent_scores,
                    "agent_reasons": agent_reasons,
                    "turn_number": turn + 1,
                    "mentions": []
                }

    # --- Step 2: Scoring & Candidate Selection (Human & AI) ---
    candidates = [a for a in active_agents if agent_budgets.get(a["name"], 0) > 0]
    
    # Avoid an agent responding immediately to itself (cross-talk prevention)
    if last_msg.type == "ai":
        candidates = [a for a in candidates if a["name"] != last_msg.name]

    if not candidates:
        return {
            "next_speakers": [], 
            "agent_budgets": agent_budgets, 
            "agent_statuses": agent_statuses, 
            "agent_scores": {},
            "agent_reasons": {},
            "turn_number": turn + (1 if last_msg.type == "human" else 0)
        }

    # Evaluate Importance and Sort
    scores, reasons = await eval_speaker_importance(messages, candidates)
    agent_scores = scores
    agent_reasons = reasons
    
    # Sort candidates by score descending
    sorted_candidates = sorted(candidates, key=lambda a: scores.get(a["name"], 0), reverse=True)
    
    # Filter by threshold
    next_speakers = [
        a["name"] for a in sorted_candidates 
        if scores.get(a["name"], 0) >= PARTICIPATION_THRESHOLD
    ]
    
    # Fallback: 'Winner Takes All' (ensure at least 1 speaker if generic prompt)
    if not next_speakers and sorted_candidates:
        top_agent = sorted_candidates[0]
        if scores.get(top_agent["name"], 0) >= 1.0:
            next_speakers = [top_agent["name"]]
            agent_scores[top_agent["name"]] = max(agent_scores.get(top_agent["name"], 0), PARTICIPATION_THRESHOLD)
    
    # Set status for next speakers
    for name in next_speakers:
        agent_statuses[name] = "Thinking"
    for agent in active_agents:
        if agent["name"] not in next_speakers:
            agent_statuses[agent["name"]] = "Idle"

    return {
        "next_speakers": next_speakers,
        "agent_budgets": agent_budgets,
        "agent_statuses": agent_statuses,
        "agent_scores": agent_scores,
        "agent_reasons": agent_reasons,
        "turn_number": turn + 1 if last_msg.type == "human" else turn,
    }
