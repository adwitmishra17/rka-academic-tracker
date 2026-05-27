// ============================================================================
// admin/src/pages/Impersonate.jsx
//
// Super admin only — pick any teacher and open the teacher PWA in a new tab
// signed in as that teacher. For bug identification / reproducing teacher-side
// issues.
//
// Flow:
//   1. Super admin picks a teacher
//   2. Frontend calls POST /api/admin/impersonate
//   3. Backend mints a Firebase custom token + logs to impersonationAudit
//   4. Frontend opens teacher-PWA-URL/?impersonate=<token>&actor=<admin-email>
//      in a new tab
//   5. Teacher PWA detects the param, signs in with the custom token, shows
//      an orange impersonation banner with an Exit button
// ============================================================================

import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { apiPost } from '../lib/api'
import { branchLabel } from '../lib/branch'

const SUPER_ADMIN_EMAIL = 'adwit@rkacademyballia.in'

export default function Impersonate() {
  const { user } = useAuth()
  const isSuperAdmin = (user?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL

  const [teachers,  setTeachers]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [error,     setError]     = useState('')
  const [openingId, setOpeningId] = useState(null)

  useEffect(() => {
    if (!isSuperAdmin) { setLoading(false); return }
    ;(async () => {
      try {
        const snap = await getDocs(collection(db, 'teachers'))
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => t.isActive !== false)
          .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
        setTeachers(list)
      } catch (e) {
        console.error('Impersonate.loadTeachers:', e)
        setError('Failed to load teachers: ' + e.message)
      }
      setLoading(false)
    })()
  }, [isSuperAdmin])

  if (!isSuperAdmin) {
    return (
      <div style={{ padding: '40px 36px', maxWidth: 720 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--green-dark)', marginBottom: 12 }}>
          Impersonate Teacher
        </h1>
        <div style={{
          background: 'var(--crimson-light)', border: '1px solid rgba(139,26,26,0.25)',
          borderRadius: 'var(--radius-md)', padding: '14px 18px', color: 'var(--crimson)', fontSize: 13.5,
        }}>
          This feature is restricted to the super admin account.
        </div>
      </div>
    )
  }

  const filtered = teachers.filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return (t.fullName || '').toLowerCase().includes(q)
        || (t.email    || '').toLowerCase().includes(q)
        || (t.classTeacherOf || '').toLowerCase().includes(q)
  })

  async function impersonate(teacher) {
    setOpeningId(teacher.id); setError('')
    try {
      const { customToken, teacherPwaUrl, teacherName } = await apiPost('/api/admin/impersonate', {
        teacherDocId: teacher.id,
      })
      const params = new URLSearchParams({
        impersonate: customToken,
        actor:       user.email,
      })
      const url = `${teacherPwaUrl}/?${params.toString()}`
      window.open(url, '_blank', 'noopener,noreferrer')
      console.log(`Opened teacher PWA as ${teacherName} (${teacher.email})`)
    } catch (e) {
      console.error('impersonate failed:', e)
      setError(e.message || 'Impersonation failed')
    }
    setOpeningId(null)
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 920 }}>

      {/* Header */}
      <div className="fade-in" style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 4 }}>
          Impersonate Teacher
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Open the teacher PWA in a new tab signed in as the selected teacher — for bug identification only.
        </p>
        <div style={{ width: 48, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 10, borderRadius: 1 }} />
      </div>

      {/* Safety notice */}
      <div style={{
        background: 'var(--crimson-light)', border: '1px solid rgba(139,26,26,0.25)',
        borderRadius: 'var(--radius-md)', padding: '13px 16px', marginBottom: 20,
        display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--crimson)', fontSize: 12.5, lineHeight: 1.6,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <div>
          <strong>Every action you take in the impersonated tab is recorded as that teacher.</strong> Use only for reproducing
          bugs — never for editing their data. Every impersonation start is logged to <code>impersonationAudit</code> in Firestore
          with your email, the teacher's email, timestamp, and user agent.
          <br/>Tip: open the new tab in an Incognito / Private window so it doesn't clobber any existing teacher login.
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: 'var(--crimson-light)', border: '1px solid rgba(139,26,26,0.2)', borderRadius: 'var(--radius-md)', padding: '11px 15px', marginBottom: 16, color: 'var(--crimson)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or class teacher of…"
          style={{ width: '100%', padding: '10px 12px 10px 34px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 14, fontFamily: 'var(--font-body)', color: 'var(--text)', outline: 'none', background: 'var(--white)' }}
        />
      </div>

      {/* Teachers list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--gray-200)', color: 'var(--text-muted)', fontSize: 13.5 }}>
          {teachers.length === 0 ? 'No active teachers found.' : 'No teachers match the search.'}
        </div>
      ) : (
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', overflow: 'hidden' }}>
          {filtered.map((t, i) => {
            const branches = Array.isArray(t.branchCodes) ? t.branchCodes : []
            const isOpening = openingId === t.id
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '13px 16px',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--gray-50)' : 'none',
                background: i % 2 === 0 ? 'var(--white)' : 'var(--gray-50)',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--green-light)', color: 'var(--green-dark)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13.5, fontWeight: 600, flexShrink: 0,
                }}>
                  {(t.fullName || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
                    {t.fullName || '(no name)'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>{t.email || '(no email)'}</span>
                    {t.classTeacherOf && (
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: 'var(--gold-light)', color: 'var(--gold-dark)', fontWeight: 600 }}>
                        Class Teacher · {t.classTeacherOf}
                      </span>
                    )}
                    {branches.map(b => (
                      <span key={b} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: 'var(--green-light)', color: 'var(--green-dark)', fontWeight: 600 }}>
                        {branchLabel(b)}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => impersonate(t)}
                  disabled={isOpening}
                  style={{
                    padding: '8px 14px',
                    background: isOpening ? 'var(--gray-200)' : 'var(--green)',
                    color: isOpening ? 'var(--gray-400)' : 'white',
                    border: 'none', borderRadius: 'var(--radius-sm)',
                    fontSize: 12.5, fontWeight: 600,
                    cursor: isOpening ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {isOpening ? 'Opening…' : <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    Open as
                  </>}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
