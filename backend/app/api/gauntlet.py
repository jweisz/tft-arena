"""
Idea Gauntlet API endpoints.

Routes:
  GET  /api/gauntlet/agents/random              - 8 randomly sampled agents
  POST /api/gauntlet/sessions                   - Start a new game session
  GET  /api/gauntlet/sessions/{id}              - Fetch session state
  POST /api/gauntlet/sessions/{id}/battles/{boss_id}/message  - Battle turn
  POST /api/gauntlet/sessions/{id}/summary      - Generate final synthesis
"""

import json
import random
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from ..models.db import get_db
from ..models.schema import Agent, GauntletSession, BattleBoss, BattleMessage
from ..core.security import resolve_request_auth_context
from ..services.gauntlet import (
    get_agent_reply,
    score_exchange,
    get_defeat_reason,
    generate_summary,
    MAX_HP,
)

router = APIRouter(prefix="/api/gauntlet", tags=["Gauntlet"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class AgentSummary(BaseModel):
    id: int
    name: str
    emoji: str
    role_description: str
    provider: str
    model: str

    class Config:
        from_attributes = True


class BattleMessageOut(BaseModel):
    id: int
    role: str
    content: str
    damage: Optional[int]
    damage_reason: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BattleBossOut(BaseModel):
    id: int
    agent_id: int
    status: str
    user_hp: int
    agent_hp: int
    agent: AgentSummary
    messages: List[BattleMessageOut] = []

    class Config:
        from_attributes = True


class SessionOut(BaseModel):
    id: int
    idea: str
    agent_ids: str
    status: str
    summary: Optional[str]
    created_at: datetime
    bosses: List[BattleBossOut] = []

    class Config:
        from_attributes = True


class ModelOverride(BaseModel):
    provider: str
    model: str


class CreateSessionRequest(BaseModel):
    idea: str
    agent_ids: List[int]  # exactly 8
    model_overrides: Optional[dict] = None  # {slot_index: {provider, model}}


class SendMessageRequest(BaseModel):
    content: str


class BattleTurnOut(BaseModel):
    agent_reply: str
    user_damage: int  # damage dealt TO the agent (user's attack)
    user_damage_reason: Optional[str] = None
    agent_damage: int  # damage dealt TO the user (agent's counter)
    agent_damage_reason: Optional[str] = None
    user_hp: int
    agent_hp: int
    battle_over: bool
    winner: Optional[str]  # "user" | "agent" | None
    defeat_reason: Optional[str] = None  # set only when winner == "agent"


class BattleOpeningOut(BaseModel):
    agent_reply: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_user_id(request: Request) -> str:
    ctx = resolve_request_auth_context(request)
    return ctx.principal or "anonymous"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/agents/random", response_model=List[AgentSummary])
def random_agents(count: int = 8, db: Session = Depends(get_db)):
    """Return up to `count` randomly sampled agents from the global pool."""
    all_agents = db.query(Agent).all()
    if not all_agents:
        return []
    sample = random.sample(all_agents, min(count, len(all_agents)))
    return sample


@router.post("/sessions", response_model=SessionOut)
def create_session(
    body: CreateSessionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if not body.idea.strip():
        raise HTTPException(status_code=400, detail="Idea cannot be empty")
    if len(body.agent_ids) != 8:
        raise HTTPException(status_code=400, detail="Exactly 8 agent IDs required")

    # Verify all agents exist
    for aid in body.agent_ids:
        if not db.query(Agent).filter(Agent.id == aid).first():
            raise HTTPException(status_code=404, detail=f"Agent {aid} not found")

    user_id = _get_user_id(request)
    session = GauntletSession(
        user_id=user_id,
        idea=body.idea.strip(),
        agent_ids=json.dumps(body.agent_ids),
        status="active",
    )
    db.add(session)
    db.flush()  # get session.id

    overrides = body.model_overrides or {}
    for idx, agent_id in enumerate(body.agent_ids):
        override = overrides.get(str(idx)) or overrides.get(idx)
        boss = BattleBoss(
            session_id=session.id,
            agent_id=agent_id,
            status="pending",
            user_hp=MAX_HP,
            agent_hp=MAX_HP,
            provider_override=override.get("provider")
            if isinstance(override, dict)
            else None,
            model_override=override.get("model")
            if isinstance(override, dict)
            else None,
        )
        db.add(boss)

    db.commit()
    db.refresh(session)

    # Eager-load relationships for response
    session = (
        db.query(GauntletSession)
        .options(joinedload(GauntletSession.bosses).joinedload(BattleBoss.agent))
        .filter(GauntletSession.id == session.id)
        .first()
    )
    return session


@router.get("/sessions/{session_id}", response_model=SessionOut)
def get_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = _get_user_id(request)
    session = (
        db.query(GauntletSession)
        .options(
            joinedload(GauntletSession.bosses).joinedload(BattleBoss.agent),
            joinedload(GauntletSession.bosses).joinedload(BattleBoss.messages),
        )
        .filter(GauntletSession.id == session_id, GauntletSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post(
    "/sessions/{session_id}/battles/{boss_id}/opening", response_model=BattleOpeningOut
)
async def battle_opening(
    session_id: int,
    boss_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Generate the agent's opening challenge (boss strikes first).
    Idempotent: if the opening was already stored, returns it without calling the LLM again.
    """
    user_id = _get_user_id(request)
    session = (
        db.query(GauntletSession)
        .filter(GauntletSession.id == session_id, GauntletSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    boss = (
        db.query(BattleBoss)
        .options(joinedload(BattleBoss.agent), joinedload(BattleBoss.messages))
        .filter(BattleBoss.id == boss_id, BattleBoss.session_id == session_id)
        .first()
    )
    if not boss:
        raise HTTPException(status_code=404, detail="Battle not found")

    # Idempotent: return existing opening if already generated
    existing = next((m for m in boss.messages if m.role == "agent"), None)
    if existing:
        return BattleOpeningOut(agent_reply=existing.content)

    # Generate the opening challenge with no prior exchange (idea alone as context)
    agent_reply = await get_agent_reply(
        agent=boss.agent,
        idea=session.idea,
        battle_messages=[],
        provider_override=boss.provider_override,
        model_override=boss.model_override,
    )

    db.add(
        BattleMessage(boss_id=boss.id, role="agent", content=agent_reply, damage=None)
    )

    if boss.status == "pending":
        boss.status = "active"

    db.commit()
    return BattleOpeningOut(agent_reply=agent_reply)


@router.post(
    "/sessions/{session_id}/battles/{boss_id}/message", response_model=BattleTurnOut
)
async def battle_message(
    session_id: int,
    boss_id: int,
    body: SendMessageRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _get_user_id(request)
    session = (
        db.query(GauntletSession)
        .filter(GauntletSession.id == session_id, GauntletSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "complete":
        raise HTTPException(status_code=400, detail="Session is already complete")

    boss = (
        db.query(BattleBoss)
        .options(joinedload(BattleBoss.agent), joinedload(BattleBoss.messages))
        .filter(BattleBoss.id == boss_id, BattleBoss.session_id == session_id)
        .first()
    )
    if not boss:
        raise HTTPException(status_code=404, detail="Battle not found")
    if boss.status == "defeated":
        raise HTTPException(status_code=400, detail="This boss is already defeated")

    # Mark battle as active on first message
    if boss.status == "pending":
        boss.status = "active"
        db.flush()

    user_content = body.content.strip()
    if not user_content:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Store user message first (without damage yet; we score after getting reply)
    user_msg = BattleMessage(
        boss_id=boss.id,
        role="user",
        content=user_content,
    )
    db.add(user_msg)
    db.flush()

    # Reload messages for context (including the new user message)
    all_messages = (
        db.query(BattleMessage)
        .filter(BattleMessage.boss_id == boss.id)
        .order_by(BattleMessage.id.asc())
        .all()
    )

    # Get agent reply (respects per-boss provider/model override if set)
    agent_reply = await get_agent_reply(
        agent=boss.agent,
        idea=session.idea,
        battle_messages=all_messages,
        provider_override=boss.provider_override,
        model_override=boss.model_override,
    )

    # Score the exchange
    (
        user_damage,
        user_damage_reason,
        agent_damage,
        agent_damage_reason,
    ) = await score_exchange(
        idea=session.idea,
        user_message=user_content,
        agent_reply=agent_reply,
    )

    # Update user message with damage dealt to agent
    user_msg.damage = user_damage
    user_msg.damage_reason = user_damage_reason

    # Store agent message with its damage value
    agent_msg = BattleMessage(
        boss_id=boss.id,
        role="agent",
        content=agent_reply,
        damage=agent_damage,
        damage_reason=agent_damage_reason,
    )
    db.add(agent_msg)

    # Apply damage
    boss.agent_hp = max(0, boss.agent_hp - user_damage)
    boss.user_hp = max(0, boss.user_hp - agent_damage)

    # Determine outcome
    battle_over = boss.agent_hp == 0 or boss.user_hp == 0
    winner: Optional[str] = None
    defeat_reason: Optional[str] = None
    if battle_over:
        if boss.agent_hp == 0:
            winner = "user"
            boss.status = "defeated"
        else:
            winner = "agent"
            boss.status = "failed"
            defeat_reason = await get_defeat_reason(
                idea=session.idea,
                user_message=user_content,
                agent_reply=agent_reply,
            )

    db.commit()

    return BattleTurnOut(
        agent_reply=agent_reply,
        user_damage=user_damage,
        user_damage_reason=user_damage_reason,
        agent_damage=agent_damage,
        agent_damage_reason=agent_damage_reason,
        user_hp=boss.user_hp,
        agent_hp=boss.agent_hp,
        battle_over=battle_over,
        winner=winner,
        defeat_reason=defeat_reason,
    )


@router.post("/sessions/{session_id}/battles/{boss_id}/retry")
def retry_battle(
    session_id: int,
    boss_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """Reset a failed battle: clears the full transcript and restores HP to 100/100."""
    user_id = _get_user_id(request)
    session = (
        db.query(GauntletSession)
        .filter(GauntletSession.id == session_id, GauntletSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    boss = (
        db.query(BattleBoss)
        .filter(
            BattleBoss.id == boss_id,
            BattleBoss.session_id == session_id,
        )
        .first()
    )
    if not boss:
        raise HTTPException(status_code=404, detail="Battle not found")
    if boss.status != "failed":
        raise HTTPException(
            status_code=400, detail="Only failed battles can be retried"
        )

    # Full reset: wipe transcript so the boss opens fresh
    db.query(BattleMessage).filter(BattleMessage.boss_id == boss_id).delete()
    boss.user_hp = MAX_HP
    boss.agent_hp = MAX_HP
    boss.status = "pending"
    db.commit()
    return {"ok": True}


@router.post("/sessions/{session_id}/summary")
async def create_summary(
    session_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _get_user_id(request)
    session = (
        db.query(GauntletSession)
        .options(
            joinedload(GauntletSession.bosses).joinedload(BattleBoss.agent),
            joinedload(GauntletSession.bosses).joinedload(BattleBoss.messages),
        )
        .filter(GauntletSession.id == session_id, GauntletSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    defeated = [b for b in session.bosses if b.status == "defeated"]
    if not defeated:
        raise HTTPException(status_code=400, detail="No defeated bosses yet")

    summary_text = await generate_summary(session, session.bosses)
    session.summary = summary_text
    session.status = "complete"
    db.commit()
    return {"summary": summary_text}
