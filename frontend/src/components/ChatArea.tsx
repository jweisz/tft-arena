import React, { useState, useEffect, useRef, useCallback } from 'react'
import { MentionInput } from './MentionInput'
import ReactMarkdown from 'react-markdown'
import { useArenaSocket } from '../hooks/useArenaSocket'
import type { WSEvent } from '../hooks/useArenaSocket'
import { useTypingAudio } from '../hooks/useTypingAudio'
import { useUIStore } from '../store/uiStore'

interface ChatMessage {
  id: string
  role: 'human' | 'agent' | 'system'
  agentName?: string
  content: string
  isStreaming?: boolean
  isInterrupted?: boolean
}

interface RelevanceSnapshot {
  scores: Record<string, number>
  reasons: Record<string, string>
}

interface ScratchpadState {
  consensus: string
  open_questions: string[]
  key_ideas: string[]
}

const WELCOME = (roomName?: string) => `Welcome to ${roomName ?? 'the Arena'}. The agents are ready.`

export const ChatArea: React.FC<{
  roomId: number
  onScratchpadUpdate?: (s: ScratchpadState) => void
  onTelemetryUpdate?: (data: any[], budgets: Record<string, number>) => void
}> = ({ roomId, onScratchpadUpdate, onTelemetryUpdate }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Per human-message relevance snapshot: msgId -> { scores, reasons }
  const [relevanceMap, setRelevanceMap] = useState<Record<string, RelevanceSnapshot>>({})
  // Tracks the ID of the last human message sent
  const lastHumanMsgIdRef = useRef<string | null>(null)
  // Tooltip state
  const [tooltip, setTooltip] = useState<{ visible: boolean; text: string; x: number; y: number }>({ visible: false, text: '', x: 0, y: 0 })
  const { 
    streamingAgents, 
    updateStreamingAgents, 
    updateAgentStatus, 
    updateAgentBudget, 
    setAllBudgets 
  } = useUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const streamingIdsRef = useRef<Record<string, string>>({})
  const { playTick } = useTypingAudio()

  const handleEvent = useCallback((event: WSEvent) => {
    console.log("[WS EFFECT]", event.type, event)
    const currentStreaming = useUIStore.getState().streamingAgents
    switch (event.type) {
      case 'status_update': {
        Object.entries(event.statuses).forEach(([agent, status]) => {
          updateAgentStatus(agent, status as any)
        })
        // Snapshot scores+reasons and attach to the last human message
        if (event.scores && Object.keys(event.scores).length > 0 && lastHumanMsgIdRef.current) {
          const msgId = lastHumanMsgIdRef.current
          const snapshot: RelevanceSnapshot = {
            scores: event.scores,
            reasons: event.reasons ?? {},
          }
          setRelevanceMap(prev => ({ ...prev, [msgId]: snapshot }))
        }
        break
      }
      case 'budget_update': {
        Object.entries(event.budgets).forEach(([agent, budget]) => {
          updateAgentBudget(agent, budget)
        })
        break
      }
      case 'thinking': {
        if (!currentStreaming.has(event.agent)) {
          const nextSet = new Set(currentStreaming)
          nextSet.add(event.agent)
          updateStreamingAgents(nextSet)
        }
        break
      }
      case 'token': {
        const agentKey = `streaming-${event.agent}`
        if (!currentStreaming.has(event.agent)) {
          const nextSet = new Set(currentStreaming)
          nextSet.add(event.agent)
          updateStreamingAgents(nextSet)
        }
        
        // Ensure a unique ID for this specific response turn
        if (!streamingIdsRef.current[event.agent]) {
          streamingIdsRef.current[event.agent] = `streaming-${event.agent}-${Date.now()}`
        }
        const tokenKey = streamingIdsRef.current[event.agent]

        playTick()
        setMessages(prev => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].id === tokenKey) {
              const updated = [...prev]
              updated[i] = { ...updated[i], content: updated[i].content + event.token }
              return updated
            }
          }
          return [...prev, {
            id: tokenKey,
            role: 'agent',
            agentName: event.agent,
            content: event.token,
            isStreaming: true,
          }]
        })
        break
      }
      case 'done': {
        setMessages(prev => prev.map(m =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        ))
        updateStreamingAgents(new Set())
        streamingIdsRef.current = {} // Reset all specific IDs on completion
        break
      }
      case 'interrupted': {
        setMessages(prev => prev.map(m =>
          m.isStreaming ? { ...m, isStreaming: false, isInterrupted: true, content: m.content + ' [Interrupted]' } : m
        ))
        updateStreamingAgents(new Set())
        streamingIdsRef.current = {} // Reset all specific IDs on interruption
        break
      }
      case 'telemetry': {
        onTelemetryUpdate?.(event.data, event.budgets)
        setAllBudgets(event.budgets)
        break
      }
      case 'activity_stats': {
        useUIStore.getState().setAgentActivity(event.stats)
        break
      }
      case 'semantic': {
        if (event.scratchpad) onScratchpadUpdate?.(event.scratchpad)
        break
      }
      case 'error': {
        setMessages(prev => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'system', content: `⚠️ Error: ${event.error}` }
        ])
        break
      }
    }
  }, [onScratchpadUpdate, onTelemetryUpdate, playTick, updateStreamingAgents, updateAgentStatus, updateAgentBudget, setAllBudgets])

  const { connect, send, disconnect } = useArenaSocket({ roomId, onEvent: handleEvent })

  // Load transcript history whenever room changes
  useEffect(() => {
    if (!roomId) {
      setMessages([{ id: 'sys-0', role: 'system', content: 'Select or create a chat to start.' }])
      return
    }
    setMessages([{ id: 'sys-0', role: 'system', content: 'Loading history…' }])
    fetch(`http://localhost:8000/api/rooms/${roomId}/messages/`)
      .then(r => r.json())
      .then((history: Array<{id: number; role: string; content: string;}>) => {
        if (history.length === 0) {
          setMessages([{ id: 'sys-0', role: 'system', content: WELCOME() }])
          return
        }
        setMessages(history.map((m: any) => ({
          id: `db-${m.id}`,
          role: m.role as ChatMessage['role'],
          agentName: m.agent?.name || (m.role === 'agent' ? 'System' : ''),
          content: m.content,
        })))
      })
      .catch(() => setMessages([{ id: 'sys-0', role: 'system', content: WELCOME() }]))
  }, [roomId])


  // Reconnect WebSocket when room changes
  useEffect(() => {
    if (!roomId) return
    connect()
    return () => disconnect()
  }, [roomId, connect, disconnect])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const sendMessage = (text: string, mentions?: string[]) => {
    if (!text.trim()) return
    // If agents are streaming, the new message acts as an interrupt
    if (streamingAgents.size > 0) {
      setMessages(prev => prev.map(m =>
        m.isStreaming ? { ...m, isStreaming: false, isInterrupted: true, content: m.content + ' ✦' } : m
      ))
      updateStreamingAgents(new Set())
    }
    const msgId = `human-${Date.now()}`
    lastHumanMsgIdRef.current = msgId
    setMessages(prev => [...prev, {
      id: msgId,
      role: 'human',
      content: text,
    }])
    send(text, mentions)
  }

  const roleColor = (role: ChatMessage['role']) => {
    if (role === 'human') return 'var(--accent-color)'
    if (role === 'system') return 'var(--text-secondary)'
    return 'var(--text-primary)'
  }

  // Styles for the markdown body to match existing constraints
  const markdownStyles = {
    lineHeight: '1.6', 
    margin: '0.3rem 0 0 0'
  }

    const cleanContent = (text: string, agentName?: string) => {
      if (!agentName || !text) return text
      // Escaping for regex
      const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const patterns = [
        new RegExp(`^\\s*["']?${escapedName}[:\\-\\s—]+\\s*["']?`, 'i'),
        /^\s*["']?Agent[:\\-\\s—]+\\s*["']?/i,
        /^\s*["']?Response[:\\-\\s—]+\s*["']?/i,
      ]
      let sanitized = text.trim()
      patterns.forEach(p => { sanitized = sanitized.replace(p, '').trim() })
      
      // Strip surrounding quotes if they wrap the whole thing
      if ((sanitized.startsWith('"') && sanitized.endsWith('"')) || 
          (sanitized.startsWith("'") && sanitized.endsWith("'"))) {
        sanitized = sanitized.slice(1, -1).trim()
      }
      return sanitized
    }

    const THRESHOLD = 3.0

    return (
      <main className="chat-main">
        {/* Floating Tooltip */}
        {tooltip.visible && (
          <div style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%) translateY(-100%)',
            marginTop: '-8px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '0.4rem 0.7rem',
            fontSize: '0.75rem',
            color: 'var(--text-primary)',
            maxWidth: '220px',
            whiteSpace: 'normal',
            lineHeight: '1.4',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}>
            {tooltip.text}
          </div>
        )}

        <div className="chat-messages" ref={scrollRef}>
          {messages.map(msg => {
            const snap = msg.role === 'human' ? relevanceMap[msg.id] : undefined

            return (
              <div key={msg.id} style={{ marginBottom: '1.5rem', opacity: msg.isInterrupted ? 0.6 : 1 }}>
                <span style={{
                  fontWeight: 'bold',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: roleColor(msg.role),
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.2rem'
                }}>
                  {msg.role === 'human' ? 'You' : msg.agentName || 'System'}
                  {msg.isStreaming && <span style={{ animation: 'pulse 0.8s infinite' }}>▌</span>}
                </span>
                
                <div style={markdownStyles}>
                  <ReactMarkdown>{cleanContent(msg.content, msg.role === 'agent' ? msg.agentName : undefined)}</ReactMarkdown>
                </div>

                {/* Relevance chips for human messages */}
                {snap && (() => {
                  const allEntries = Object.entries(snap.scores)
                  if (allEntries.length === 0) return null

                  // Sort: above-threshold first (by score desc), then below-threshold (by score desc)
                  const above = allEntries.filter(([, s]) => s >= THRESHOLD).sort((a, b) => b[1] - a[1])
                  const below = allEntries.filter(([, s]) => s < THRESHOLD).sort((a, b) => b[1] - a[1])
                  const sorted = [...above, ...below]

                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.6rem' }}>
                      {sorted.map(([name, score]) => {
                        const isAbove = score >= THRESHOLD
                        const reason = snap.reasons[name] || ''
                        const pct = Math.round(score * 10)
                        const tooltipText = `${name} — ${pct}% relevance${reason ? `\n${reason}` : ''}`

                        return (
                          <div
                            key={name}
                            onMouseEnter={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setTooltip({ visible: true, text: tooltipText, x: rect.left + rect.width / 2, y: rect.top })
                            }}
                            onMouseLeave={() => setTooltip(prev => ({ ...prev, visible: false }))}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '999px',
                              fontSize: '0.7rem',
                              cursor: 'default',
                              userSelect: 'none',
                              backgroundColor: isAbove ? 'rgba(110, 89, 255, 0.15)' : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${isAbove ? 'rgba(110, 89, 255, 0.4)' : 'rgba(255,255,255,0.08)'}`,
                              color: isAbove ? 'var(--accent-color)' : 'rgba(255,255,255,0.3)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <span style={{ fontSize: '0.75rem' }}>{name.charAt(0)}</span>
                            <span style={{ fontWeight: isAbove ? '600' : '400' }}>{pct}%</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>

      <div className="chat-input-area">
        <MentionInput
          roomId={roomId}
          onSend={sendMessage}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>@ to mention an agent. Enter to send.</span>
        </div>
      </div>
    </main>
  )
}
