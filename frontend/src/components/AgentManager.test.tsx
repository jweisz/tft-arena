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
    await user.click(screen.getByRole('button', { name: /create new agent persona/i }))
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
})