import { useCallback, useRef } from 'react'
import { useUIStore } from '../store/uiStore'

// Message types received from the backend WebSocket
export type WSEvent =
  | { type: 'token'; agent: string; token: string }
  | { type: 'thinking'; agent: string }
  | { type: 'done' }
  | { type: 'interrupted' }
  | { type: 'error'; error: string }
  | { type: 'telemetry'; data: any[]; budgets: Record<string, number> }
  | { type: 'semantic'; annotations: any[]; scratchpad: any }
  | { type: 'status_update'; statuses: Record<string, string>; scores?: Record<string, number> }

interface UseArenaSocketOptions {
  roomId: number
  onEvent: (event: WSEvent) => void
}

export function useArenaSocket({ roomId, onEvent }: UseArenaSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(`ws://localhost:8000/api/chat/${roomId}/stream`)

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WSEvent
        if (data.type === 'status_update') {
          const { updateAgentStatus, setAgentScores } = useUIStore.getState()
          Object.entries(data.statuses).forEach(([name, status]) => {
            updateAgentStatus(name, status as any)
          })
          if (data.scores) {
            setAgentScores(data.scores)
          }
        }
        if (data.type === 'telemetry' && data.data.length > 0) {
          const { addLatencyPoints } = useUIStore.getState();
          addLatencyPoints(data.data.map(p => ({ 
            agent_name: p.agent_name, 
            latency_ms: p.latency_ms 
          })));
        }
        onEventRef.current(data)
      } catch {
        console.error('Failed to parse WebSocket event', e.data)
      }
    }

    ws.onerror = (e) => console.error('WebSocket error', e)
    ws.onclose = () => console.log('WebSocket closed for room', roomId)

    wsRef.current = ws
  }, [roomId, onEvent])

  const send = useCallback((text: string, mentions?: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ text, mentions }))
    } else {
      console.warn('WebSocket not open — reconnecting...')
      connect()
    }
  }, [connect])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  return { connect, send, disconnect }
}
