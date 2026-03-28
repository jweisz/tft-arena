"""
Emergency Stop endpoint — sets a room-scoped flag that the LangGraph
state machine checks before (and during) each agent turn.
We store the flag in a simple in-process dict for now; the WebSocket
handler reads from this dict when constructing the initial state.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/rooms", tags=["Control"])

# Room-scoped emergency-stop flags: {room_id: bool}
emergency_flags: dict[int, bool] = {}

@router.post("/{room_id}/emergency-stop")
def emergency_stop(room_id: int):
    emergency_flags[room_id] = True
    return {"status": "stopped", "room_id": room_id}

@router.post("/{room_id}/resume")
def resume(room_id: int):
    emergency_flags[room_id] = False
    return {"status": "resumed", "room_id": room_id}
