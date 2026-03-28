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
    setMessages(prev => [...prev, {
      id: `human-${Date.now()}`,
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

  return (
    <main className="chat-main">

      <div className="chat-messages" ref={scrollRef}>
        {messages.map(msg => (
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
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
            
          </div>
        ))}
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
