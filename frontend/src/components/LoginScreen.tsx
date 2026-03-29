import React from 'react'
import { apiJson, getErrorMessage } from '../lib/api'
import { buildLocalDevSession, type AuthSession } from '../lib/auth'

interface VerifyGoogleTokenResponse {
  access_token: string
  token_type: 'bearer'
  user?: {
    email?: string
    name?: string
  }
}

export const LoginScreen: React.FC<{ onLogin: (session: AuthSession) => void }> = ({ onLogin }) => {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleLocalLogin = async () => {
    setLoading(true)
    setError(null)

    try {
      const payload = await apiJson<VerifyGoogleTokenResponse>('/api/auth/verify_google_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'local-dev-bootstrap' }),
      })

      onLogin({
        accessToken: payload.access_token,
        tokenType: payload.token_type,
        user: payload.user,
        mode: 'jwt',
      })
    } catch (err) {
      // Keep local-first behavior resilient when backend auth endpoint is unavailable.
      setError(getErrorMessage(err, 'Could not reach backend auth endpoint; using local mode.'))
      onLogin(buildLocalDevSession())
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center', zIndex: 9999
    }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '2.5rem', letterSpacing: '0.05em' }}>TFT ARENA</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Can your ideas survive the onslaught?</p>
      </div>

      <div style={{ padding: '2rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button
          onClick={handleLocalLogin}
          disabled={loading}
          style={{
            background: 'var(--accent-color)',
            color: '#ffffff',
            padding: '12px 24px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            fontWeight: 'bold',
            fontFamily: 'inherit',
            transition: 'opacity 0.2s ease',
            fontSize: '1rem',
            opacity: loading ? 0.7 : 1,
          }}
          onMouseOver={e => { if (!loading) e.currentTarget.style.opacity = '0.8' }}
          onMouseOut={e => { if (!loading) e.currentTarget.style.opacity = '1' }}
        >
          {loading ? 'Entering…' : 'Enter the Arena →'}
        </button>
        {error && (
          <p style={{ marginTop: '0.75rem', maxWidth: '320px', fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
