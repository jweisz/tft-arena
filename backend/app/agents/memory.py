"""
LangMem integration backed by ChromaDB-embedded SQLite.

ChromaDB runs fully in-process — no extra container required.
Data is persisted on disk at LANGMEM_CHROMA_PATH (default: backend/.data/chromadb).

Two namespaced collections:
  • room_{room_id}_agent_{agent_name}  — room-scoped agent memories
  • global_user_profile                — cross-room user knowledge
"""

import os
import hashlib
import re
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_CHROMA_PATH = BACKEND_DIR / ".data" / "chromadb"
CHROMA_PATH = os.environ.get("LANGMEM_CHROMA_PATH", str(DEFAULT_CHROMA_PATH))
Path(CHROMA_PATH).mkdir(parents=True, exist_ok=True)

try:
    import chromadb
    from chromadb.utils import embedding_functions

    _chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)

    # Use the default embedding function (sentence-transformers, runs locally)
    # Falls back to chromadb's built-in model — no OpenAI key required
    _embed_fn = embedding_functions.DefaultEmbeddingFunction()

    _langmem_available = True
except ImportError:
    _chroma_client = None
    _embed_fn = None
    _langmem_available = False


def _get_collection(name: str):
    """Get or create a ChromaDB collection with a safe name."""
    safe = name.replace(" ", "_").replace("/", "_")[:63]
    return _chroma_client.get_or_create_collection(
        name=safe,
        embedding_function=_embed_fn,
        metadata={"hnsw:space": "cosine"},
    )


def _room_collection_name(room_id: int, agent_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", agent_name.lower()).strip("_")[:24] or "agent"
    digest = hashlib.sha1(agent_name.encode("utf-8")).hexdigest()[:10]
    return f"room_{room_id}_{slug}_{digest}"


def _user_collection_name() -> str:
    return "global_user_profile"


async def retrieve_agent_memories(
    room_id: int,
    agent_name: str,
    query: str,
    top_k: int = 3,
) -> str:
    """Semantic search for relevant agent memories. Returns formatted string."""
    if not _langmem_available:
        return ""
    try:
        col = _get_collection(_room_collection_name(room_id, agent_name))
        count = col.count()
        if count == 0:
            return ""
        results = col.query(
            query_texts=[query],
            n_results=min(top_k, count),
        )
        docs = results.get("documents", [[]])[0]
        if not docs:
            return ""
        lines = [f"- {d}" for d in docs]
        return "Relevant memories from this session:\n" + "\n".join(lines)
    except Exception:
        return ""


async def store_agent_memory(room_id: int, agent_name: str, content: str):
    """Embed and store a memory for an agent in a room."""
    if not _langmem_available:
        return
    try:
        import uuid

        col = _get_collection(_room_collection_name(room_id, agent_name))
        col.add(
            documents=[content[:1000]],
            ids=[str(uuid.uuid4())],
        )
    except Exception:
        pass


async def retrieve_user_profile(
    query: str = "user background expertise preferences",
) -> str:
    """Retrieve global user profile context."""
    if not _langmem_available:
        return ""
    try:
        col = _get_collection(_user_collection_name())
        count = col.count()
        if count == 0:
            return ""
        results = col.query(query_texts=[query], n_results=min(5, count))
        docs = results.get("documents", [[]])[0]
        if not docs:
            return ""
        lines = [f"- {d}" for d in docs]
        return "Known user profile:\n" + "\n".join(lines)
    except Exception:
        return ""


async def update_user_profile(new_info: str):
    """Store a new piece of user profile information."""
    if not _langmem_available:
        return
    try:
        import uuid

        col = _get_collection(_user_collection_name())
        col.add(documents=[new_info[:500]], ids=[str(uuid.uuid4())])
    except Exception:
        pass


async def delete_room_memories(room_id: int):
    """Delete all collections and data related to a given room."""
    if not _langmem_available or not _chroma_client:
        return
    try:
        # ChromaDB collections are namespaced by room_{room_id}_{agent_name}
        # We need to find all that match and delete them.
        all_cols = _chroma_client.list_collections()
        target_prefix = f"room_{room_id}_"
        for col in all_cols:
            name = col.name if hasattr(col, "name") else str(col)
            if name.startswith(target_prefix):
                _chroma_client.delete_collection(name)
    except Exception:
        pass


async def delete_agent_memories(agent_name: str):
    """Delete room-scoped memory collections for a deleted agent."""
    if not _langmem_available or not _chroma_client:
        return
    try:
        target_digest = hashlib.sha1(agent_name.encode("utf-8")).hexdigest()[:10]
        all_cols = _chroma_client.list_collections()
        for col in all_cols:
            name = col.name if hasattr(col, "name") else str(col)
            if name.startswith("room_") and name.endswith(f"_{target_digest}"):
                _chroma_client.delete_collection(name)
    except Exception:
        pass
