"""
Messages REST API — fetch transcript and trigger Markdown export.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import datetime
from ..models import schema
from ..schemas.pydantic_models import MessageResponse
from ..models.db import get_db

router = APIRouter(prefix="/api/rooms/{room_id}/messages", tags=["Messages"])


@router.get("/", response_model=List[MessageResponse])
def list_messages(room_id: int, limit: int = 200, db: Session = Depends(get_db)):
    """Fetch recent transcript for a room."""
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    msgs = (
        db.query(schema.Message)
        .options(joinedload(schema.Message.agent))
        .filter(schema.Message.room_id == room_id)
        .order_by(schema.Message.timestamp.asc())
        .limit(limit)
        .all()
    )
    return msgs


@router.get("/export", response_class=PlainTextResponse)
def export_markdown(room_id: int, db: Session = Depends(get_db)):
    """Export the full room transcript as a Markdown file."""
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    msgs = (
        db.query(schema.Message)
        .filter(schema.Message.room_id == room_id)
        .order_by(schema.Message.timestamp.asc())
        .all()
    )

    lines = [
        f"# {room.name}",
        f"> Exported from TFT Arena on {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
        "",
    ]

    for msg in msgs:
        ts = msg.timestamp.strftime("%H:%M") if msg.timestamp else "??"
        if msg.role == "human":
            lines.append(f"**[{ts}] You**")
        elif msg.role == "agent":
            agent_name = msg.agent.name if msg.agent else "Agent"
            lines.append(f"**[{ts}] {agent_name}**")
        else:
            lines.append(f"*[{ts}] System*")
        lines.append("")
        lines.append(msg.content)
        if msg.is_interrupted:
            lines.append("*(interrupted)*")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)
