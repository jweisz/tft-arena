"""
Semantic Agent — background LangGraph node that runs after each human message.
Produces two outputs pushed over WebSocket:
  1. 'annotation' events: fact-checks / assumption flags for specific excerpts
  2. 'scratchpad' events: updated living summary of the conversation
"""
import json
import asyncio
from typing import Dict, Any, List
from langchain_core.messages import SystemMessage, HumanMessage, BaseMessage
from langchain_core.output_parsers import JsonOutputParser
from ...core.llm import get_llm

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


async def run_semantic_agent(
    messages: List[BaseMessage],
    provider: str = "openai",
    model: str = "gpt-4o-mini",
) -> Dict[str, Any]:
    """
    Run the semantic agent asynchronously.
    Returns parsed JSON with 'annotations' and 'scratchpad' keys.
    Falls back gracefully on parse errors.
    """
    llm = get_llm(provider=provider, model_name=model, temperature=0.2)
    context = build_semantic_context(messages)

    prompt = [
        SystemMessage(content=SEMANTIC_SYSTEM_PROMPT),
        HumanMessage(content=f"Conversation so far:\n\n{context}\n\nAnalyze the latest human message.")
    ]

    try:
        response = await asyncio.get_event_loop().run_in_executor(
            None, lambda: llm.invoke(prompt)
        )
        result = json.loads(response.content)
        return result
    except (json.JSONDecodeError, Exception):
        # Return a safe empty result rather than crashing
        return {"annotations": [], "scratchpad": {"consensus": "", "open_questions": [], "key_ideas": []}}
