import React, { useState, useEffect } from 'react'

import { apiFetch, apiJson, apiUrl, getErrorMessage } from '../lib/api'
import { useUIStore } from '../store/uiStore'

interface Agent {
  id?: number
  name: string
  sort_order?: number | null
  role_description: string
  relevance_instructions: string
  system_prompt: string
  emoji: string
  model: string
  provider: string
  token_budget: number
}

const DEFAULT_AGENT: Agent = {
  name: '',
  role_description: '',
  relevance_instructions: '',
  system_prompt: '',
  emoji: '🤖',
  model: 'llama3',
  provider: 'ollama',
  token_budget: 3,
}

interface ProviderModel {
  provider: string
  models: string[]
}

const encodeModelSelection = (provider: string, model: string) => `${provider}::${encodeURIComponent(model)}`

const decodeModelSelection = (value: string): { provider: string; model: string } => {
  const sepIndex = value.indexOf('::')
  if (sepIndex === -1) {
    return { provider: 'ollama', model: value }
  }
  const provider = value.slice(0, sepIndex)
  const model = decodeURIComponent(value.slice(sepIndex + 2))
  return { provider, model }
}

export const AgentManager: React.FC = () => {
  const { isAgentManagerOpen, toggleAgentManager, triggerAgentsRefresh } = useUIStore()
  const [agents, setAgents] = useState<Agent[]>([])
  const [editing, setEditing] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(false)
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([])
  const [presets, setPresets] = useState<Array<Pick<Agent, 'name' | 'emoji' | 'role_description' | 'relevance_instructions' | 'system_prompt'>>>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [draggedAgentId, setDraggedAgentId] = useState<number | null>(null)
  const [dragOverAgentId, setDragOverAgentId] = useState<number | null>(null)
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)

  const buildFullPrompt = (agent: Agent, globalInstr = ''): string => {
    const parts: string[] = []
    if (globalInstr) parts.push(`MISSION CONSTRAINT:\n${globalInstr}`)
    parts.push(`ROLE PROFILE:\n${agent.role_description || '(empty)'}\n\nPERSONA INSTRUCTION:\n${agent.system_prompt || '(empty)'}\n\nCORE CHAT PROTOCOL:\n- SPEAK ONLY AS YOURSELF (${agent.name || 'Agent'}).\n- DO NOT write lines, dialogue, or reactions for any other agent.\n- PROVIDE EXACTLY ONE UTTERANCE. Do not simulate a conversation.\n- STOP IMMEDIATELY after your own point is made.\n- DO NOT prefix your response with your name or any label (e.g., '${agent.name || 'Agent'}:').\n- Start your response directly with the content of your message.`)
    if (globalInstr) parts.push(`FINAL REMINDER:\n${globalInstr}`)
    parts.push('USER BACKGROUND:\n(injected at runtime)')
    parts.push('PAST CONVERSATION MEMORIES:\n(injected at runtime)')
    return parts.join('\n\n')
  }

  const fetchAgents = async () => {
    try {
      setAgents(await apiJson<Agent[]>('/api/agents/'))
    } catch { /* No agents found */ }
  }

  const persistAgentOrder = async (orderedAgents: Agent[]) => {
    const orderedIds = orderedAgents.map((agent) => agent.id).filter((id): id is number => id !== undefined)
    if (orderedIds.length !== orderedAgents.length) {
      return
    }

    const updated = await apiJson<Agent[]>('/api/agents/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_ids: orderedIds }),
    })
    setAgents(updated)
    triggerAgentsRefresh()
  }

  const moveAgent = async (fromId: number, toId: number) => {
    if (fromId === toId) {
      return
    }

    const previousAgents = agents
    const fromIndex = previousAgents.findIndex((agent) => agent.id === fromId)
    const toIndex = previousAgents.findIndex((agent) => agent.id === toId)

    if (fromIndex === -1 || toIndex === -1) {
      return
    }

    const reorderedAgents = [...previousAgents]
    const [movedAgent] = reorderedAgents.splice(fromIndex, 1)
    reorderedAgents.splice(toIndex, 0, movedAgent)
    setAgents(reorderedAgents)

    try {
      await persistAgentOrder(reorderedAgents)
    } catch (error) {
      console.error('Failed to reorder agents:', error)
      setAgents(previousAgents)
      alert(`Failed to reorder agents: ${getErrorMessage(error, 'Internal server error')}`)
    }
  }

  const fetchModels = async () => {
    try {
      setAvailableModels(await apiJson<ProviderModel[]>('/api/providers/models'))
    } catch { console.error("Failed to fetch models") }
  }

  const fetchPresets = async () => {
    try {
      setPresets(await apiJson<Array<Pick<Agent, 'name' | 'emoji' | 'role_description' | 'relevance_instructions' | 'system_prompt'>>>('/api/agents/presets'))
    } catch { console.error("Failed to fetch presets") }
  }

  useEffect(() => {
    if (isAgentManagerOpen) {
      fetchAgents()
      fetchModels()
      fetchPresets()
    } else {
      setConfirmDeleteId(null)
    }
  }, [isAgentManagerOpen])

  // Get a flat list of all models for the unified dropdown
  const allModels = availableModels.flatMap(p =>
    p.models.map(m => ({ provider: p.provider, model: m }))
  )

  const save = async () => {
    if (!editing) return
    setLoading(true)

    // Auto-generate system prompt if empty
    const payload = { ...editing }
    if (!payload.system_prompt) {
      payload.system_prompt = `You are ${payload.name}. Your role is: ${payload.role_description}. Always stay in character.`
    }

    console.log('[AGENT MANAGER] Saving agent...', payload)
    try {
      const url = payload.id
        ? `/api/agents/${payload.id}`
        : '/api/agents/'
      const method = payload.id ? 'PUT' : 'POST'

      console.log(`[AGENT MANAGER] ${method} to ${url}`)
      await apiJson<Agent>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await fetchAgents()
      triggerAgentsRefresh()
      setEditing(null)
      setPromptPreviewOpen(false)
    } catch (err) {
      console.error('Network error during save:', err)
      alert(`Failed to save agent persona: ${getErrorMessage(err, 'Internal server error')}`)
    } finally { setLoading(false) }
  }

  const remove = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      console.log(`Sending DELETE for agent ${id}...`)
      await apiFetch(`/api/agents/${id}`, { method: 'DELETE' }).then(async (res) => {
        if (!res.ok) {
          throw new Error(getErrorMessage(await res.json().catch(() => undefined), 'Unknown error'))
        }
      })
      console.log(`Agent ${id} deleted successfully.`)
      setConfirmDeleteId(null)
      await fetchAgents()
      triggerAgentsRefresh()
    } catch (err) {
      console.error('Network or other error during delete:', err)
      alert(`Failed to delete agent: ${getErrorMessage(err, 'Internal error')}`)
    }
  }

  const getAvatarUrl = (agent: Agent) =>
    apiUrl(`/api/avatars/generate-default?role_description=${encodeURIComponent(agent.role_description)}&agent_name=${encodeURIComponent(agent.name)}`)

  if (!isAgentManagerOpen) return null

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1001, backdropFilter: 'blur(3px)' }}>
      <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '2rem', width: editing ? (promptPreviewOpen ? '1000px' : '700px') : '550px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.6)', transition: 'width 0.2s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>👤 Agent Management</h2>
          <button onClick={toggleAgentManager} style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
        </div>

        {/* Agent List */}
        {!editing && (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Define global agent personas here. You can activate or deactivate these in individual rooms via the sidebar.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {agents.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No agents yet. Create your first persona!</p>}
              {agents.map(agent => (
                <div
                  key={agent.id}
                  draggable={confirmDeleteId !== agent.id}
                  onDragStart={() => setDraggedAgentId(agent.id ?? null)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragOverAgentId(agent.id ?? null)
                  }}
                  onDragLeave={() => {
                    if (dragOverAgentId === agent.id) {
                      setDragOverAgentId(null)
                    }
                  }}
                  onDrop={async (event) => {
                    event.preventDefault()
                    const targetId = agent.id ?? null
                    const sourceId = draggedAgentId
                    setDraggedAgentId(null)
                    setDragOverAgentId(null)
                    if (sourceId !== null && targetId !== null) {
                      await moveAgent(sourceId, targetId)
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedAgentId(null)
                    setDragOverAgentId(null)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '0.75rem',
                    backgroundColor: draggedAgentId === agent.id ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                    borderRadius: '6px',
                    border: dragOverAgentId === agent.id ? '1px solid var(--accent-color)' : '1px solid transparent',
                  }}
                >
                  <div
                    aria-label={`Drag ${agent.name}`}
                    title="Drag to reorder"
                    style={{
                      cursor: 'grab',
                      color: 'var(--text-secondary)',
                      fontSize: '1rem',
                      userSelect: 'none',
                      lineHeight: 1,
                    }}
                  >
                    ⋮⋮
                  </div>
                  <img src={getAvatarUrl(agent)} alt={agent.name} width={40} height={40} style={{ borderRadius: '50%', flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ fontSize: '1.2rem' }}>{agent.emoji || '🤖'}</span>
                      {agent.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{agent.provider} / {agent.model}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {!editing && confirmDeleteId === agent.id ? (
                      <button onClick={(e) => agent.id && remove(agent.id, e)} style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: '#fff', backgroundColor: '#ef4444', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Confirm Delete?</button>
                    ) : (
                      <>
                        <button onClick={() => setEditing(agent)} style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', cursor: 'pointer' }}>Edit</button>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(agent.id || null); }} style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: '#ef4444', backgroundColor: 'transparent', border: '1px solid #ef4444', cursor: 'pointer' }}>Delete</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => {
              const firstModel = allModels[0] || { provider: 'ollama', model: 'llama3' }
              setEditing({ ...DEFAULT_AGENT, provider: firstModel.provider, model: firstModel.model })
            }} style={{ width: '100%', padding: '0.75rem', border: '2px dashed var(--border-color)', backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--text-primary)', borderRadius: '6px' }}>
              + Create New Agent Persona
            </button>
          </>
        )}

        {/* Agent Edit Form */}
        {editing && (
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', animation: 'fadeSlideIn 0.2s ease' }}>
            {/* Left: form fields */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>{editing.id ? 'Edit Persona' : 'New Persona'}</h3>
              <button
                onClick={() => setPromptPreviewOpen(o => !o)}
                aria-label={promptPreviewOpen ? 'Hide full prompt preview' : 'Show full prompt preview'}
                title={promptPreviewOpen ? 'Hide full prompt preview' : 'Show full prompt preview'}
                style={{
                  height: '2rem',
                  padding: '0 0.65rem',
                  cursor: 'pointer',
                  backgroundColor: promptPreviewOpen ? 'var(--bg-tertiary)' : 'transparent',
                  border: '1px solid var(--border-color)',
                  color: promptPreviewOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  lineHeight: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap'
                }}
              >
                {promptPreviewOpen ? 'Hide Preview' : 'Show Preview'}
              </button>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', fontWeight: 'bold' }}>Presets</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {presets.map(preset => (
                  <button key={preset.name} onClick={() => setEditing({ ...editing, name: preset.name, role_description: preset.role_description, relevance_instructions: preset.relevance_instructions, system_prompt: preset.system_prompt, emoji: preset.emoji })} style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-primary)' }}>
                    {preset.emoji} {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Name</label>
                <input type="text" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Devil's Advocate" style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ width: '80px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Emoji</label>
                <input type="text" value={editing.emoji} onChange={e => setEditing({ ...editing, emoji: e.target.value })} placeholder="🤖" style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', textAlign: 'center', fontSize: '1.2rem' }} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Role Description</label>
              <textarea
                value={editing.role_description}
                onChange={e => setEditing({ ...editing, role_description: e.target.value })}
                placeholder="e.g. Challenges assumptions and finds edge cases..."
                style={{ width: '100%', minHeight: '100px', padding: '0.6rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Relevance Instructions</label>
              <textarea
                value={editing.relevance_instructions}
                onChange={e => setEditing({ ...editing, relevance_instructions: e.target.value })}
                placeholder="Describe the kinds of messages this agent should respond to..."
                style={{ width: '100%', minHeight: '80px', padding: '0.6rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Persona Instructions</label>
              <textarea
                value={editing.system_prompt}
                onChange={e => setEditing({ ...editing, system_prompt: e.target.value })}
                placeholder="Full behavioral instructions for this agent. If left empty, a basic prompt is auto-generated from the role description."
                style={{ width: '100%', minHeight: '160px', padding: '0.6rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Model</label>
              {allModels.length === 0 ? (
                <div style={{ padding: '0.5rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', fontSize: '0.8rem', color: '#ef4444' }}>
                  No models found. Please configure API keys in Settings.
                </div>
              ) : (
                <select
                  value={encodeModelSelection(editing.provider, editing.model)}
                  onChange={e => {
                    const { provider, model } = decodeModelSelection(e.target.value)
                    setEditing({ ...editing, provider, model })
                  }}
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                >
                  {availableModels.map(p => (
                    p.models.length > 0 && (
                      <optgroup key={p.provider} label={p.provider.toUpperCase()}>
                        {p.models.map(m => <option key={m} value={encodeModelSelection(p.provider, m)}>{m}</option>)}
                      </optgroup>
                    )
                  ))}
                </select>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={() => { setEditing(null); setPromptPreviewOpen(false) }} style={{ padding: '0.5rem 1rem', cursor: 'pointer', backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '4px' }}>Cancel</button>
              <button
                onClick={save}
                disabled={loading || !editing.name || !editing.role_description}
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', fontWeight: 'bold', borderRadius: '4px', opacity: (loading || !editing.name || !editing.role_description) ? 0.5 : 1 }}
              >
                {loading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
            </div>{/* end left column */}

            {/* Right: full prompt preview */}
            {promptPreviewOpen && (
              <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>Full Prompt Preview</div>
                <pre style={{ margin: 0, padding: '0.75rem', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', maxHeight: 'calc(90vh - 180px)', lineHeight: 1.5, fontFamily: 'monospace' }}>{buildFullPrompt(editing)}</pre>
                <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Runtime fields (memory, user profile, global instruction) shown as placeholders.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
