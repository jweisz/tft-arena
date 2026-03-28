import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
from .db import Base

class User(Base):
    """Single user profile populated via Google OAuth."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class GlobalSettings(Base):
    __tablename__ = "global_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    openai_api_key = Column(String, nullable=True)
    anthropic_api_key = Column(String, nullable=True)
    google_api_key = Column(String, nullable=True)
    ollama_base_url = Column(String, default="http://host.docker.internal:11434")
    # Stored as JSON string
    theme_preferences = Column(Text, nullable=True) 
    
    default_agent_turn_budget = Column(Integer, default=3)
    global_system_instruction = Column(Text, nullable=True)

class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    messages = relationship("Message", back_populates="room", cascade="all, delete-orphan")
    room_agents = relationship("RoomAgent", back_populates="room", cascade="all, delete-orphan")

class Agent(Base):
    """Global pool of agent blueprints."""
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    role_description = Column(Text, nullable=False)
    system_prompt = Column(Text, nullable=False)
    avatar_url = Column(String, nullable=True)
    
    token_budget = Column(Integer, default=3)
    provider = Column(String, default="openai") # e.g. openai, anthropic
    model = Column(String, default="gpt-4o")

    room_agents = relationship("RoomAgent", back_populates="agent", cascade="all, delete-orphan")

class RoomAgent(Base):
    """Mapping table controlling which global agents are active in which room."""
    __tablename__ = "room_agents"

    room_id = Column(Integer, ForeignKey("rooms.id"), primary_key=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), primary_key=True)
    is_active = Column(Boolean, default=True)

    room = relationship("Room", back_populates="room_agents")
    agent = relationship("Agent", back_populates="room_agents")

class Message(Base):
    """Raw chat transcripts for the operational DB."""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"))
    
    # "human", "agent", "system" (for annotations)
    role = Column(String, nullable=False) 
    content = Column(Text, nullable=False)
    
    # If role == "agent" or "system", which agent generated it?
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    tokens_used = Column(Integer, default=0)
    latency_ms = Column(Float, default=0.0)
    is_interrupted = Column(Boolean, default=False)
    
    room = relationship("Room", back_populates="messages")
    agent = relationship("Agent")
