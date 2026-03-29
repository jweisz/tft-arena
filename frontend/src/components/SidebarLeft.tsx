import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Settings, Hexagon, Users, MoreHorizontal } from 'lucide-react'
import { ApiError, apiFetch, apiJson, apiText, getErrorMessage } from '../lib/api'
import { useUIStore } from '../store/uiStore'

interface Room {
  id: number
  name: string
  created_at: string
}

interface Props {
  selectedRoomId: number
  onSelectRoom: (id: number) => void
}

const ADJECTIVES = ['Silent', 'Misty', 'Neon', 'Crimson', 'Emerald', 'Vast', 'Swift', 'Deep', 'Ancient', 'Infinite']
const NOUNS = ['Peak', 'Valley', 'Tide', 'Void', 'Gate', 'Path', 'Stream', 'Crown', 'Light', 'Echo']

export const SidebarLeft: React.FC<Props> = ({ selectedRoomId, onSelectRoom }) => {
  const { toggleSettings, toggleAgentManager, streamingAgents, agentStatuses, generationInProgress } = useUIStore()
  const hasNonIdleStatus = Object.values(agentStatuses).some((status) => status !== 'Idle')
  const isGenerating = generationInProgress || streamingAgents.size > 0 || hasNonIdleStatus
  const [rooms, setRooms] = useState<Room[]>([])

  // Renaming state
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renamingName, setRenamingName] = useState('')

  // Menu state (which room has its menu open)
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const fetchRooms = useCallback(async () => {
    try {
      const data = await apiJson<Room[]>('/api/rooms/')
      setRooms(data)
      return data
    } catch { return [] }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadRooms = async () => {
      try {
        const data = await apiJson<Room[]>('/api/rooms/')
        if (cancelled) {
          return
        }

        setRooms(data)
      } catch {
        if (!cancelled) {
          setRooms([])
        }
      }
    }

    void loadRooms()

    return () => {
      cancelled = true
    }
  }, [])

  // Auto-select first room if none selected
  useEffect(() => {
    if (selectedRoomId === 0 && rooms.length > 0) {
      onSelectRoom(rooms[0].id)
    }
  }, [selectedRoomId, rooms, onSelectRoom])

  const generateRandomName = () => {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    return `${adj} ${noun}`
  }

  const createRoom = async () => {
    const name = generateRandomName()
    try {
      const created = await apiJson<Room>('/api/rooms/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      await fetchRooms()
      onSelectRoom(created.id)
    } catch (error) {
      console.error('Create room failed:', error)
    }
  }

  const deleteRoom = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const res = await apiFetch(`/api/rooms/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new ApiError(res.status, await res.text().catch(() => 'Unknown error'))
      }
      const updatedRooms = await fetchRooms()
      setMenuOpenId(null)
      setConfirmDeleteId(null)
      if (id === selectedRoomId) {
        const nextRoomId = updatedRooms && updatedRooms.length > 0 ? updatedRooms[0].id : 0
        onSelectRoom(nextRoomId)
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert(`Failed to delete chat: ${getErrorMessage(error, 'Internal error')}`)
    }
  }

  const handleStartRename = (room: Room, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingId(room.id)
    setRenamingName(room.name)
    setMenuOpenId(null)
  }

  const submitRename = async () => {
    if (!renamingId || !renamingName.trim()) {
      setRenamingId(null)
      return
    }
    try {
      await apiJson<Room>(`/api/rooms/${renamingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renamingName.trim() }),
      })
      await fetchRooms()
    } catch (error) {
      console.error('Rename failed:', error)
    }
    setRenamingId(null)
  }

  const exportRoom = async (id: number, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    let md = ''
    try {
      md = await apiText(`/api/rooms/${id}/messages/export`)
    } catch {
      return
    }
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/\s+/g, '-').toLowerCase()}-export.md`
    a.click()
    URL.revokeObjectURL(url)
    setMenuOpenId(null)
  }

  const triggerEmergencyStop = async () => {
    if (!selectedRoomId) return
    await apiFetch(`/api/rooms/${selectedRoomId}/emergency-stop`, { method: 'POST' }).catch(console.error)
  }

  // Handle clicking outside to close menu
  useEffect(() => {
    const handleClick = () => {
      setMenuOpenId(null)
      setConfirmDeleteId(null)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  return (
    <aside className="nav-sidebar">
      <div style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          TFT Arena
        </h2>
      </div>

      <div style={{ marginTop: '1rem', flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h3 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Chats
          </h3>
          <button
            onClick={createRoom}
            style={{
              padding: '2px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Plus size={16} />
          </button>
        </div>

        {rooms.length === 0 && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>No chats yet.</p>}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {rooms.map(room => (
            <li
              key={room.id}
              onClick={() => onSelectRoom(room.id)}
              style={{
                padding: '0.6rem 0.75rem',
                backgroundColor: room.id === selectedRoomId ? 'var(--bg-tertiary)' : 'transparent',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderLeft: room.id === selectedRoomId ? '2px solid var(--accent-color)' : '2px solid transparent',
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
            >
              {renamingId === room.id ? (
                <input
                  autoFocus
                  style={{
                    flex: 1,
                    fontSize: '0.9rem',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--accent-color)',
                    color: 'var(--text-primary)',
                    padding: '1px 4px',
                    borderRadius: '2px'
                  }}
                  value={renamingName}
                  onChange={e => setRenamingName(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') submitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {room.name}
                  </span>

                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuOpenId(current => current === room.id ? null : room.id)
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        color: 'var(--text-secondary)',
                        opacity: room.id === selectedRoomId || menuOpenId === room.id ? 1 : 0.4
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>

                    {menuOpenId === room.id && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          backgroundColor: '#252529',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          zIndex: 100,
                          minWidth: '120px',
                          padding: '0.4rem',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                          animation: 'fadeSlideIn 0.1s ease'
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        <div
                          className="menu-item"
                          onClick={(e) => handleStartRename(room, e)}
                          style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '4px' }}
                        >
                          Rename
                        </div>
                        <div
                          className="menu-item"
                          onClick={(e) => exportRoom(room.id, room.name, e)}
                          style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '4px' }}
                        >
                          Export MD
                        </div>
                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '0.3rem 0' }} />
                        {confirmDeleteId === room.id ? (
                          <div
                            className="menu-item"
                            onClick={(e) => deleteRoom(room.id, e)}
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#ef4444', color: '#fff', borderRadius: '4px', fontWeight: 'bold' }}
                          >
                            Confirm Delete?
                          </div>
                        ) : (
                          <div
                            className="menu-item"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(room.id); }}
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', borderRadius: '4px' }}
                          >
                            Delete Chat
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {isGenerating && (
          <button
            onClick={triggerEmergencyStop}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              fontSize: '0.85rem', backgroundColor: '#ef4444', color: '#fff', border: 'none', fontWeight: 'bold'
            }}
          >
            <Hexagon size={14} fill="currentColor" /> Emergency Stop
          </button>
        )}
        <button
          onClick={toggleAgentManager}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
        >
          <Users size={14} /> Agent Management
        </button>
        <button
          onClick={toggleSettings}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
        >
          <Settings size={14} /> Settings
        </button>
      </div>
    </aside>
  )
}
