import { renderHook, waitFor } from '@testing-library/react'

import { useArenaSocket } from './useArenaSocket'
import { useUIStore } from '../store/uiStore'


class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1

  url: string
  readyState = MockWebSocket.OPEN
  sentMessages: string[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(message: string) {
    this.sentMessages.push(message)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  emitJson(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}


describe('useArenaSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    useUIStore.setState({
      agentStatuses: {},
      agentScores: {},
      agentReasons: {},
      latencyHistory: {},
      agentActivity: {},
      streamingAgents: new Set(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('connects, forwards events, and updates store for status and telemetry payloads', async () => {
    const onEvent = vi.fn()
    const { result } = renderHook(() => useArenaSocket({ roomId: 42, onEvent }))

    result.current.connect()

    expect(MockWebSocket.instances).toHaveLength(1)
    const socket = MockWebSocket.instances[0]
    expect(socket.url).toContain('/api/chat/42/stream')

    socket.emitJson({
      type: 'status_update',
      statuses: { Analyst: 'Thinking' },
      scores: { Analyst: 8.5 },
      reasons: { Analyst: 'Strong match.' },
    })
    socket.emitJson({
      type: 'telemetry',
      data: [{ agent_name: 'Analyst', latency_ms: 12.3, tokens_used: 4, turn: 1 }],
      budgets: { Analyst: 2 },
    })

    await waitFor(() => {
      expect(useUIStore.getState().agentStatuses.Analyst).toBe('Thinking')
      expect(useUIStore.getState().agentScores.Analyst).toBe(8.5)
      expect(useUIStore.getState().agentReasons.Analyst).toBe('Strong match.')
      expect(useUIStore.getState().latencyHistory.Analyst).toEqual([12.3])
    })

    expect(onEvent).toHaveBeenCalledTimes(2)
  })

  it('sends messages and disconnects cleanly', () => {
    const onEvent = vi.fn()
    const { result } = renderHook(() => useArenaSocket({ roomId: 7, onEvent }))

    result.current.connect()
    const socket = MockWebSocket.instances[0]

    result.current.send('hello', ['Analyst'])
    expect(socket.sentMessages).toEqual(['{"text":"hello","mentions":["Analyst"]}'])

    result.current.disconnect()
    expect(socket.readyState).toBe(3)
  })
})
