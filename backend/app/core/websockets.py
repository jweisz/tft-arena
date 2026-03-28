from fastapi import WebSocket
from typing import List, Dict

class ConnectionManager:
    def __init__(self):
        # Maps room_id to a list of active websocket connections
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: int):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)

    def disconnect(self, websocket: WebSocket, room_id: int):
        if room_id in self.active_connections:
            if websocket in self.active_connections[room_id]:
                self.active_connections[room_id].remove(websocket)
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]

    async def broadcast_to_room(self, message: str, room_id: int):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                await connection.send_text(message)
                
    async def send_json_to_room(self, data: dict, room_id: int):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                await connection.send_json(data)

manager = ConnectionManager()
