// ============================================================================
// teacher/src/components/ImpersonationBanner.jsx
//
// Persistent orange banner shown across the teacher PWA when an admin is
// viewing the app as a teacher (via the admin's /impersonate page → custom
// token sign-in). Reads its state from sessionStorage so it survives
// navigation but disappears when the tab closes.
//
// Set by teacher/src/App.jsx when ?impersonate=<token>&actor=<email> is
// present on first load.
// ============================================================================

import React, { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase/config'

const STORAGE_KEY = 'impersonation'

export function setImpersonationState(actor) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ actor, since: Date.now() }))
  } catch {}
}

export function clearImpersonationState() {
  try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
}

export function getImpersonationState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export default function ImpersonationBanner() {
  const [info, setInfo] = useState(() => getImpersonationState())

  // Listen for cross-tab sessionStorage changes (in case the admin exits from
  // another tab). Rare but cheap to handle.
  useEffect(() => {
    function handler() { setInfo(getImpersonationState()) }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  if (!info) return null

  async function exitImpersonation() {
    if (!window.confirm('Exit impersonation? You will be signed out of this tab.')) return
    clearImpersonationState()
    try { await signOut(auth) } catch (e) { console.warn('signOut error during impersonation exit:', e) }
    window.location.href = '/login'
  }

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 9999,
      background: 'linear-gradient(90deg, #c9531c, #b94518)',
      color: 'white',
      padding: '8px 14px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      fontSize: 12.5, fontFamily: 'var(--font-body)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Impersonation active</span>
        <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          · initiated by {info.actor}
        </span>
      </div>
      <button
        onClick={exitImpersonation}
        style={{
          background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.6)',
          color: 'white', padding: '4px 12px', borderRadius: 4,
          cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Exit
      </button>
    </div>
  )
}
