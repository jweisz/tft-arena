import { create } from 'zustand'

interface ChatState {
  messages: any[];
  isConnected: boolean;
  error: string | null;
  ws: WebSocket | null;
  connect: (roomId: number) => void;
  sendMessage: (text: string) => void;
  disconnect: () => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  isConnected: false,
  error: null,
  ws: null,

  connect: (roomId: number) => {
    const ws = new WebSocket(`ws://localhost:8000/api/chat/${roomId}/stream`)
    
    ws.onopen = () => {
      set({ isConnected: true, error: null })
    }
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'state_update') {
          // Append raw state update events for now
          // In the future this will parse structured token chunks and construct the chat log
          console.log("Live State Update Event:", data.data)
      } else if (data.type === 'error') {
          set({ error: data.error })
      }
    }
    
    ws.onclose = () => {
      set({ isConnected: false, ws: null })
    }
    
    set({ ws })
  },
  
  sendMessage: (text: string) => {
    const { ws, isConnected } = get()
    if (ws && isConnected) {
      ws.send(JSON.stringify({ text }))
    }
  },
  
  disconnect: () => {
    const { ws } = get()
    if (ws) {
      ws.close()
    }
  }
}))
