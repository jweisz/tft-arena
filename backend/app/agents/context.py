"""
Rolling context window with automatic summarization and eviction.
Keeps the last N messages as-is, then summarizes older messages into
a compact context window prefix to prevent token limit exhaustion.
"""
from typing import Sequence, List, Tuple
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from ..core.llm import get_llm, get_non_agent_model_config

# Keep this many recent messages verbatim; summarize everything older
RECENT_WINDOW = 10

SUMMARIZE_PROMPT = """Below is a transcript from an ongoing think-tank discussion.
Summarize the key points, decisions made, and any important context into 5 bullet points.
Be concise and information-dense. Preserve any factual claims, names, or decisions made.

---
{transcript}
---

Summary (5 bullets max):"""


async def maybe_summarize(
    messages: Sequence[BaseMessage],
    provider: str | None = None,
    model: str | None = None,
) -> Tuple[List[BaseMessage], bool]:
    """
    If the conversation exceeds RECENT_WINDOW messages, summarize the older
    portion and prepend as a SystemMessage. Returns (new_messages, was_evicted).
    """
    if len(messages) <= RECENT_WINDOW:
        return list(messages), False

    if not provider or not model:
        provider, model = get_non_agent_model_config()

    old_messages = messages[:-RECENT_WINDOW]
    recent_messages = messages[-RECENT_WINDOW:]

    # Build transcript for summarization
    lines = []
    for m in old_messages:
        role = getattr(m, "name", None) or m.type
        lines.append(f"[{role.upper()}]: {m.content[:600]}")
    transcript = "\n".join(lines)

    llm = get_llm(provider=provider, model_name=model, temperature=0.1)
    prompt = [HumanMessage(content=SUMMARIZE_PROMPT.format(transcript=transcript))]

    try:
        import asyncio
        response = await asyncio.get_running_loop().run_in_executor(
            None, lambda: llm.invoke(prompt)
        )
        summary_text = response.content
    except Exception:
        summary_text = "(Older conversation context summarized due to length.)"

    summary_message = SystemMessage(
        content=f"[CONTEXT SUMMARY — earlier conversation]\n{summary_text}"
    )

    return [summary_message] + list(recent_messages), True
