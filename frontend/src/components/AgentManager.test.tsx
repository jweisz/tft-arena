import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AgentManager } from './AgentManager'
import { useUIStore } from '../store/uiStore'


describe('AgentManager', () => {
  beforeEach(() => {
    useUIStore.setState({
      isAgentManagerOpen: true,
      agentsRefreshKey: 0,
    })
  })

  it('creates a new agent persona and refreshes the roster', async () => {
    const user = userEvent.setup()
    const triggerAgentsRefresh = vi.spyOn(useUIStore.getState(), 'triggerAgentsRefresh')
    const fetchMock = vi.spyOn(global, 'fetch')

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ provider: 'ollama', models: ['llama3'] }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ name: 'Planner', emoji: '🧭', role_description: 'Makes plans.', relevance_instructions: 'Respond to planning requests.', system_prompt: 'stub' }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, name: 'Planner', sort_order: 1, role_description: 'Makes plans.', relevance_instructions: 'Respond to planning requests.', system_prompt: 'stub', emoji: '🧭', provider: 'ollama', model: 'llama3', token_budget: 3 }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 1, name: 'Planner', sort_order: 1, role_description: 'Makes plans.', relevance_instructions: 'Respond to planning requests.', system_prompt: 'stub', emoji: '🧭', provider: 'ollama', model: 'llama3', token_budget: 3 }] } as Response)

    render(<AgentManager />)

    await screen.findByText(/create your first persona/i)
    await user.click(screen.getByRole('button', { name: /^\+ create$/i }))
    await user.click(screen.getByRole('button', { name: /🧭 planner/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/'),
        expect.objectContaining({ method: 'POST' }),
      )
      expect(triggerAgentsRefresh).toHaveBeenCalled()
      expect(screen.getByText('Planner')).toBeInTheDocument()
    })

    fetchMock.mockRestore()
    triggerAgentsRefresh.mockRestore()
  })

  it('reorders agents via drag and drop and persists the new order', async () => {
    const triggerAgentsRefresh = vi.spyOn(useUIStore.getState(), 'triggerAgentsRefresh')
    const fetchMock = vi.spyOn(global, 'fetch')

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 1, name: 'Analyst', sort_order: 1, role_description: 'Analyzes.', relevance_instructions: '', system_prompt: 'stub', emoji: '🧠', provider: 'ollama', model: 'llama3', token_budget: 3 },
        { id: 2, name: 'Muse', sort_order: 2, role_description: 'Imagines.', relevance_instructions: '', system_prompt: 'stub', emoji: '💡', provider: 'ollama', model: 'llama3', token_budget: 3 },
      ] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ provider: 'ollama', models: ['llama3'] }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 2, name: 'Muse', sort_order: 1, role_description: 'Imagines.', relevance_instructions: '', system_prompt: 'stub', emoji: '💡', provider: 'ollama', model: 'llama3', token_budget: 3 },
        { id: 1, name: 'Analyst', sort_order: 2, role_description: 'Analyzes.', relevance_instructions: '', system_prompt: 'stub', emoji: '🧠', provider: 'ollama', model: 'llama3', token_budget: 3 },
      ] } as Response)

    render(<AgentManager />)

    await screen.findByText('Analyst')
    const analystDragHandle = screen.getByLabelText('Drag Analyst')
    const museCard = screen.getByText('Muse').closest('div[draggable="true"]')

    expect(museCard).not.toBeNull()
    fireEvent.dragStart(analystDragHandle.closest('div[draggable="true"]') as HTMLElement)
    fireEvent.dragOver(museCard as HTMLElement)
    fireEvent.drop(museCard as HTMLElement)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/reorder'),
        expect.objectContaining({ method: 'POST' }),
      )
      expect(triggerAgentsRefresh).toHaveBeenCalled()
    })

    fetchMock.mockRestore()
    triggerAgentsRefresh.mockRestore()
  })

  it('applies a selected model to all agents', async () => {
    const user = userEvent.setup()
    const triggerAgentsRefresh = vi.spyOn(useUIStore.getState(), 'triggerAgentsRefresh')
    const fetchMock = vi.spyOn(global, 'fetch')

    const initialAgents = [
      { id: 1, name: 'Analyst', sort_order: 1, role_description: 'Analyzes.', relevance_instructions: '', system_prompt: 'stub', emoji: '🧠', provider: 'ollama', model: 'llama3', token_budget: 3 },
      { id: 2, name: 'Muse', sort_order: 2, role_description: 'Imagines.', relevance_instructions: '', system_prompt: 'stub', emoji: '💡', provider: 'ollama', model: 'llama3', token_budget: 3 },
    ]

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => initialAgents } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ provider: 'ollama', models: ['llama3', 'llama3.1'] }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...initialAgents[0], model: 'llama3.1' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...initialAgents[1], model: 'llama3.1' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { ...initialAgents[0], model: 'llama3.1' },
        { ...initialAgents[1], model: 'llama3.1' },
      ] } as Response)

    render(<AgentManager />)

    await screen.findByText('Analyst')
    await user.click(screen.getByRole('button', { name: /advanced/i }))

    const selector = screen.getByLabelText(/bulk model selector/i) as HTMLSelectElement
    await user.selectOptions(selector, 'ollama::llama3.1')
    expect(selector.value).toBe('ollama::llama3.1')

    await user.click(screen.getByRole('button', { name: /apply to all/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/1'),
        expect.objectContaining({ method: 'PUT' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/2'),
        expect.objectContaining({ method: 'PUT' }),
      )
      expect(triggerAgentsRefresh).toHaveBeenCalled()
    })

    fetchMock.mockRestore()
    triggerAgentsRefresh.mockRestore()
  })

  it('creates all default agents from presets that are missing', async () => {
    const user = userEvent.setup()
    const triggerAgentsRefresh = vi.spyOn(useUIStore.getState(), 'triggerAgentsRefresh')
    const fetchMock = vi.spyOn(global, 'fetch')

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ provider: 'ollama', models: ['llama3'] }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { name: 'Planner', emoji: '🧭', role_description: 'Makes plans.', relevance_instructions: 'Respond to planning requests.', system_prompt: 'planner prompt' },
        { name: 'Skeptic', emoji: '🧐', role_description: 'Challenges assumptions.', relevance_instructions: 'Respond to risky ideas.', system_prompt: 'skeptic prompt' },
      ] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, name: 'Planner', sort_order: 1, role_description: 'Makes plans.', relevance_instructions: 'Respond to planning requests.', system_prompt: 'planner prompt', emoji: '🧭', provider: 'ollama', model: 'llama3', token_budget: 3 }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 2, name: 'Skeptic', sort_order: 2, role_description: 'Challenges assumptions.', relevance_instructions: 'Respond to risky ideas.', system_prompt: 'skeptic prompt', emoji: '🧐', provider: 'ollama', model: 'llama3', token_budget: 3 }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 1, name: 'Planner', sort_order: 1, role_description: 'Makes plans.', relevance_instructions: 'Respond to planning requests.', system_prompt: 'planner prompt', emoji: '🧭', provider: 'ollama', model: 'llama3', token_budget: 3 },
        { id: 2, name: 'Skeptic', sort_order: 2, role_description: 'Challenges assumptions.', relevance_instructions: 'Respond to risky ideas.', system_prompt: 'skeptic prompt', emoji: '🧐', provider: 'ollama', model: 'llama3', token_budget: 3 },
      ] } as Response)

    render(<AgentManager />)

    await screen.findByText(/create your first persona/i)
    await user.click(screen.getByRole('button', { name: /advanced/i }))
    await user.click(screen.getByRole('button', { name: /create all default agents/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(2)
      expect(triggerAgentsRefresh).toHaveBeenCalled()
    })

    await user.click(screen.getByRole('button', { name: /^agents$/i }))
    expect(await screen.findByText('Planner')).toBeInTheDocument()
    expect(screen.getByText('Skeptic')).toBeInTheDocument()

    fetchMock.mockRestore()
    triggerAgentsRefresh.mockRestore()
  })

  it('removes all agents from the advanced tab', async () => {
    const user = userEvent.setup()
    const triggerAgentsRefresh = vi.spyOn(useUIStore.getState(), 'triggerAgentsRefresh')
    const fetchMock = vi.spyOn(global, 'fetch')
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true)

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 1, name: 'Analyst', sort_order: 1, role_description: 'Analyzes.', relevance_instructions: '', system_prompt: 'stub', emoji: '🧠', provider: 'ollama', model: 'llama3', token_budget: 3 },
        { id: 2, name: 'Muse', sort_order: 2, role_description: 'Imagines.', relevance_instructions: '', system_prompt: 'stub', emoji: '💡', provider: 'ollama', model: 'llama3', token_budget: 3 },
      ] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ provider: 'ollama', models: ['llama3'] }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Agent 1 deleted' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Agent 2 deleted' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)

    render(<AgentManager />)

    await screen.findByText('Analyst')
    await user.click(screen.getByRole('button', { name: /advanced/i }))
    await user.click(screen.getByRole('button', { name: /remove all agents/i }))

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/1'),
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/2'),
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(triggerAgentsRefresh).toHaveBeenCalled()
      expect(screen.queryByText('Analyst')).not.toBeInTheDocument()
    })

    confirmMock.mockRestore()
    fetchMock.mockRestore()
    triggerAgentsRefresh.mockRestore()
  })

  it('downloads an agent persona markdown spec', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(global, 'fetch')
    const createObjectUrlMock = vi.fn(() => 'blob:agent-spec')
    const revokeObjectUrlMock = vi.fn()
    const anchorClickMock = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectUrlMock,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectUrlMock,
    })

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { id: 1, name: 'Analyst', sort_order: 1, role_description: 'Analyzes.', relevance_instructions: 'Respond to analysis.', system_prompt: 'Analyze deeply.', emoji: '🧠', provider: 'ollama', model: 'llama3', token_budget: 3 },
      ] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ provider: 'ollama', models: ['llama3'] }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)

    render(<AgentManager />)

    await screen.findByText('Analyst')
    await user.click(screen.getByRole('button', { name: /download analyst markdown/i }))

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:agent-spec')

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    })
    anchorClickMock.mockRestore()
    fetchMock.mockRestore()
  })

  it('imports an agent persona markdown file into the editor form', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(global, 'fetch')
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => undefined)

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ provider: 'ollama', models: ['llama3.1'] }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)

    render(<AgentManager />)

    await screen.findByText(/create your first persona/i)

    const markdown = `---
name: "Systems Thinker"
emoji: "🧩"
role_description: "Maps interdependencies and second-order effects."
relevance_instructions: |
  Respond when the user asks about interacting systems.
---
Surface trade-offs and feedback loops.`

    const file = new File([markdown], 'systems-thinker.md', { type: 'text/markdown' })
    const input = screen.getByLabelText(/import agent persona markdown/i)
    await user.upload(input, file)

    expect(await screen.findByDisplayValue('Systems Thinker')).toBeInTheDocument()
    expect(screen.getByDisplayValue('🧩')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Maps interdependencies and second-order effects.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Respond when the user asks about interacting systems.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Surface trade-offs and feedback loops.')).toBeInTheDocument()
    expect(alertMock).not.toHaveBeenCalled()

    alertMock.mockRestore()
    fetchMock.mockRestore()
  })
})
