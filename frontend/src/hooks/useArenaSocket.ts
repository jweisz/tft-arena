import { useCallback, useEffect, useRef } from 'react'
import { wsUrlWithAuth } from '../lib/api'
import { useUIStore, type AgentStatus } from '../store/uiStore'

export interface TelemetryEntry {
  agent_name: string
  tokens_used: number
  latency_ms: number
  turn: number
}

export interface ScratchpadState {
  consensus: string
  open_questions: string[]
  key_ideas: string[]
}

export type WSEvent =
  | { type: 'token'; agent: string; token: string }
  | { type: 'agent_message_done'; agent: string; content?: string }
  | { type: 'thinking'; agent: string }
  | { type: 'done' }
  | { type: 'interrupted' }
  | { type: 'error'; error: string }
  | { type: 'telemetry'; data: TelemetryEntry[]; budgets: Record<string, number> }
  | { type: 'budget_update'; budgets: Record<string, number> }
  | { type: 'activity_stats'; stats: Record<string, number> }
  | { type: 'semantic'; annotations: Array<Record<string, unknown>>; scratchpad: ScratchpadState }
  | { type: 'status_update'; statuses: Record<string, AgentStatus>; scores?: Record<string, number>; reasons?: Record<string, string>; emojis?: Record<string, string> }

interface UseArenaSocketOptions {
  roomId: number
  onEvent: (event: WSEvent) => void
}

export function useArenaSocket({ roomId, onEvent }: UseArenaSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(wsUrlWithAuth(`/api/chat/${roomId}/stream`))

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WSEvent
        if (data.type === 'status_update') {
          const { updateAgentStatus, setAgentScores } = useUIStore.getState()
          Object.entries(data.statuses).forEach(([name, status]) => {
            updateAgentStatus(name, status)
          })
          if (data.scores) {
            setAgentScores(data.scores)
          }
          if (data.reasons) {
            useUIStore.getState().setAgentReasons(data.reasons)
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
  }, [roomId])

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
