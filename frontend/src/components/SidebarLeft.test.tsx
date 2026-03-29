import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SidebarLeft } from './SidebarLeft'
import { useUIStore } from '../store/uiStore'


describe('SidebarLeft', () => {
  beforeEach(() => {
    useUIStore.setState({
      streamingAgents: new Set(),
      agentStatuses: {},
      generationInProgress: false,
      isSettingsOpen: false,
      isAgentManagerOpen: false,
      isProfileOpen: false,
    })
  })

  it('loads rooms and auto-selects the first room when none is selected', async () => {
    const onSelectRoom = vi.fn()
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 101, name: 'Alpha Room', created_at: '2026-03-28T00:00:00Z' },
        { id: 102, name: 'Beta Room', created_at: '2026-03-27T00:00:00Z' },
      ],
    } as Response)

    render(<SidebarLeft selectedRoomId={0} onSelectRoom={onSelectRoom} />)

    expect(await screen.findByText('Alpha Room')).toBeInTheDocument()

    await waitFor(() => {
      expect(onSelectRoom).toHaveBeenCalledWith(101)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/rooms/'),
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    fetchMock.mockRestore()
  })

  it('shows emergency stop while generation is active and calls the endpoint', async () => {
    const onSelectRoom = vi.fn()
    useUIStore.setState({ generationInProgress: true })

    const fetchMock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 101, name: 'Alpha Room', created_at: '2026-03-28T00:00:00Z' }],
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)

    render(<SidebarLeft selectedRoomId={101} onSelectRoom={onSelectRoom} />)

    expect(await screen.findByText('Alpha Room')).toBeInTheDocument()
    const stopButton = screen.getByRole('button', { name: /emergency stop/i })
    fireEvent.click(stopButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/rooms/101/emergency-stop'),
        expect.objectContaining({ method: 'POST', headers: expect.any(Headers) }),
      )
    })

    fetchMock.mockRestore()
  })
})
