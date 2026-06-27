"""
Emergency Stop endpoint — sets a room-scoped flag that the LangGraph
state machine checks before (and during) each agent turn.
We store the flag in a simple in-process dict for now; the WebSocket
handler reads from this dict when constructing the initial state.
"""

import asyncio
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..models import schema
from ..models.db import get_db

router = APIRouter(prefix="/api/rooms", tags=["Control"])

# Room-scoped emergency-stop flags: {room_id: bool}
emergency_flags: dict[int, bool] = {}
# Room-scoped active turn task refs: {room_id: asyncio.Task}
active_turn_tasks: dict[int, asyncio.Task[Any]] = {}


def register_turn_task(room_id: int, task: asyncio.Task[Any]) -> None:
    active_turn_tasks[room_id] = task


def clear_turn_task(room_id: int, task: asyncio.Task[Any] | None = None) -> None:
    current = active_turn_tasks.get(room_id)
    if current is None:
        return
    if task is None or current is task:
        active_turn_tasks.pop(room_id, None)


def get_emergency_flag(db: Session, room_id: int) -> bool:
    if room_id in emergency_flags:
        return emergency_flags[room_id]

    control_state = (
        db.query(schema.RoomControlState)
        .filter(schema.RoomControlState.room_id == room_id)
        .first()
    )
    value = bool(control_state.emergency_stop) if control_state else False
    emergency_flags[room_id] = value
    return value


def set_emergency_flag(db: Session, room_id: int, stopped: bool) -> None:
    control_state = (
        db.query(schema.RoomControlState)
        .filter(schema.RoomControlState.room_id == room_id)
        .first()
    )
    if control_state is None:
        control_state = schema.RoomControlState(room_id=room_id, emergency_stop=stopped)
        db.add(control_state)
    else:
        control_state.emergency_stop = stopped
    db.commit()
    emergency_flags[room_id] = stopped


@router.post("/{room_id}/emergency-stop")
def emergency_stop(room_id: int, db: Session = Depends(get_db)):
    set_emergency_flag(db, room_id, True)
    task = active_turn_tasks.get(room_id)
    cancelled = False
    if task and not task.done():
        task.cancel()
        cancelled = True
    return {"status": "stopped", "room_id": room_id, "cancelled": cancelled}


@router.post("/{room_id}/resume")
def resume(room_id: int, db: Session = Depends(get_db)):
    set_emergency_flag(db, room_id, False)
    return {"status": "resumed", "room_id": room_id}
