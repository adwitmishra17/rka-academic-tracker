import React, { useState } from 'react'
import { signInWithPopup, signInWithCustomToken } from 'firebase/auth'
import { auth, googleProvider } from '../firebase/config'
import crest from '../assets/crest.png'
import banner from '../assets/banner.png'

// Supabase Edge Functions base URL (rka-attendance project).
const FUNCTIONS_URL = 'https://yegxwxutdalmdubrozrm.supabase.co/functions/v1'

// Builds the phone string sent to the backend. It MUST match the format
// stored in employees.phone exactly — the lookup is an exact string match.
// Currently sends +91 followed by the 10 digits.
// If employees.phone is stored as bare 10 digits, change this to: return tenDigits
function toBackendPhone(tenDigits) {
  return '+91' + tenDigits
}

function Spinner() {
  return (
    <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
  )
}

export default function Login() {
  const [mode, setMode] = useState('google')   // 'google' | 'phone'
  const [step, setStep] = useState('phone')     // 'phone' | 'otp'
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleGoogleLogin() {
    setLoading(true); setError('')
    try { await signInWithPopup(auth, googleProvider) }
    catch (e) { setError('Sign-in failed. Use your admin Google account.'); setLoading(false) }
  }

  async function handleSendOtp() {
    if (phone.length !== 10 || loading) return
    setLoading(true); setError(''); setInfo('')
    try {
      const res = await fetch(`${FUNCTIONS_URL}/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: toBackendPhone(phone) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'Could not send the OTP. Please try again.')
      } else {
        setInfo(`Code sent to +91 ${phone.slice(0, 5)} ${phone.slice(5)}`)
        setStep('otp'); setOtp('')
      }
    } catch (e) {
      setError('Network error. Please check your connection and try again.')
    }
    setLoading(false)
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6 || loading) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`${FUNCTIONS_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: toBackendPhone(phone), code: otp }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'Verification failed. Please try again.')
        setLoading(false)
        return
      }
      // Signs in to the same Firebase account as Google would.
      // The app's auth-state listener takes over and routes into the dashboard.
      await signInWithCustomToken(auth, data.customToken)
    } catch (e) {
      setError('Could not sign you in. Please try again.')
      setLoading(false)
    }
  }

  function switchToPhone() { setMode('phone'); setStep('phone'); setError(''); setInfo(''); setOtp('') }
  function switchToGoogle() { setMode('google'); setError(''); setInfo('') }
  function changeNumber() { setStep('phone'); setError(''); setInfo(''); setOtp('') }

  // --- shared styles ---
  const primaryBtn = (disabled) => ({
    width: '100%', padding: '14px', background: disabled ? 'rgba(255,255,255,0.05)' : 'var(--gold)',
    color: disabled ? 'rgba(255,255,255,0.4)' : 'var(--green-dark)', border: 'none',
    borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 10, transition: 'all 0.2s',
    boxShadow: disabled ? 'none' : '0 4px 20px rgba(201,162,39,0.35)',
  })
  const linkBtn = {
    background: 'none', border: 'none', color: 'rgba(201,162,39,0.85)', fontSize: 12.5,
    cursor: 'pointer', textDecoration: 'underline', padding: 4, fontFamily: 'inherit',
  }
  const fieldFocus = (e, on) => { e.target.style.borderColor = on ? 'var(--gold)' : 'rgba(255,255,255,0.14)' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--green-dark)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -80, right: -80, width: 280, height: 280, borderRadius: '50%', border: '1px solid rgba(201,162,39,0.1)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -60, left: -60, width: 200, height: 200, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, var(--gold), var(--crimson), var(--gold))' }} />

      <div className="fade-up" style={{ width: '100%', maxWidth: 380 }}>
        {/* School identity */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src={crest} alt="RKA Crest" style={{ width: 80, height: 80, objectFit: 'contain', display: 'block', margin: '0 auto 16px', borderRadius: '50%', border: '2px solid rgba(201,162,39,0.4)', background: 'rgba(255,255,255,0.08)', padding: 4 }} />
          <img src={banner} alt="Radhakrishna Academy" style={{ width: '100%', maxWidth: 320, height: 'auto', objectFit: 'contain', display: 'block', margin: '0 auto 10px' }} />
          <div style={{ width: 36, height: 1.5, background: 'var(--gold)', margin: '10px auto 8px', borderRadius: 1, opacity: 0.7 }} />
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Admin Portal</p>
        </div>

        {/* Login card */}
        <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(255,255,255,0.1)', padding: '26px 22px' }}>

          {mode === 'google' && (
            <>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 1.6, marginBottom: 22 }}>
                Sign in with your admin Google account to access the dashboard.
              </p>
              <button onClick={handleGoogleLogin} disabled={loading} style={primaryBtn(loading)}>
                {loading ? (
                  <><Spinner />Signing in…</>
                ) : (
                  <><svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" /><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" /><path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05" /><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" /></svg>Sign in with Google</>
                )}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
              </div>

              <button onClick={switchToPhone} style={{ width: '100%', padding: '13px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-md)', color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="2" width="10" height="20" rx="2" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
                Sign in with mobile OTP
              </button>
            </>
          )}

          {mode === 'phone' && step === 'phone' && (
            <>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 1.6, marginBottom: 18 }}>
                Enter your registered mobile number and we'll send a one-time code.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 16 }}>
                <span style={{ padding: '13px 12px', color: 'rgba(255,255,255,0.55)', fontSize: 15, borderRight: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}>+91</span>
                <input
                  type="tel" inputMode="numeric" autoFocus value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp() }}
                  onFocus={(e) => { e.target.parentElement.style.borderColor = 'var(--gold)' }}
                  onBlur={(e) => { e.target.parentElement.style.borderColor = 'rgba(255,255,255,0.14)' }}
                  placeholder="10-digit mobile number"
                  style={{ flex: 1, padding: '13px 14px', background: 'transparent', border: 'none', color: '#fff', fontSize: 15, outline: 'none' }}
                />
              </div>
              <button onClick={handleSendOtp} disabled={loading || phone.length !== 10} style={primaryBtn(loading || phone.length !== 10)}>
                {loading ? <><Spinner />Sending…</> : 'Send OTP'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button onClick={switchToGoogle} style={linkBtn}>Use Google sign-in instead</button>
              </div>
            </>
          )}

          {mode === 'phone' && step === 'otp' && (
            <>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 1.6, marginBottom: 18 }}>
                Enter the 6-digit code sent to<br />+91 {phone.slice(0, 5)} {phone.slice(5)}
              </p>
              <input
                type="tel" inputMode="numeric" autoFocus value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp() }}
                onFocus={(e) => fieldFocus(e, true)}
                onBlur={(e) => fieldFocus(e, false)}
                placeholder="6-digit code"
                style={{ width: '100%', padding: '13px 14px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 'var(--radius-md)', color: '#fff', fontSize: 18, letterSpacing: '0.4em', textAlign: 'center', outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
              />
              <button onClick={handleVerifyOtp} disabled={loading || otp.length !== 6} style={primaryBtn(loading || otp.length !== 6)}>
                {loading ? <><Spinner />Verifying…</> : 'Verify & sign in'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14, display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center' }}>
                <button onClick={handleSendOtp} disabled={loading} style={linkBtn}>Resend code</button>
                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>·</span>
                <button onClick={changeNumber} disabled={loading} style={linkBtn}>Change number</button>
              </div>
            </>
          )}

          {error && <p style={{ fontSize: 12, color: '#ffb3b3', textAlign: 'center', marginTop: 14, padding: '9px 12px', background: 'rgba(139,26,26,0.25)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(139,26,26,0.3)' }}>{error}</p>}
          {info && !error && <p style={{ fontSize: 12, color: 'rgba(201,162,39,0.95)', textAlign: 'center', marginTop: 14, padding: '9px 12px', background: 'rgba(201,162,39,0.12)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(201,162,39,0.25)' }}>{info}</p>}
        </div>

        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
          Access restricted to authorised admin accounts only.
        </p>
      </div>
    </div>
  )
}
