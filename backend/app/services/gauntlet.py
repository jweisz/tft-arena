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

# Difficulty multipliers applied after scoring.
# "user" = multiplier on damage the player deals to the boss.
# "boss" = multiplier on damage the boss deals to the player.
DIFFICULTY_MULTIPLIERS: dict[str, dict[str, float]] = {
    "easy":      {"user": 1.5,  "boss": 0.75},
    "normal":    {"user": 1.2,  "boss": 0.9},
    "difficult": {"user": 1.0,  "boss": 1.0},
}


def apply_difficulty(user_damage: int, agent_damage: int, difficulty: str) -> tuple[int, int]:
    mults = DIFFICULTY_MULTIPLIERS.get(difficulty, DIFFICULTY_MULTIPLIERS["difficult"])
    return round(user_damage * mults["user"]), round(agent_damage * mults["boss"])


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


async def get_concession_message(agent: Agent, idea: str, user_message: str) -> str:
    """
    Generate a concession from the defeated boss acknowledging the player's winning argument.
    Called when the player's attack reduces the boss's HP to 0.
    """
    provider, model = get_non_agent_model_config()
    llm = get_llm(provider=provider, model_name=model, temperature=0.9)
    prompt = (
        f"You are {agent.name}, a debate critic with this persona: {agent.role_description}\n\n"
        f'The debate topic was: "{idea}"\n\n'
        f"The player just made this argument that defeated you:\n{user_message}\n\n"
        f"Concede defeat in 1-2 sentences. Acknowledge the specific point in their argument that "
        f"convinced or silenced you. Stay in character as {agent.name}. "
        f"Vary your phrasing — do not always start with 'I concede' or 'You have defeated me'. "
        f"Be genuine and specific about what persuaded you. Do not use markdown."
    )
    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return response.content.strip()
    except Exception:
        logger.warning("Concession message LLM call failed", exc_info=True)
        return "I cannot refute that. You've bested me."


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


async def generate_boss_summary(session: GauntletSession, boss: BattleBoss) -> str:
    """One-sentence summary of the player's strongest point vs a single boss."""
    name = boss.agent.name if boss.agent else f"Agent #{boss.agent_id}"
    user_messages = [m for m in boss.messages if m.role == "user"]
    if not user_messages:
        # Boss was bypassed — no real transcript to summarise
        return "This battle was skipped — no debate transcript recorded."

    provider, model = get_non_agent_model_config()
    llm = get_llm(provider=provider, model_name=model, temperature=0.5)
    lines = []
    for msg in sorted(boss.messages, key=lambda m: m.id):
        speaker = "Player" if msg.role == "user" else name
        lines.append(f"{speaker}: {msg.content}")
    transcript = "\n".join(lines)
    prompt = (
        f'The player defended this idea: "{session.idea}"\n\n'
        f"Debate transcript vs {name}:\n{transcript}\n\n"
        f"In exactly one sentence, name the single strongest argument or point the player made "
        f"in this conversation. Be specific — reference the actual content of what was said. "
        f"Do not use markdown. Do not begin the sentence with 'The player'."
    )
    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return response.content.strip()
    except Exception:
        logger.warning("Boss summary LLM call failed", exc_info=True)
        return "No summary available."


async def generate_objections(session: GauntletSession, bosses: list[BattleBoss]) -> list[dict]:
    """Grouped objections across all defeated bosses with best counterpoints."""
    provider, model = get_non_agent_model_config()
    llm = get_llm(provider=provider, model_name=model, temperature=0.7)

    defeated = [b for b in bosses if b.status == "defeated"]
    boss_names: list[str] = []
    sections: list[str] = []
    for boss in defeated:
        name = boss.agent.name if boss.agent else f"Agent #{boss.agent_id}"
        user_msgs = [m for m in boss.messages if m.role == "user"]
        if not user_msgs:
            # Boss was bypassed — no transcript to include
            continue
        boss_names.append(name)
        lines = [f"=== {name} ==="]
        for msg in sorted(boss.messages, key=lambda m: m.id):
            speaker = "Player" if msg.role == "user" else name
            lines.append(f"{speaker}: {msg.content}")
        sections.append("\n".join(lines))

    if not sections:
        return []

    transcripts_text = "\n\n".join(sections)

    prompt = (
        f'The player defended this idea: "{session.idea}"\n\n'
        f"They debated {len(boss_names)} critics with recorded transcripts: {', '.join(boss_names)}.\n\n"
        f"FULL TRANSCRIPTS:\n{transcripts_text}\n\n"
        f"Produce a JSON array of ALL distinct objections raised across all critics. "
        f"Group near-identical objections together and list every critic who raised them. "
        f"For each group, synthesize the player's strongest counterpoint across all conversations "
        f"where that objection appeared. "
        f"Use plain text only — no markdown, no asterisks, no dashes.\n\n"
        f"Return ONLY a JSON array:\n"
        f"[\n"
        f'  {{\n'
        f'    "objection": "Concise statement of the objection",\n'
        f'    "raised_by": ["name1", "name2"],\n'
        f'    "counterpoint": "Synthesis of the player\'s best counterpoint"\n'
        f'  }}\n'
        f"]\n\n"
        f"Respond with ONLY the JSON array, no surrounding text."
    )

    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        result = json.loads(raw)
        if isinstance(result, list):
            return result
        return []
    except Exception:
        logger.warning("Objections LLM call failed", exc_info=True)
        return []


async def generate_summary(session: GauntletSession, bosses: list[BattleBoss]) -> str:
    """
    Generate a structured JSON synthesis of all defeated-boss debates.

    Returns a JSON string with shape:
      { per_boss: [{name, summary}], objections: [{objection, raised_by, counterpoint}] }

    All text fields are plain text — no markdown, asterisks, or pound signs.
    """
    provider, model = get_non_agent_model_config()
    llm = get_llm(provider=provider, model_name=model, temperature=0.7)

    defeated = [b for b in bosses if b.status == "defeated"]
    boss_names: list[str] = []
    sections: list[str] = []
    for boss in defeated:
        name = boss.agent.name if boss.agent else f"Agent #{boss.agent_id}"
        user_msgs = [m for m in boss.messages if m.role == "user"]
        if not user_msgs:
            continue  # bypass — no transcript, skip to avoid hallucination
        boss_names.append(name)
        lines = [f"=== {name} ==="]
        for msg in sorted(boss.messages, key=lambda m: m.id):
            speaker = "Player" if msg.role == "user" else name
            lines.append(f"{speaker}: {msg.content}")
        sections.append("\n".join(lines))

    if not sections:
        return json.dumps({"per_boss": [], "objections": []})

    transcripts_text = "\n\n".join(sections)

    summary_prompt = (
        f'The player defended this idea: "{session.idea}"\n\n'
        f"They debated {len(boss_names)} critics with recorded transcripts: {', '.join(boss_names)}.\n\n"
        f"FULL TRANSCRIPTS:\n{transcripts_text}\n\n"
        f"Produce a JSON object with this exact structure. "
        f"Use plain text only in all string values — no markdown, no asterisks, no pound signs, no bullet dashes:\n\n"
        f'{{\n'
        f'  "per_boss": [\n'
        f'    {{"name": "critic name", "summary": "One sentence describing the strongest argument the player made in this specific conversation."}}\n'
        f'  ],\n'
        f'  "objections": [\n'
        f'    {{\n'
        f'      "objection": "Concise statement of the objection or criticism raised",\n'
        f'      "raised_by": ["name1", "name2"],\n'
        f'      "counterpoint": "Synthesis of the strongest counterpoint the player made across all conversations where this objection appeared."\n'
        f'    }}\n'
        f'  ]\n'
        f'}}\n\n'
        f"Rules:\n"
        f'- "per_boss" must have one entry per defeated critic, in transcript order.\n'
        f'- "objections" must cover ALL distinct objections raised. Group near-identical objections together '
        f'  and list every critic who raised them in "raised_by".\n'
        f'- "counterpoint" should synthesize the best rebuttal the player offered across all turns and conversations '
        f"  where that objection appeared — do not limit to a single exchange.\n"
        f"- Do not omit any objection, even if the player failed to address it well.\n"
        f"- Do not use markdown formatting anywhere in the text fields.\n"
        f"- Respond with ONLY the JSON object, no surrounding text."
    )

    try:
        response = await llm.ainvoke([HumanMessage(content=summary_prompt)])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        json.loads(raw)  # validate it parses
        return raw
    except Exception:
        logger.warning("Summary LLM call failed or returned non-JSON", exc_info=True)
        return json.dumps({"per_boss": [], "objections": [], "error": "Summary generation failed."})
