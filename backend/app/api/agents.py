"""
Global Agent CRUD endpoints.
Supports create/list/update/delete for agent blueprints across all rooms.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..models import schema
from ..schemas.pydantic_models import AgentCreate, AgentResponse
from ..models.db import get_db

from ..services.prompt_loader import prompt_loader

router = APIRouter(prefix="/api/agents", tags=["Agents"])

@router.get("/presets", response_model=List[dict])
def list_presets():
    return prompt_loader.list_prompts()

@router.get("/", response_model=List[AgentResponse])
def list_agents(db: Session = Depends(get_db)):
    return db.query(schema.Agent).all()

@router.post("/", response_model=AgentResponse)
def create_agent(agent_in: AgentCreate, db: Session = Depends(get_db)):
    # Check if name already exists
    existing = db.query(schema.Agent).filter(schema.Agent.name == agent_in.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent name already exists")
    
    agent = schema.Agent(**agent_in.model_dump())
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent

@router.put("/{agent_id}", response_model=AgentResponse)
def update_agent(agent_id: int, agent_in: AgentCreate, db: Session = Depends(get_db)):
    agent = db.query(schema.Agent).filter(schema.Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Check name collision
    existing = db.query(schema.Agent).filter(schema.Agent.name == agent_in.name, schema.Agent.id != agent_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent name already exists")

    for key, val in agent_in.model_dump().items():
        setattr(agent, key, val)
    db.commit()
    db.refresh(agent)
    return agent

@router.delete("/{agent_id}")
def delete_agent(agent_id: int, db: Session = Depends(get_db)):
    print(f"--- ATTEMPTING DELETE AGENT {agent_id} ---")
    agent = db.query(schema.Agent).filter(schema.Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    db.delete(agent)
    db.commit()
    return {"message": f"Agent {agent_id} deleted"}
