import { act, render, screen, waitFor } from '@testing-library/react'

import { ChatArea } from './ChatArea'
import { useUIStore } from '../store/uiStore'


const hookState: {
  onEvent?: ((event: import('../hooks/useArenaSocket').WSEvent) => void)
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
} = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(),
}

vi.mock('./MentionInput', () => ({
  MentionInput: ({ onSend }: { onSend: (text: string, mentions?: string[]) => void }) => (
    <button onClick={() => onSend('Hello arena', ['Analyst'])}>Send mock message</button>
  ),
}))

vi.mock('../hooks/useTypingAudio', () => ({
  useTypingAudio: () => ({ playTick: vi.fn() }),
}))

vi.mock('../hooks/useArenaSocket', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useArenaSocket')>('../hooks/useArenaSocket')
  return {
    ...actual,
    useArenaSocket: ({ onEvent }: { onEvent: (event: import('../hooks/useArenaSocket').WSEvent) => void }) => {
      hookState.onEvent = onEvent
      return {
        connect: hookState.connect,
        disconnect: hookState.disconnect,
        send: hookState.send,
      }
    },
  }
})


describe('ChatArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      streamingAgents: new Set(),
      generationInProgress: false,
      agentStatuses: {},
      agentBudgets: {},
      agentActivity: {},
      agentScores: {},
      agentReasons: {},
      latencyHistory: {},
    })
    Element.prototype.scrollTo = vi.fn()
  })

  it('loads transcript history and connects the socket for an active room', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, role: 'human', content: 'Hi there' },
        { id: 2, role: 'agent', content: 'Hello back', agent: { name: 'Analyst' } },
      ],
    } as Response)

    render(<ChatArea roomId={12} />)

    expect(await screen.findByText('Hi there')).toBeInTheDocument()
    expect(screen.getByText('Hello back')).toBeInTheDocument()
    expect(hookState.connect).toHaveBeenCalledTimes(1)

    fetchMock.mockRestore()
  })

  it('responds to socket events and forwards telemetry and scratchpad updates', async () => {
    const onScratchpadUpdate = vi.fn()
    const onTelemetryUpdate = vi.fn()
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)

    render(
      <ChatArea
        roomId={3}
        onScratchpadUpdate={onScratchpadUpdate}
        onTelemetryUpdate={onTelemetryUpdate}
      />,
    )

    await screen.findByText(/welcome to the arena/i)
    await act(async () => {
      hookState.onEvent?.({ type: 'token', agent: 'Analyst', token: 'Streaming reply' })
      hookState.onEvent?.({
        type: 'telemetry',
        data: [{ agent_name: 'Analyst', latency_ms: 17.2, tokens_used: 8, turn: 1 }],
        budgets: { Analyst: 2 },
      })
      hookState.onEvent?.({
        type: 'semantic',
        annotations: [],
        scratchpad: { consensus: 'Aligned', open_questions: [], key_ideas: ['Streaming reply'] },
      })
      hookState.onEvent?.({ type: 'done' })
    })

    await waitFor(() => {
      expect(screen.getByText('Streaming reply')).toBeInTheDocument()
      expect(onTelemetryUpdate).toHaveBeenCalledWith(
        [{ agent_name: 'Analyst', latency_ms: 17.2, tokens_used: 8, turn: 1 }],
        { Analyst: 2 },
      )
      expect(onScratchpadUpdate).toHaveBeenCalledWith({
        consensus: 'Aligned',
        open_questions: [],
        key_ideas: ['Streaming reply'],
      })
    })

    fetchMock.mockRestore()
  })

  it('starts a new chat bubble when the same agent speaks again in one turn', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)

    render(<ChatArea roomId={3} />)

    await screen.findByText(/welcome to the arena/i)
    await act(async () => {
      hookState.onEvent?.({ type: 'token', agent: 'Analyst', token: 'First reply' })
      hookState.onEvent?.({ type: 'agent_message_done', agent: 'Analyst' })
      hookState.onEvent?.({ type: 'token', agent: 'Analyst', token: 'Second reply' })
      hookState.onEvent?.({ type: 'agent_message_done', agent: 'Analyst' })
      hookState.onEvent?.({ type: 'done' })
    })

    await waitFor(() => {
      const analystLabels = screen.getAllByText('Analyst')
      expect(analystLabels).toHaveLength(2)
      expect(screen.getByText('First reply')).toBeInTheDocument()
      expect(screen.getByText('Second reply')).toBeInTheDocument()
    })

    fetchMock.mockRestore()
  })

  it('sanitizes leaked transcript markers from agent output', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)

    render(<ChatArea roomId={3} />)

    await screen.findByText(/welcome to the arena/i)
    await act(async () => {
      hookState.onEvent?.({
        type: 'token',
        agent: 'Ethos Architect',
        token: 'AI amplifies human potential.\n### User: Why climate?\n\nAssistant:\n\nMore text',
      })
      hookState.onEvent?.({
        type: 'agent_message_done',
        agent: 'Ethos Architect',
        content: 'AI amplifies human potential.',
      })
      hookState.onEvent?.({ type: 'done' })
    })

    await waitFor(() => {
      expect(screen.getByText('AI amplifies human potential.')).toBeInTheDocument()
      expect(screen.queryByText(/### User:/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/^Assistant:$/i)).not.toBeInTheDocument()
    })

    fetchMock.mockRestore()
  })
})