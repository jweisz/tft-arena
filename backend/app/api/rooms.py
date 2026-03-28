from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..models import schema
from ..schemas import pydantic_models
from ..models.db import get_db

router = APIRouter(prefix="/api/rooms", tags=["Rooms"])

@router.post("/", response_model=pydantic_models.RoomResponse)
def create_room(room_in: pydantic_models.RoomCreate, db: Session = Depends(get_db)):
    db_room = schema.Room(name=room_in.name)
    db.add(db_room)
    db.commit()
    db.refresh(db_room)
    
    # Auto-associate all global agents as active
    all_agents = db.query(schema.Agent).all()
    for agent in all_agents:
        room_agent = schema.RoomAgent(room_id=db_room.id, agent_id=agent.id, is_active=True)
        db.add(room_agent)
    
    db.commit()
    return db_room

@router.get("/", response_model=List[pydantic_models.RoomResponse])
def read_rooms(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(schema.Room).order_by(schema.Room.created_at.desc()).offset(skip).limit(limit).all()

@router.get("/{room_id}", response_model=pydantic_models.RoomResponse)
def read_room(room_id: int, db: Session = Depends(get_db)):
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room

@router.patch("/{room_id}", response_model=pydantic_models.RoomResponse)
def update_room(room_id: int, room_in: pydantic_models.RoomUpdate, db: Session = Depends(get_db)):
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    room.name = room_in.name
    db.commit()
    db.refresh(room)
    return room

@router.delete("/{room_id}")
async def delete_room(room_id: int, db: Session = Depends(get_db)):
    from ..agents.memory import delete_room_memories
    print(f"--- ATTEMPTING DELETE ROOM {room_id} ---")
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Cleanup memory collections before deleting the room record
    await delete_room_memories(room_id)
    
    db.delete(room)
    db.commit()
    return {"message": f"Room {room_id} deleted"}

@router.get("/{room_id}/agents", response_model=List[pydantic_models.RoomAgentResponse])
def get_room_agents(room_id: int, db: Session = Depends(get_db)):
    """Returns ALL global agents, indicating if they are active in this specific room."""
    # Ensure room exists
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
        
    all_agents = db.query(schema.Agent).all()
    # Get active states for this room
    active_mappings = {
        ra.agent_id: ra.is_active 
        for ra in db.query(schema.RoomAgent).filter(schema.RoomAgent.room_id == room_id).all()
    }
    
    settings = db.query(schema.GlobalSettings).first()
    default_budget = settings.default_agent_turn_budget if settings else 3
    
    result = []
    for agent in all_agents:
        # Default to inactive if no mapping exists yet
        is_active = active_mappings.get(agent.id, False)
        # Convert SQLAlchemy model to dict and add is_active
        agent_data = {col.name: getattr(agent, col.name) for col in agent.__table__.columns}
        agent_data["is_active"] = is_active
        
        # Apply global fallback if budget is NULL
        if agent_data.get("token_budget") is None:
            agent_data["token_budget"] = default_budget
            
        result.append(agent_data)
        
    return result

@router.post("/{room_id}/agents/{agent_id}/toggle")
def toggle_room_agent(room_id: int, agent_id: int, db: Session = Depends(get_db)):
    """Toggles an agent's active status within a specific room."""
    # Validate room and agent exist
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    agent = db.query(schema.Agent).filter(schema.Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    mapping = db.query(schema.RoomAgent).filter(
        schema.RoomAgent.room_id == room_id,
        schema.RoomAgent.agent_id == agent_id
    ).first()
    
    if mapping:
        mapping.is_active = not mapping.is_active
    else:
        mapping = schema.RoomAgent(room_id=room_id, agent_id=agent_id, is_active=True)
        db.add(mapping)
        
    db.commit()
    return {"message": "Toggled", "is_active": mapping.is_active}

@router.post("/{room_id}/agents/bulk-active")
def bulk_active_room_agents(room_id: int, active: bool, db: Session = Depends(get_db)):
    """Sets all agents' active status in a room."""
    room = db.query(schema.Room).filter(schema.Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
        
    all_agents = db.query(schema.Agent).all()
    for agent in all_agents:
        mapping = db.query(schema.RoomAgent).filter(
            schema.RoomAgent.room_id == room_id,
            schema.RoomAgent.agent_id == agent.id
        ).first()
        
        if mapping:
            mapping.is_active = active
        else:
            mapping = schema.RoomAgent(room_id=room_id, agent_id=agent.id, is_active=active)
            db.add(mapping)
            
    db.commit()
    return {"message": f"All agents set to {'active' if active else 'inactive'}"}
