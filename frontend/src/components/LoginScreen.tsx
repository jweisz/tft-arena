import React from 'react'

export const LoginScreen: React.FC<{ onLogin: (token: string) => void }> = ({ onLogin }) => {
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
          onClick={() => onLogin("mock_jwt_token")}
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
            fontSize: '1rem'
          }}
          onMouseOver={e => e.currentTarget.style.opacity = '0.8'}
          onMouseOut={e => e.currentTarget.style.opacity = '1'}
        >
          Enter the Arena →
        </button>
      </div>
    </div>
  )
}
