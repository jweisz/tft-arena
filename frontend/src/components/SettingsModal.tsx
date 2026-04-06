import React, { useState, useEffect, useCallback } from 'react'
import { useUIStore, type ColorPalette, type ThemeFont } from '../store/uiStore'
import { RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { apiFetch, apiJson } from '../lib/api'

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
  return {
    provider: value.slice(0, sepIndex),
    model: decodeURIComponent(value.slice(sepIndex + 2)),
  }
}

type FontOption = { value: ThemeFont; label: string; fontFamily: string }
const FONT_GROUPS: Array<{ group: string; options: FontOption[] }> = [
  {
    group: 'Sans-serif',
    options: [
      { value: 'modern', label: 'Inter', fontFamily: "'Inter', sans-serif" },
      { value: 'rounded', label: 'Nunito', fontFamily: "'Nunito', sans-serif" },
      { value: 'classic', label: 'DM Sans', fontFamily: "'DM Sans', sans-serif" },
    ],
  },
  {
    group: 'Serif',
    options: [
      { value: 'serif', label: 'EB Garamond', fontFamily: "'EB Garamond', serif" },
    ],
  },
  {
    group: 'Monospace',
    options: [
      { value: 'monospace', label: 'Space Mono', fontFamily: "'Space Mono', monospace" },
      { value: 'terminal-retro', label: 'VT323', fontFamily: "'VT323', monospace" },
    ],
  },
  {
    group: 'Programmer Fonts',
    options: [
      { value: 'terminal-modern', label: 'JetBrains Mono', fontFamily: "'JetBrains Mono', monospace" },
      { value: 'code-modern', label: 'IBM Plex Mono', fontFamily: "'IBM Plex Mono', monospace" },
      { value: 'hack', label: 'Hack', fontFamily: "'Hack', monospace" },
      { value: 'iosevka', label: 'Iosevka', fontFamily: "'Iosevka', monospace" },
      { value: 'fira-mono', label: 'Fira Mono', fontFamily: "'Fira Mono', monospace" },
      { value: 'mononoki', label: 'Mononoki', fontFamily: "'Mononoki', monospace" },
      { value: 'victor-mono', label: 'Victor Mono', fontFamily: "'Victor Mono', monospace" },
    ],
  },
]

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    toggleSettings,
    palette,
    themeFont,
    setPalette,
    setThemeFont,
  } = useUIStore()
  const [activeTab, setActiveTab] = useState<'theme' | 'models' | 'arena'>('theme')

  // Local state for API keys before saving
  const [openaiKey, setOpenAIKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('http://host.docker.internal:11434')
  const [defaultBudget, setDefaultBudget] = useState(3)
  const [globalInstruction, setGlobalInstruction] = useState('')
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([])
  const [nonAgentProvider, setNonAgentProvider] = useState('')
  const [nonAgentModel, setNonAgentModel] = useState('')

  // Ollama status state
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle')
  const [ollamaModelCount, setOllamaModelCount] = useState(0)

  const checkOllamaConnection = useCallback(async (saveUrl?: string) => {
    setOllamaStatus('checking')

    // If a URL is provided, save it to the DB first for immediate persistence
    if (saveUrl) {
      try {
        await apiFetch('/api/settings/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ollama_base_url: saveUrl })
        })
      } catch (err) {
        console.error('Failed to auto-save Ollama URL:', err)
      }
    }

    try {
      const providers = await apiJson<ProviderModel[]>('/api/providers/models')
      setAvailableModels(providers)
      const ollama = providers.find((provider) => provider.provider === 'ollama')
      if (ollama && ollama.models.length > 0) {
        setOllamaStatus('connected')
        setOllamaModelCount(ollama.models.length)
      } else if (ollama) {
        // Connected to Ollama but no models found
        setOllamaStatus('connected')
        setOllamaModelCount(0)
      } else {
        setOllamaStatus('error')
      }
    } catch {
      setOllamaStatus('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadSettings = async () => {
      if (!isSettingsOpen) {
        return
      }

      try {
        const data = await apiJson<Record<string, string | number | null>>('/api/settings/')
        if (!cancelled) {
          if (data.ollama_base_url) {
            setOllamaUrl(String(data.ollama_base_url))
          }
          if (data.default_agent_turn_budget !== undefined) {
            setDefaultBudget(Number(data.default_agent_turn_budget))
          }
          if (data.global_system_instruction !== undefined) {
            setGlobalInstruction(String(data.global_system_instruction || ''))
          }
          if (data.non_agent_provider !== undefined) {
            setNonAgentProvider(String(data.non_agent_provider || ''))
          }
          if (data.non_agent_model !== undefined) {
            setNonAgentModel(String(data.non_agent_model || ''))
          }
        }
      } catch (error) {
        console.error(error)
      }

      if (!cancelled) {
        await checkOllamaConnection()
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [isSettingsOpen, checkOllamaConnection])

  useEffect(() => {
    if (availableModels.length === 0) {
      return
    }

    const hasSelection = availableModels.some((provider) =>
      provider.provider === nonAgentProvider && provider.models.includes(nonAgentModel),
    )
    if (hasSelection) {
      return
    }

    const firstAvailable = availableModels.find((provider) => provider.models.length > 0)
    if (!firstAvailable) {
      return
    }

    setNonAgentProvider(firstAvailable.provider)
    setNonAgentModel(firstAvailable.models[0])
  }, [availableModels, nonAgentProvider, nonAgentModel])

  const handleSave = async () => {
    const payload: Record<string, string | number> = {}
    if (openaiKey) payload.openai_api_key = openaiKey
    if (anthropicKey) payload.anthropic_api_key = anthropicKey
    if (geminiKey) payload.google_api_key = geminiKey
    if (ollamaUrl) payload.ollama_base_url = ollamaUrl
    payload.default_agent_turn_budget = defaultBudget
    payload.global_system_instruction = globalInstruction
    if (nonAgentProvider && nonAgentModel) {
      payload.non_agent_provider = nonAgentProvider
      payload.non_agent_model = nonAgentModel
    }

    // Fire and forget save
    if (Object.keys(payload).length > 0) {
      apiFetch('/api/settings/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(console.error)
    }
    toggleSettings()
  }

  if (!isSettingsOpen) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 1000,
      backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '2rem',
        width: '550px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>⚙️ Settings</h2>
          <button onClick={toggleSettings} style={{ backgroundColor: 'transparent', border: 'none', fontSize: '1.5rem', padding: '0 0.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
          <button
            onClick={() => setActiveTab('theme')}
            style={{
              flex: 1, border: 'none', background: 'transparent', padding: '0.75rem', cursor: 'pointer',
              borderBottom: activeTab === 'theme' ? '2px solid var(--accent-color)' : '2px solid transparent',
              color: activeTab === 'theme' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'theme' ? 'bold' : 'normal'
            }}
          >Theme & UI</button>
          <button
            onClick={() => setActiveTab('models')}
            style={{
              flex: 1, border: 'none', background: 'transparent', padding: '0.75rem', cursor: 'pointer',
              borderBottom: activeTab === 'models' ? '2px solid var(--accent-color)' : '2px solid transparent',
              color: activeTab === 'models' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'models' ? 'bold' : 'normal'
            }}
          >Model Providers</button>
          <button
            onClick={() => setActiveTab('arena')}
            style={{
              flex: 1, border: 'none', background: 'transparent', padding: '0.75rem', cursor: 'pointer',
              borderBottom: activeTab === 'arena' ? '2px solid var(--accent-color)' : '2px solid transparent',
              color: activeTab === 'arena' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'arena' ? 'bold' : 'normal'
            }}
          >Arena Behavior</button>
        </div>

        {activeTab === 'theme' && (
          <div style={{ animation: 'fadeSlideIn 0.2s ease' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Color Palette</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
                {[
                  { id: 'premium-dark', name: 'Premium Dark', color1: '#16181d', color2: '#3b82f6', border: '#334155' },
                  { id: 'retro-crt', name: 'Retro CRT', color1: '#0a0a0a', color2: '#16a34a', border: '#14532d' },
                  { id: 'minimal-light', name: 'Minimal Light', color1: '#f8fafc', color2: '#0f172a', border: '#e2e8f0' },
                  { id: 'midnight-purple', name: 'Midnight', color1: '#1e132b', color2: '#a855f7', border: '#4b3070' },
                  { id: 'ocean-breeze', name: 'Ocean', color1: '#0a1f2b', color2: '#0ea5e9', border: '#1a435c' },
                  { id: 'sunset-glow', name: 'Sunset', color1: '#261f1c', color2: '#f97316', border: '#5c3e30' }
                ].map(p => (
                  <div
                    key={p.id}
                    onClick={() => setPalette(p.id as ColorPalette)}
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.5rem',
                      width: '80px',
                      opacity: palette === p.id ? 1 : 0.6,
                      transform: palette === p.id ? 'scale(1.05)' : 'scale(1)',
                      transition: 'all 0.2s ease'
                    }}
                    title={p.name}
                  >
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${p.color1} 40%, ${p.color2} 100%)`,
                      border: palette === p.id ? `3px solid var(--text-primary)` : `2px solid ${p.border}`,
                      boxShadow: palette === p.id ? `0 0 15px ${p.color2}40` : 'none',
                      transition: 'all 0.2s ease'
                    }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: palette === p.id ? 'bold' : 'normal', textAlign: 'center' }}>
                      {p.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: '2rem' }}>
              <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Typography</label>
              <select
                value={themeFont}
                onChange={(e) => setThemeFont(e.target.value as ThemeFont)}
                style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px' }}
              >
                {FONT_GROUPS.map((group) => (
                  <optgroup key={group.group} label={group.group}>
                    {group.options.map((fontOption) => (
                      <option key={fontOption.value} value={fontOption.value} style={{ fontFamily: fontOption.fontFamily }}>
                        {fontOption.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        )}

        {activeTab === 'models' && (
          <div style={{ animation: 'fadeSlideIn 0.2s ease' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Enter your API keys below to unlock models from these providers. Keys are stored locally in SQLite. Leave blank to keep existing keys.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', fontWeight: 'bold' }}>OpenAI API Key</label>
                <input type="password" value={openaiKey} onChange={e => setOpenAIKey(e.target.value)} placeholder="sk-..." />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', fontWeight: 'bold' }}>Anthropic API Key</label>
                <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-..." />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', fontWeight: 'bold' }}>Google Gemini API Key</label>
                <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)} placeholder="AIza..." />
              </div>

              <div style={{ marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ margin: 0, fontSize: '0.85rem', fontWeight: 'bold' }}>Local Ollama Base URL</label>

                  {/* Status Indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
                    {ollamaStatus === 'checking' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)' }}>
                        <RefreshCw size={12} className="spin" /> Checking...
                      </span>
                    )}
                    {ollamaStatus === 'connected' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#22c55e' }}>
                        <CheckCircle size={12} /> {ollamaModelCount} {ollamaModelCount === 1 ? 'model' : 'models'}
                      </span>
                    )}
                    {ollamaStatus === 'error' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#ef4444' }}>
                        <XCircle size={12} /> Disconnected
                      </span>
                    )}
                    <button
                      onClick={() => checkOllamaConnection(ollamaUrl)}
                      title="Refresh models"
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    >
                      <RefreshCw size={14} className={ollamaStatus === 'checking' ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={e => setOllamaUrl(e.target.value)}
                  onBlur={() => checkOllamaConnection(ollamaUrl)}
                  placeholder="http://host.docker.internal:11434"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
                  Use host.docker.internal if running Ollama natively on Mac/Windows.
                </span>

                {ollamaStatus === 'error' && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '4px', display: 'flex', gap: '0.5rem' }}>
                    <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#fca5a5', lineHeight: 1.4 }}>
                      Could not connect to Ollama. Make sure it's running and <code>OLLAMA_HOST</code> is set to <code>0.0.0.0</code>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'arena' && (
          <div style={{ animation: 'fadeSlideIn 0.2s ease' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Non-Agent Inference Model</label>
              {availableModels.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  No models discovered yet. Configure provider keys or connect Ollama.
                </div>
              ) : (
                <select
                  value={encodeModelSelection(nonAgentProvider, nonAgentModel)}
                  onChange={(e) => {
                    const decoded = decodeModelSelection(e.target.value)
                    setNonAgentProvider(decoded.provider)
                    setNonAgentModel(decoded.model)
                  }}
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                >
                  {availableModels.map((provider) => (
                    provider.models.length > 0 && (
                      <optgroup key={provider.provider} label={provider.provider.toUpperCase()}>
                        {provider.models.map((model) => (
                          <option key={`${provider.provider}-${model}`} value={encodeModelSelection(provider.provider, model)}>
                            {model}
                          </option>
                        ))}
                      </optgroup>
                    )
                  ))}
                </select>
              )}
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem', lineHeight: 1.4 }}>
                Used by hidden arena inference: router scoring, conversation summarization, and semantic analysis.
              </span>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Default Speaking Budget (Turns)</label>
              <input
                type="number"
                min={1}
                max={50}
                value={defaultBudget}
                onChange={(e) => setDefaultBudget(parseInt(e.target.value) || 1)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px'
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem', lineHeight: 1.4 }}>
                This is the initial number of turns each agent receives in a new session.
                Agents use 1 turn every time they speak.
              </span>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Global System Instruction</label>
              <textarea
                value={globalInstruction}
                onChange={(e) => setGlobalInstruction(e.target.value)}
                placeholder="e.g. Keep your responses extremely brief (1-2 sentences max)..."
                style={{
                  width: '100%',
                  height: '80px',
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  resize: 'none',
                  fontSize: '0.85rem',
                  lineHeight: 1.4
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem', lineHeight: 1.4 }}>
                This prompt is prepended to the system prompt of every agent. Use it for overall style constraints (e.g. "Speak like an IRC user", "Use only 1-2 sentences", etc).
              </span>
            </div>

          </div>
        )}

        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <button onClick={toggleSettings} style={{ padding: '0.5rem 1rem', cursor: 'pointer', backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '4px' }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: '0.5rem 1rem', cursor: 'pointer', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', fontWeight: 'bold', borderRadius: '4px' }}>Save Settings</button>
        </div>
      </div>
    </div>
  )
}

