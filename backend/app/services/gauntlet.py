"""
Idea Gauntlet service layer.

Handles:
- Building battle-mode system prompts (wrapping agent persona with adversarial preamble)
- Calling the LLM to get an agent reply during a battle
- Calling a scoring LLM to calculate HP damage for each exchange
- Generating a final synthesis summary across all defeated bosses
"""

import json
import logging
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from ..core.llm import get_llm, get_non_agent_model_config
from ..models.schema import Agent, BattleBoss, BattleMessage, GauntletSession

logger = logging.getLogger(__name__)

MAX_HP = 100
# Damage range — chosen so battles last ~3-4 turns at average scoring
MIN_DAMAGE = 12  # even a weak argument makes a dent
MAX_DAMAGE = 40  # a devastating argument deals significant HP


def _build_battle_system_prompt(agent: Agent, idea: str) -> str:
    return (
        f"You are {agent.name} in a structured debate. "
        f'The user is defending this idea: "{idea}". '
        f"Your job is to rigorously challenge their reasoning, expose logical flaws, "
        f"find weaknesses in their evidence, and push back hard on every claim. "
        f"Stay in character as your persona: {agent.role_description}\n\n"
        f"PERSONA INSTRUCTIONS:\n{agent.system_prompt}\n\n"
        f"DEBATE RULES:\n"
        f"- Open with a pointed challenge or objection to the user's idea.\n"
        f"- Be adversarial but intellectually honest — no strawmen.\n"
        f"- Keep responses focused and under 150 words.\n"
        f"- Do NOT compliment the user's argument before attacking it.\n"
        f"- Do NOT prefix your response with your name."
    )


def _build_messages_for_llm(
    battle_messages: list[BattleMessage],
    opening_idea: str,
) -> list:
    """Convert stored BattleMessage rows to LangChain message objects."""
    lc_messages = [HumanMessage(content=f"I want to defend this idea: {opening_idea}")]
    for msg in battle_messages:
        if msg.role == "user":
            lc_messages.append(HumanMessage(content=msg.content))
        else:
            lc_messages.append(AIMessage(content=msg.content))
    return lc_messages


async def get_agent_reply(
    agent: Agent,
    idea: str,
    battle_messages: list[BattleMessage],
    provider_override: str | None = None,
    model_override: str | None = None,
) -> str:
    """Call the agent LLM and return its battle reply."""
    system_msg = SystemMessage(content=_build_battle_system_prompt(agent, idea))
    lc_messages = _build_messages_for_llm(battle_messages, idea)
    provider = provider_override or agent.provider
    model_name = model_override or agent.model
    llm = get_llm(provider=provider, model_name=model_name, temperature=0.8)
    response = await llm.ainvoke([system_msg] + lc_messages)
    return response.content.strip()


def _subscores_to_damage(ev: int, lo: int, en: int, no: int) -> int:
    """Map four 1-10 sub-scores to the MIN_DAMAGE–MAX_DAMAGE range."""
    total = ev + lo + en + no  # 4–40
    return round(MIN_DAMAGE + (total - 4) * (MAX_DAMAGE - MIN_DAMAGE) / 36)


def _format_reason(synthesis: str, ev: int, lo: int, en: int, no: int) -> str:
    return f"{synthesis}\n(Evidence: {ev}, Logic: {lo}, Engagement: {en}, Novelty: {no})"


async def score_exchange(
    idea: str,
    user_message: str,
    agent_reply: str,
) -> tuple[int, str | None, int, str | None]:
    """
    Score each argument on four dimensions (1-10 each):
      Evidence   — specificity of data, studies, named examples
      Logic      — causal validity; does the conclusion follow from premises?
      Engagement — directly rebuts what the opponent just said
      Novelty    — introduces a new angle vs. restating a prior point

    Expertise paired with substantive evidence earns a small Evidence bonus.
    Damage = MIN_DAMAGE + (sum-4) * (MAX_DAMAGE-MIN_DAMAGE) / 36

    Returns (user_damage, user_reason, agent_damage, agent_reason).
    """
    provider, model = get_non_agent_model_config()
    llm = get_llm(provider=provider, model_name=model, temperature=0.0)

    scoring_prompt = (
        f"You are a debate judge evaluating two arguments.\n"
        f'The user is defending: "{idea}"\n\n'
        f"USER ARGUMENT:\n{user_message}\n\n"
        f"CRITIC REPLY:\n{agent_reply}\n\n"
        f"Score EACH argument independently on four dimensions, each from 1 to 10:\n\n"
        f"  evidence   — specificity: named data, statistics, studies, real events score high;\n"
        f"               vague generalizations score low. If the speaker cites expertise AND\n"
        f"               substantive evidence (e.g. 'as an economist, the BLS data shows...'),\n"
        f"               give a small bonus — bare appeals to authority without substance do not score higher.\n"
        f"  logic      — does the conclusion follow from the premises? tight causal chains score\n"
        f"               high; correlation-as-causation or non-sequiturs score low.\n"
        f"  engagement — does it directly rebut what the opponent just said, or talk past them?\n"
        f"               direct rebuttal scores high; ignoring the opponent scores low.\n"
        f"  novelty    — does it introduce a new angle, or restate something already said?\n"
        f"               new insight scores high; repetition scores low.\n\n"
        f"Also write one short synthesis phrase (max 8 words) for each side explaining\n"
        f"the dominant strength or weakness.\n\n"
        f"Respond with ONLY a JSON object:\n"
        f"{{\n"
        f'  "user_evidence": 1-10, "user_logic": 1-10,\n'
        f'  "user_engagement": 1-10, "user_novelty": 1-10,\n'
        f'  "user_reason": "short synthesis",\n'
        f'  "critic_evidence": 1-10, "critic_logic": 1-10,\n'
        f'  "critic_engagement": 1-10, "critic_novelty": 1-10,\n'
        f'  "critic_reason": "short synthesis"\n'
        f"}}"
    )

    try:
        response = await llm.ainvoke([HumanMessage(content=scoring_prompt)])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        s = json.loads(raw)

        def clamp(v: object) -> int:
            return max(1, min(10, int(v)))  # type: ignore[arg-type]

        u_ev, u_lo, u_en, u_no = (
            clamp(s.get("user_evidence", 5)),
            clamp(s.get("user_logic", 5)),
            clamp(s.get("user_engagement", 5)),
            clamp(s.get("user_novelty", 5)),
        )
        c_ev, c_lo, c_en, c_no = (
            clamp(s.get("critic_evidence", 5)),
            clamp(s.get("critic_logic", 5)),
            clamp(s.get("critic_engagement", 5)),
            clamp(s.get("critic_novelty", 5)),
        )

        user_dmg = _subscores_to_damage(u_ev, u_lo, u_en, u_no)
        agent_dmg = _subscores_to_damage(c_ev, c_lo, c_en, c_no)

        user_reason = _format_reason(
            str(s.get("user_reason", "")).strip() or "argument scored",
            u_ev,
            u_lo,
            u_en,
            u_no,
        )
        agent_reason = _format_reason(
            str(s.get("critic_reason", "")).strip() or "critic scored",
            c_ev,
            c_lo,
            c_en,
            c_no,
        )

        return user_dmg, user_reason, agent_dmg, agent_reason
    except Exception:
        logger.warning("Scoring LLM call failed; using defaults", exc_info=True)
        return MIN_DAMAGE + 12, None, MIN_DAMAGE + 8, None


async def get_defeat_reason(idea: str, user_message: str, agent_reply: str) -> str:
    """
    Generate a 1-2 sentence explanation of the specific flaw that cost the user the battle.
    Called only when user HP reaches zero.
    """
    provider, model = get_non_agent_model_config()
    llm = get_llm(provider=provider, model_name=model, temperature=0.3)
    prompt = (
        f'In a debate, a user defended this idea: "{idea}"\n\n'
        f"Their final argument was:\n{user_message}\n\n"
        f"The critic's winning counter was:\n{agent_reply}\n\n"
        f"In 1-2 sentences, identify the specific logical flaw or gap in evidence that "
        f"cost the user the debate. Be direct and name the exact reasoning error — "
        f"do not be vague or complimentary."
    )
    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return response.content.strip()
    except Exception:
        logger.warning("Defeat reason LLM call failed", exc_info=True)
        return "Your argument failed to adequately counter the critic's challenge."


async def generate_summary(session: GauntletSession, bosses: list[BattleBoss]) -> str:
    """
    Generate a final synthesis of the idea after all battles are complete.
    Concatenates defeated boss transcripts and asks the LLM to produce
    the most robust version of the idea with all objections addressed.
    """
    provider, model = get_non_agent_model_config()
    llm = get_llm(provider=provider, model_name=model, temperature=0.7)

    transcripts = []
    for boss in bosses:
        if boss.status != "defeated":
            continue
        agent_name = boss.agent.name if boss.agent else f"Agent #{boss.agent_id}"
        lines = [f"=== Battle vs {agent_name} ==="]
        for msg in sorted(boss.messages, key=lambda m: m.id):
            speaker = "User" if msg.role == "user" else agent_name
            lines.append(f"{speaker}: {msg.content}")
        transcripts.append("\n".join(lines))

    full_transcript = "\n\n".join(transcripts)

    summary_prompt = (
        f'The user defended this idea: "{session.idea}"\n\n'
        f"They had the following debate transcripts with {len(transcripts)} critics:\n\n"
        f"{full_transcript}\n\n"
        f"Based on all of these debates:\n"
        f"1. Write the most robust, well-defended version of the idea that incorporates "
        f"   all valid objections and steelmans the strongest counterarguments.\n"
        f"2. List the 3-5 strongest objections that were raised.\n"
        f"3. For each objection, explain how the user's argument addressed (or failed to address) it.\n\n"
        f"Format your response clearly with sections: "
        f"'The Robust Idea', 'Key Objections & Responses'."
    )

    response = await llm.ainvoke([HumanMessage(content=summary_prompt)])
    return response.content.strip()
