import asyncio
from typing import Dict


class LockManager:
    def __init__(self):
        self.locks: Dict[int, asyncio.Lock] = {}

    def get_lock(self, room_id: int) -> asyncio.Lock:
        if room_id not in self.locks:
            self.locks[room_id] = asyncio.Lock()
        return self.locks[room_id]


lock_manager = LockManager()
