import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsModal } from './SettingsModal'
import { useUIStore } from '../store/uiStore'


describe('SettingsModal', () => {
  beforeEach(() => {
    useUIStore.setState({
      isSettingsOpen: true,
      palette: 'premium-dark',
      themeFont: 'modern',
    })
  })

  it('loads settings and saves updated arena behavior', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(global, 'fetch')

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ollama_base_url: 'http://ollama.local:11434',
          default_agent_turn_budget: 5,
          global_system_instruction: 'Be concise.',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ provider: 'ollama', models: ['llama3'] }],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'updated' }),
      } as Response)

    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: /model providers/i }))
    await screen.findByDisplayValue('http://ollama.local:11434')
    await user.click(screen.getByRole('button', { name: /arena behavior/i }))

    const budgetInput = screen.getByDisplayValue('5')
    fireEvent.change(budgetInput, { target: { value: '8' } })

    const instructionInput = screen.getByDisplayValue('Be concise.')
    await user.clear(instructionInput)
    await user.type(instructionInput, 'Push toward evidence.')

    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining('/api/settings/'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ollama_base_url: 'http://ollama.local:11434',
            default_agent_turn_budget: 8,
            global_system_instruction: 'Push toward evidence.',
            non_agent_provider: 'ollama',
            non_agent_model: 'llama3',
          }),
        }),
      )
    })

    fetchMock.mockRestore()
  })

})
