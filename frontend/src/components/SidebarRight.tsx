import React, { useState, useEffect, useCallback } from 'react'
import { TelemetryPanel } from './TelemetryPanel'
import { apiFetch, apiJson, apiUrl } from '../lib/api'
import type { ScratchpadState, TelemetryEntry } from '../hooks/useArenaSocket'
import { useUIStore } from '../store/uiStore'

interface Agent {
  id: number
  name: string
  sort_order?: number | null
  role_description: string
  model: string
  provider: string
  token_budget: number
  is_active?: boolean
}

interface Props {
  roomId: number
  scratchpad?: ScratchpadState
  semanticLastUpdatedAt?: number | null
  telemetry?: { data: TelemetryEntry[]; budgets: Record<string, number> }
}

// Removed hardcoded ROOM_ID = 1

export const SidebarRight: React.FC<Props> = ({ roomId, scratchpad, semanticLastUpdatedAt, telemetry }) => {
  const {
    agentsRefreshKey,
    agentStatuses,
    agentBudgets,
  } = useUIStore()
  const hasContent = scratchpad && (scratchpad.consensus || scratchpad.open_questions.length > 0 || scratchpad.key_ideas.length > 0)
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const hasActiveRoom = roomId > 0

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const fetchAgents = useCallback(async () => {
    try {
      if (!roomId) {
        const data = await apiJson<Agent[]>('/api/agents/')
        setAgents(data.map((agent) => ({ ...agent, is_active: false })))
        return
      }

      const data = await apiJson<Agent[]>(`/api/rooms/${roomId}/agents`)
      setAgents(data)
    } catch {
      setAgents([])
    }
  }, [roomId])

  // Refetch when room changes
  useEffect(() => {
    fetchAgents()
  }, [fetchAgents, agentsRefreshKey])

  const toggleAgent = async (agentId: number) => {
    if (!roomId || loading) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/rooms/${roomId}/agents/${agentId}/toggle`, {
        method: 'POST'
      })
      if (res.ok) {
        await fetchAgents()
      }
    } finally {
      setLoading(false)
    }
  }

  const bulkActiveAgents = async (active: boolean) => {
    if (!roomId || loading) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/rooms/${roomId}/agents/bulk-active?active=${active}`, {
        method: 'POST'
      })
      if (res.ok) {
        await fetchAgents()
      }
    } finally {
      setLoading(false)
    }
  }

  const getAvatarUrl = (agent: Agent) =>
    apiUrl(`/api/avatars/generate-default?role_description=${encodeURIComponent(agent.role_description)}&agent_name=${encodeURIComponent(agent.name)}`)

  const getStatusColor = (status?: string) => {
    if (status === 'Speaking') return 'var(--accent-color)'
    if (status === 'Thinking') return '#3b82f6' // Blue
    if (status === 'Queued') return '#f59e0b' // Amber
    if (status === 'Skipped') return '#6b7280' // Gray
    if (status === 'Inactive') return '#4b5563' // Dark Gray
    return 'var(--text-secondary)'
  }

  const getChipBackground = (status?: string, isActive?: boolean) => {
    if (!isActive) return 'transparent'
    if (status === 'Speaking') return 'rgba(110, 89, 255, 0.15)' // Faint accent
    if (status === 'Thinking') return 'rgba(59, 130, 246, 0.1)'  // Faint blue
    if (status === 'Queued') return 'rgba(245, 158, 11, 0.1)'    // Faint amber
    return 'var(--bg-tertiary)'
  }

  const { agentActivity } = useUIStore()
  const totalActivity = Object.values(agentActivity).reduce((a, b) => a + b, 0)

  const formatSemanticUpdateTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }

  const getSemanticStatus = () => {
    if (!semanticLastUpdatedAt) {
      return {
        label: 'Awaiting',
        detail: 'Semantic status: awaiting first update',
        color: '#6b7280',
      }
    }

    const ageSeconds = Math.max(0, Math.floor((nowMs - semanticLastUpdatedAt) / 1000))
    if (ageSeconds <= 15) {
      return {
        label: 'Fresh',
        detail: `Semantic updated at ${formatSemanticUpdateTime(semanticLastUpdatedAt)}`,
        color: '#22c55e',
      }
    }

    return {
      label: 'Stale',
      detail: `Semantic last update at ${formatSemanticUpdateTime(semanticLastUpdatedAt)}`,
      color: '#f59e0b',
    }
  }

  const semanticStatus = getSemanticStatus()

  return (
    <aside className="agents-sidebar">
      {/* Active Roster */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
            Agent Roster
          </h3>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              onClick={(e) => { e.stopPropagation(); bulkActiveAgents(true); }}
              disabled={loading || !hasActiveRoom}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.65rem', borderRadius: '4px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              ALL
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); bulkActiveAgents(false); }}
              disabled={loading || !hasActiveRoom}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.65rem', borderRadius: '4px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              NONE
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
          {agents.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic', margin: 0 }}>No agents defined.</p>}
          {!hasActiveRoom && agents.length > 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', margin: '0 0 0.2rem 0' }}>
              Select a chat to enable agent participation.
            </p>
          )}
          {agents.map(agent => {
            const currentBudget = agentBudgets[agent.name] ?? agent.token_budget
            const isActive = hasActiveRoom ? Boolean(agent.is_active) : false
            const status = isActive ? (agentStatuses[agent.name] || 'Idle') : 'Inactive'
            const isProcessing = status === 'Thinking' || status === 'Speaking' || status === 'Queued'

            const count = agentActivity[agent.name] || 0
            const activityPercent = totalActivity > 0 ? (count / totalActivity) * 100 : 0

            return (
              <div
                key={agent.id}
                title={agent.role_description}
                onClick={() => {
                  if (!hasActiveRoom) return
                  toggleAgent(agent.id)
                }}
                style={{
                  padding: '0.75rem',
                  backgroundColor: getChipBackground(status, isActive),
                  border: isActive ? `1px solid ${isProcessing ? getStatusColor(status) : 'var(--border-color)'}` : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  cursor: hasActiveRoom ? 'pointer' : 'not-allowed',
                  opacity: isActive ? 1 : 0.4,
                  filter: isActive ? 'none' : 'grayscale(0.6)',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  boxShadow: isProcessing ? `0 0 10px ${getStatusColor(status)}22` : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <img src={getAvatarUrl(agent)} alt={agent.name} width={32} height={32} style={{
                        borderRadius: '50%',
                        flexShrink: 0,
                        border: isActive ? `2px solid ${getStatusColor(status)}` : '1px solid var(--border-color)',
                        animation: isProcessing ? 'pulse 1.5s infinite' : 'none'
                    }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: isActive ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {agent.name}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: getStatusColor(status), fontWeight: 'bold', textTransform: 'uppercase' }}>
                                {status}
                            </span>
                        </div>
                        {isActive && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.1rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                        Participation: {Math.round(activityPercent)}%
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {isActive && (
                  <div style={{ display: 'flex', gap: '2px', width: '100%', height: '4px', marginTop: '0.2rem' }}>
                    {Array.from({ length: agent.token_budget }).map((_, i) => {
                      const isFilled = i < currentBudget
                      return (
                        <div
                          key={i}
                          style={{
                            flex: 1,
                            backgroundColor: isFilled ? 'var(--accent-color)' : 'rgba(255,255,255,0.1)',
                            borderRadius: '1px',
                            transition: 'background-color 0.3s ease'
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary */}
      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', height: '240px', flexShrink: 0 }}>
        <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
          Summary
        </h3>
        <div style={{ margin: '0 0 0.55rem 0', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span
            title={`Semantic ${semanticStatus.label}`}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: semanticStatus.color,
              boxShadow: `0 0 10px ${semanticStatus.color}66`,
              flexShrink: 0,
            }}
          />
          <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {semanticStatus.detail}
          </p>
        </div>
        <div style={{ flex: 1, padding: '0.75rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', overflowY: 'auto', fontSize: '0.82rem', lineHeight: '1.6' }}>
          {hasContent ? (
            <>
              {scratchpad?.consensus && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Consensus</strong>
                  {scratchpad.consensus}
                </div>
              )}
              {scratchpad?.key_ideas && scratchpad.key_ideas.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Key Ideas</strong>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    {scratchpad.key_ideas.map((idea, i) => <li key={i}>{idea}</li>)}
                  </ul>
                </div>
              )}
              {scratchpad?.open_questions && scratchpad.open_questions.length > 0 && (
                <div>
                  <strong style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Open Questions</strong>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    {scratchpad.open_questions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontStyle: 'italic', fontSize: '0.8rem' }}>
              Start a discussion — the Semantic Agent will continuously update this whiteboard.
            </p>
          )}
        </div>
      </div>

      <TelemetryPanel latestData={telemetry?.data ?? []} />
    </aside>
  )
}
