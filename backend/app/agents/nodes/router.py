import json
import math
import re
import logging
from typing import Dict, Any, List
from langchain_core.messages import HumanMessage, SystemMessage
from ..state import ArenaState
from ...core.llm import get_llm

logger = logging.getLogger(__name__)

# Turns replenished to each agent's budget when the user sends a message
BUDGET_REPLENISH_AMOUNT = 3
# Minimum score (0-10) for an agent to participate in a turn
PARTICIPATION_THRESHOLD = 3.0


def _tokenize(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9']+", text.lower()) if len(token) > 2}


def _extract_json_object(raw_content: str) -> dict[str, Any] | None:
    match = re.search(r"```json\s*(\{.*?\})\s*```", raw_content, re.DOTALL)
    if match:
        return json.loads(match.group(1))

    start = raw_content.find("{")
    end = raw_content.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    return json.loads(raw_content[start:end + 1])


def _heuristic_importance_scores(messages: List[Any], agents: List[Dict[str, Any]]) -> tuple[Dict[str, float], Dict[str, str]]:
    if not messages:
        return {agent["name"]: 0.0 for agent in agents}, {agent["name"]: "No conversation context yet." for agent in agents}

    focus_message = next((message for message in reversed(messages) if message.type == "human"), messages[-1])
    focus_text = str(focus_message.content)
    focus_tokens = _tokenize(focus_text)

    scores: Dict[str, float] = {}
    reasons: Dict[str, str] = {}

    guidance_by_agent: Dict[str, set[str]] = {}
    token_frequency: Dict[str, int] = {}
    for agent in agents:
        agent_name = agent["name"]
        guidance = " ".join([
            agent.get("role_description", ""),
            agent.get("relevance_instructions", ""),
        ]).strip()
        guidance_tokens = _tokenize(guidance)
        guidance_by_agent[agent_name] = guidance_tokens
        for token in guidance_tokens:
            token_frequency[token] = token_frequency.get(token, 0) + 1

    for agent in agents:
        agent_name = agent["name"]
        guidance_tokens = guidance_by_agent.get(agent_name, set())
        overlap = focus_tokens & guidance_tokens

        if agent_name.lower() in focus_text.lower():
            score = 9.5
            reasons[agent_name] = "Agent was named directly in the message."
        elif overlap:
            weighted_overlap = sum(1.0 / max(1, token_frequency.get(token, 1)) for token in overlap)
            normalized_overlap = weighted_overlap / max(1.0, math.sqrt(len(guidance_tokens) + 1.0))
            score = min(10.0, round(normalized_overlap * 18.0, 1))
            matched_terms = ", ".join(sorted(list(overlap))[:3])
            reasons[agent_name] = f"Matched topic cues: {matched_terms}."
        else:
            score = 0.0
            reasons[agent_name] = "No strong keyword overlap with its focus areas."

        scores[agent_name] = score

    return scores, reasons

async def eval_speaker_importance(messages: List[Any], agents: List[Dict[str, Any]]) -> tuple[Dict[str, float], Dict[str, str]]:
    """
    Uses a fast LLM to rank the relevance of each agent to the current conversation.
    Returns (scores, reasons): both keyed by agent_name.
    scores: 0-10 float, reasons: one-sentence explanation.
    """
    if not agents: return {}, {}
    
    # Context window: Use the last 5 messages to provide thematic flow.
    recent_msgs = messages[-5:]
    history_context = [
        {"type": m.type, "content": str(m.content)[:500]}
        for m in recent_msgs
    ]

    candidate_context = [
        {
            "name": agent["name"],
            "role_description": agent.get("role_description", ""),
            "relevance_instructions": agent.get("relevance_instructions", ""),
        }
        for agent in agents
    ]

    system_prompt = """
You are a conversation router for a multi-agent arena.
Score how relevant each agent is to replying to the current conversation state.

Prioritize the last human message when one exists, but also consider the immediate thread.
Use each agent's relevance instructions as the primary rubric for what they should care about.
Do not distribute scores evenly unless the agents are genuinely equally relevant.

Scoring scale:
- 0-2: Not relevant.
- 3-5: Mildly or secondarily relevant.
- 6-8: Strong match.
- 9-10: Direct hit or explicitly requested.

Return ONLY JSON with exactly two top-level keys:
- scores: object of agent name -> number
- reasons: object of agent name -> short explanation
""".strip()

    human_prompt = json.dumps({
        "conversation": history_context,
        "agents": candidate_context,
        "requirements": {
            "score_every_agent": True,
            "reason_max_words": 16,
            "prefer_1_to_3_top_agents": True,
        },
    }, ensure_ascii=True)
    
    try:
        # Use a fast model for routing decisions
        llm = get_llm(provider="openai", model_name="gpt-4o-mini", temperature=0)
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt),
        ])
        
        # Clean response text in case of markdown formatting or filler
        raw_content = response.content.strip()
        parsed = _extract_json_object(raw_content)
        if parsed is None:
            logger.warning("router scoring returned non-json payload preview=%s", raw_content[:200])
            return _heuristic_importance_scores(messages, agents)

        heuristic_scores, heuristic_reasons = _heuristic_importance_scores(messages, agents)
        scores = {}
        reasons = {}
        for agent in agents:
            agent_name = agent["name"]
            raw_score = parsed.get("scores", {}).get(agent_name, heuristic_scores.get(agent_name, 0.0))
            try:
                score = max(0.0, min(10.0, float(raw_score)))
            except (TypeError, ValueError):
                score = heuristic_scores.get(agent_name, 0.0)

            scores[agent_name] = score
            reasons[agent_name] = str(parsed.get("reasons", {}).get(agent_name, heuristic_reasons.get(agent_name, "No reason provided.")))

        return scores, reasons
    except Exception:
        logger.exception("router speaker-importance evaluation failed")

    return _heuristic_importance_scores(messages, agents)


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
            agent_reasons[top_agent["name"]] = f"{agent_reasons.get(top_agent['name'], 'Best available match.')} Selected as the best available fallback."
    
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
