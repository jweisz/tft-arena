"""
Semantic Agent — background LangGraph node that runs after each human message.
Produces two outputs pushed over WebSocket:
  1. 'annotation' events: fact-checks / assumption flags for specific excerpts
  2. 'scratchpad' events: updated living summary of the conversation
"""
import json
import logging
import re
from typing import Dict, Any, List
from langchain_core.messages import SystemMessage, HumanMessage, BaseMessage
from ...core.llm import get_llm, get_non_agent_model_config
from ...models.db import SessionLocal
from ...models.schema import Agent, GlobalSettings

logger = logging.getLogger(__name__)

SEMANTIC_SYSTEM_PROMPT = """You are a background Semantic Analyst observing a multi-agent discussion.
Your job is to silently review the latest human message and the recent conversation context.
Respond with ONLY valid JSON (no markdown), following this schema:
{
  "annotations": [
    {
      "excerpt": "<exact text from the human's message to highlight>",
      "type": "factual_error | assumption | speculation | disputed",
      "note": "<brief explanation>"
    }
  ],
  "scratchpad": {
    "consensus": "<1-3 sentences on what has been agreed or established>",
    "open_questions": ["<question 1>", "<question 2>"],
    "key_ideas": ["<idea 1>", "<idea 2>"]
  }
}
If there are no annotations, return an empty list. Be concise and accurate."""


def build_semantic_context(messages: List[BaseMessage], window: int = 6) -> str:
    """Build a compact conversation window for the semantic agent."""
    recent = list(messages)[-window:]
    lines = []
    for m in recent:
        role = getattr(m, "name", None) or m.type
        lines.append(f"[{role.upper()}]: {m.content[:500]}")
    return "\n".join(lines)


def _extract_json_object(raw_content: str) -> dict[str, Any] | None:
    match = re.search(r"```json\s*(\{.*?\})\s*```", raw_content, re.DOTALL)
    if match:
        return json.loads(match.group(1))

    start = raw_content.find("{")
    end = raw_content.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    return json.loads(raw_content[start:end + 1])


def _normalize_semantic_result(result: dict[str, Any]) -> Dict[str, Any]:
    scratchpad = result.get("scratchpad", {}) if isinstance(result, dict) else {}
    annotations = result.get("annotations", []) if isinstance(result, dict) else []

    if not isinstance(scratchpad, dict):
        scratchpad = {}
    if not isinstance(annotations, list):
        annotations = []

    consensus = scratchpad.get("consensus", "")
    open_questions = scratchpad.get("open_questions", [])
    key_ideas = scratchpad.get("key_ideas", [])

    return {
        "annotations": annotations,
        "scratchpad": {
            "consensus": str(consensus) if consensus is not None else "",
            "open_questions": [str(item) for item in open_questions] if isinstance(open_questions, list) else [],
            "key_ideas": [str(item) for item in key_ideas] if isinstance(key_ideas, list) else [],
        },
    }


def _build_model_candidates(initial_provider: str, initial_model: str) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = [(initial_provider, initial_model)]

    db = SessionLocal()
    try:
        settings = db.query(GlobalSettings).first()
        if settings and settings.openai_api_key:
            candidates.append(("openai", "gpt-4o-mini"))
        if settings and settings.anthropic_api_key:
            candidates.append(("anthropic", "claude-3-5-haiku-latest"))
        if settings and settings.google_api_key:
            candidates.append(("gemini", "gemini/gemini-2.0-flash"))

        # Prefer models already configured by the user in Agent Management.
        configured_agents = db.query(Agent).order_by(Agent.sort_order.asc(), Agent.id.asc()).all()
        for agent in configured_agents:
            provider = (agent.provider or "").strip()
            model = (agent.model or "").strip()
            if provider and model:
                candidates.append((provider, model))
    finally:
        db.close()

    # Last-resort local fallbacks for typical Ollama installs.
    candidates.extend([
      ("ollama", "llama3.2:3b"),
      ("ollama", "llama3.1:8b"),
      ("ollama", "granite3.3:2b"),
    ])

    deduped: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


async def run_semantic_agent(
    messages: List[BaseMessage],
    provider: str | None = None,
    model: str | None = None,
) -> Dict[str, Any]:
    """
    Run the semantic agent asynchronously.
    Returns parsed JSON with 'annotations' and 'scratchpad' keys.
    Falls back gracefully on parse errors.
    """
    context = build_semantic_context(messages)

    prompt = [
        SystemMessage(content=SEMANTIC_SYSTEM_PROMPT),
        HumanMessage(content=f"Conversation so far:\n\n{context}\n\nAnalyze the latest human message.")
    ]

    if not provider or not model:
        provider, model = get_non_agent_model_config()

    for candidate_provider, candidate_model in _build_model_candidates(provider, model):
        try:
            llm = get_llm(provider=candidate_provider, model_name=candidate_model, temperature=0.2)
            response = await llm.ainvoke(prompt)
            raw_content = str(response.content).strip()
            parsed = _extract_json_object(raw_content)
            if parsed is None:
                logger.warning(
                    "semantic agent non-json output provider=%s model=%s preview=%s",
                    candidate_provider,
                    candidate_model,
                    raw_content[:200],
                )
                continue
            return _normalize_semantic_result(parsed)
        except Exception as exc:
            logger.warning(
                "semantic agent attempt failed provider=%s model=%s error=%s",
                candidate_provider,
                candidate_model,
                exc,
            )

    # Return a safe empty result rather than crashing.
    return {"annotations": [], "scratchpad": {"consensus": "", "open_questions": [], "key_ideas": []}}
