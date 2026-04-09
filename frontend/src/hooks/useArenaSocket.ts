import { useCallback, useEffect, useRef } from 'react'
import { wsUrlWithAuth } from '../lib/api'
import { useUIStore, type AgentStatus } from '../store/uiStore'

export interface TelemetryEntry {
  agent_name: string
  tokens_used: number
  latency_ms: number
  turn: number
}

export interface InferenceProcessStatus {
  process_id: string
  process_kind: 'agent' | 'router' | 'semantic'
  process_label: string
  provider: string
  model: string
  loaded: boolean
  active: boolean
  tokens_per_sec: number | null
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
  | { type: 'inference_status'; processes: InferenceProcessStatus[] }
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
  const connectRef = useRef<() => void>(() => {})
  const shouldReconnectRef = useRef(true)
  const reconnectTimerRef = useRef<number | null>(null)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return

    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    const ws = new WebSocket(wsUrlWithAuth(`/api/chat/${roomId}/stream`))

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WSEvent
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
    ws.onclose = () => {
      console.log('WebSocket closed for room', roomId)
      wsRef.current = null
      if (!shouldReconnectRef.current) {
        return
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connectRef.current()
      }, 800)
    }

    wsRef.current = ws
  }, [roomId])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const send = useCallback((text: string, mentions?: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ text, mentions }))
    } else {
      console.warn('WebSocket not open — reconnecting...')
      connect()
    }
  }, [connect])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  useEffect(() => {
    shouldReconnectRef.current = true
    return () => {
      shouldReconnectRef.current = false
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }
  }, [roomId])

  return { connect, send, disconnect }
}
