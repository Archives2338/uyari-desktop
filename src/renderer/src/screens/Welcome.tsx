import { useState } from 'react'
import { useApp } from '@renderer/store'
import icon from '@renderer/assets/uyari-icon.png'

export function Welcome(): React.JSX.Element {
  const login = useApp((s) => s.login)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await login(email.trim())
    } catch {
      setError('Could not sign in. Is the backend running on port 3001?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <div className="card" style={{ textAlign: 'center' }}>
        <img className="logo-mark" src={icon} alt="Uyari" style={{ margin: '0 auto 24px' }} />
        <p className="eyebrow">Welcome to Uyari</p>
        <h1 className="title">AI notes for every meeting</h1>
        <p className="subtitle">Sign in to get your transcripts and summaries.</p>
        <input
          className="input"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && void submit()}
        />
        <p className="error-text">{error}</p>
        <div className="footer-actions" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button className="btn" disabled={busy || !email.includes('@')} onClick={() => void submit()}>
            {busy ? 'Signing in…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
