import React from 'react'
import { Activity } from 'lucide-react'
import { useUIStore } from '../store/uiStore'

interface Props {
  latestData: Array<{ agent_name: string; tokens_used: number; latency_ms: number; turn: number }>
}

export const TelemetryPanel: React.FC<Props> = ({ latestData }) => {
  const { latencyHistory } = useUIStore()
  const totalTokens = latestData.reduce((sum, e) => sum + e.tokens_used, 0)

  const calculateStats = (latencies: number[]) => {
    if (!latencies || latencies.length === 0) return { mean: 0, sd: 0 }
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const variance = latencies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / latencies.length
    const sd = Math.sqrt(variance)
    return { mean, sd }
  }

  const formatLatency = (ms: number) => {
    if (ms > 1000) return `${(ms / 1000).toFixed(2)}s`
    return `${Math.round(ms)}ms`
  }

  const agentsWithHistory = Object.keys(latencyHistory).sort()

  return (
    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', marginTop: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <Activity size={13} style={{ color: 'var(--accent-color)' }} />
        <h3 style={{ margin: 0, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Telemetry</h3>
      </div>

      <div style={{ fontSize: '0.78rem', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Turn tokens:</span>
          <span>{totalTokens > 0 ? totalTokens.toLocaleString() : '—'}</span>
        </div>
        
        {agentsWithHistory.length > 0 && (
          <div style={{ marginTop: '0.4rem' }}>
            <span style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem', fontSize: '0.7rem' }}>Avg response time (Mean ± SD):</span>
            {agentsWithHistory.map(name => {
              const { mean, sd } = calculateStats(latencyHistory[name])
              return (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '0.5rem', borderLeft: '2px solid var(--border-color)', marginBottom: '0.1rem' }}>
                  <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{name}</span>
                  <span style={{ fontSize: '0.75rem' }}>
                    {formatLatency(mean)} <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>± {formatLatency(sd)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

