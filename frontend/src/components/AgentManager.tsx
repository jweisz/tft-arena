import React, { useState, useEffect } from 'react'

import { useUIStore } from '../store/uiStore'

interface Agent {
  id?: number
  name: string
  role_description: string
  system_prompt: string
  model: string
  provider: string
  token_budget: number
}

const DEFAULT_AGENT: Agent = {
  name: '',
  role_description: '',
  system_prompt: '',
  model: 'llama3',
  provider: 'ollama',
  token_budget: 3,
}

interface ProviderModel {
  provider: string
  models: string[]
}

export const AgentManager: React.FC = () => {
  const { isAgentManagerOpen, toggleAgentManager, triggerAgentsRefresh } = useUIStore()
  const [agents, setAgents] = useState<Agent[]>([])
  const [editing, setEditing] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(false)
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([])
  const [presets, setPresets] = useState<{ name: string, emoji: string, description: string }[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const fetchAgents = async () => {
    try {
      const res = await fetch(`http://localhost:8000/api/agents/`)
      if (res.ok) setAgents(await res.json())
    } catch { /* No agents found */ }
  }

  const fetchModels = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/providers/models')
      if (res.ok) setAvailableModels(await res.json())
    } catch { console.error("Failed to fetch models") }
  }

  const fetchPresets = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/agents/presets')
      if (res.ok) setPresets(await res.json())
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

    try {
      const url = payload.id
        ? `http://localhost:8000/api/agents/${payload.id}`
        : `http://localhost:8000/api/agents/`
      const method = payload.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) { 
        await fetchAgents()
        triggerAgentsRefresh()
        setEditing(null)
      }
    } finally { setLoading(false) }
  }

  const remove = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      console.log(`Sending DELETE for agent ${id}...`)
      const res = await fetch(`http://localhost:8000/api/agents/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: 'Unknown error' }))
        console.error('Agent delete failed:', detail)
        alert(`Failed to delete agent: ${detail.detail || 'Internal error'}`)
        return
      }
      console.log(`Agent ${id} deleted successfully.`)
      setConfirmDeleteId(null)
      await fetchAgents()
      triggerAgentsRefresh()
    } catch (err) {
      console.error('Network or other error during delete:', err)
      alert(`Network error during agent deletion. Check console.`)
    }
  }

  const getAvatarUrl = (agent: Agent) =>
    `http://localhost:8000/api/avatars/generate-default?role_description=${encodeURIComponent(agent.role_description)}&agent_name=${encodeURIComponent(agent.name)}`

  if (!isAgentManagerOpen) return null

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1001, backdropFilter: 'blur(3px)' }}>
      <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '2rem', width: '550px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.6)' }}>
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
                <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                  <img src={getAvatarUrl(agent)} alt={agent.name} width={40} height={40} style={{ borderRadius: '50%', flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.2rem' }}>{agent.name}</div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', animation: 'fadeSlideIn 0.2s ease' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{editing.id ? 'Edit Persona' : 'New Persona'}</h3>
            
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', fontWeight: 'bold' }}>Presets</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {presets.map(preset => (
                  <button key={preset.name} onClick={() => setEditing({ ...editing, name: preset.name, role_description: preset.description })} style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-primary)' }}>
                    {preset.emoji} {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Name</label>
              <input type="text" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Devil's Advocate" style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
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
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Model</label>
              {allModels.length === 0 ? (
                <div style={{ padding: '0.5rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', fontSize: '0.8rem', color: '#ef4444' }}>
                  No models found. Please configure API keys in Settings.
                </div>
              ) : (
                <select 
                  value={`${editing.provider}:${editing.model}`}
                  onChange={e => {
                    const [provider, model] = e.target.value.split(':')
                    setEditing({ ...editing, provider, model })
                  }} 
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                >
                  {availableModels.map(p => (
                    p.models.length > 0 && (
                      <optgroup key={p.provider} label={p.provider.toUpperCase()}>
                        {p.models.map(m => <option key={m} value={`${p.provider}:${m}`}>{m}</option>)}
                      </optgroup>
                    )
                  ))}
                </select>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={() => setEditing(null)} style={{ padding: '0.5rem 1rem', cursor: 'pointer', backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '4px' }}>Cancel</button>
              <button 
                onClick={save} 
                disabled={loading || !editing.name || !editing.role_description} 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', fontWeight: 'bold', borderRadius: '4px', opacity: (loading || !editing.name || !editing.role_description) ? 0.5 : 1 }}
              >
                {loading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
