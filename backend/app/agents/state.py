import operator
from typing import Annotated, TypedDict, Sequence, List, Dict, Optional

from langchain_core.messages import BaseMessage

class AgentConfig(TypedDict):
    id: int
    name: str
    role_description: str
    relevance_instructions: str
    system_prompt: str
    emoji: str
    model: str
    provider: str
    token_budget: int          # max turns (not tokens) this agent can spend per session per human response

class TelemetryEntry(TypedDict):
    agent_name: str
    tokens_used: int
    latency_ms: float
    turn: int

class ArenaState(TypedDict):
    """LangGraph state keeping track of conversation history and agent coordination."""
    # Chat messages in the room
    messages: Annotated[Sequence[BaseMessage], operator.add]

    # Active agents present in the room that the Router can invoke
    active_agents: List[AgentConfig]

    # Per-agent remaining speaking budget (name → turns remaining)
    # Replenished every time the human sends a message
    # Use Annotated with operator.ior to merge partial updates during parallel execution
    agent_budgets: Annotated[Dict[str, int], operator.ior]

    # Per-agent current status (Idle, Thinking, Speaking)
    # Use Annotated with operator.ior to merge partial updates during parallel execution
    agent_statuses: Annotated[Dict[str, str], operator.ior]

    # List of agent names the router has decided should speak next
    next_speakers: List[str]

    # System flag: user sent a new message mid-generation → abort current streams
    interrupted: bool

    # System flag: user hit the Emergency Stop button → halt all agents permanently
    emergency_stop: bool

    # Telemetry log appended each turn (additive reducer)
    telemetry: Annotated[List[TelemetryEntry], operator.add]
    mentions: List[str]  # Names of the agents specifically tagged with @
    agent_scores: Dict[str, float]  # Scores calculated by the importance evaluator
    agent_reasons: Dict[str, str]   # Short reasoning text per agent from the router

    room_id: int
    turn_number: int
    global_instruction: str
