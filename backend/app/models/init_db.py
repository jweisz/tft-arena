from .db import engine, Base
from .schema import User, GlobalSettings, Room, AgentPersona, Message

def init_db():
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    init_db()
    print("SQLite Database successfully initialized.")
