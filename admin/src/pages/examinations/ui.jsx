import React from 'react'

// Shared bits for the Examinations stages (matches the app's token palette).
export const inp = { padding: '7px 9px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none' }
export const lbl = { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 500 }
export const card = { background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }
export const th = { padding: '8px 10px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', whiteSpace: 'nowrap' }
export const td = { padding: '7px 10px', fontSize: 12.5, borderBottom: '1px solid var(--gray-50)', verticalAlign: 'middle' }

export function Btn({ kind = 'ghost', small, disabled, children, ...rest }) {
  const base = { padding: small ? '5px 10px' : '8px 16px', borderRadius: 'var(--radius-md)', fontSize: small ? 11.5 : 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', border: '1px solid var(--gray-200)', background: 'var(--white)', color: 'var(--text)', opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap' }
  const kinds = {
    primary: { background: 'var(--green)', color: 'white', border: '1px solid var(--green)' },
    danger: { background: 'var(--crimson-light)', color: 'var(--crimson)', border: '1px solid transparent' },
    gold: { background: 'var(--gold-light)', color: 'var(--gold-dark)', border: '1px solid rgba(201,162,39,0.35)' },
    ghost: {},
  }
  return <button disabled={disabled} style={{ ...base, ...kinds[kind] }} {...rest}>{children}</button>
}

export function Pill({ tone = 'muted', children, title }) {
  const tones = {
    green: { background: 'var(--green-light)', color: 'var(--green-dark)' },
    gold: { background: 'var(--gold-light)', color: 'var(--gold-dark)' },
    red: { background: 'var(--crimson-light)', color: 'var(--crimson)' },
    muted: { background: 'var(--gray-50)', color: 'var(--text-muted)' },
    ink: { background: 'var(--text)', color: 'var(--white)' },
  }
  return <span title={title} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 600, ...tones[tone] }}>{children}</span>
}

export function Note({ tone = 'gold', children }) {
  const tones = {
    gold: { background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', color: 'var(--gold-dark)' },
    red: { background: 'var(--crimson-light)', border: '1px solid transparent', color: 'var(--crimson)' },
    green: { background: 'var(--green-light)', border: '1px solid var(--green-muted)', color: 'var(--green-dark)' },
    muted: { background: 'var(--gray-50)', border: '1px solid var(--gray-100)', color: 'var(--text-muted)' },
  }
  return <div style={{ ...tones[tone], borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>{children}</div>
}

export function Spinner() {
  return <div style={{ textAlign: 'center', padding: 30 }}><div style={{ width: 24, height: 24, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
}

export function Drawer({ title, onClose, children, width = 'min(1100px, 96vw)' }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width, background: 'var(--bg, var(--gray-50))', boxShadow: '-8px 0 30px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--gray-100)', background: 'var(--white)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--green-dark)', flex: 1 }}>{title}</div>
          <Btn small onClick={onClose}>Close ✕</Btn>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}

export const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
