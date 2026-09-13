import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { fetchStudents } from '../lib/api'
import { branchConstraintsArray } from '../lib/branchQuery'

// ============================================================================
// COMMAND PALETTE (⌘K / Ctrl+K)
//
// One search box for pages, students and teachers. Pages come from the
// sidebar NAV; students from SMS via /api/students; teachers from Firestore.
// People are loaded lazily the first time the palette opens and cached for
// the session (re-fetched when the branch selection changes).
// ============================================================================

const norm = (s) => (s || '').toString().toLowerCase().trim()

export default function CommandPalette({ open, onClose, pages }) {
  const navigate = useNavigate()
  const { effectiveBranches } = useAuth()
  const [q, setQ] = useState('')
  const [people, setPeople] = useState({ students: [], teachers: [], loaded: false, loading: false })
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const branchKey = JSON.stringify(effectiveBranches)

  useEffect(() => { setPeople({ students: [], teachers: [], loaded: false, loading: false }) }, [branchKey])

  useEffect(() => {
    if (!open) return
    setQ(''); setCursor(0)
    setTimeout(() => inputRef.current?.focus(), 0)
    if (people.loaded || people.loading) return
    setPeople(p => ({ ...p, loading: true }))
    Promise.all([
      fetchStudents({ branchCodes: effectiveBranches }).catch(() => []),
      getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    ]).then(([students, teachers]) => setPeople({ students: students.filter(s => s.isActive !== false), teachers: teachers.filter(t => t.isActive !== false), loaded: true, loading: false }))
  }, [open]) // eslint-disable-line

  const results = useMemo(() => {
    const n = norm(q)
    const pageHits = pages.filter(p => !n || norm(p.label).includes(n) || norm(p.group).includes(n)).slice(0, n ? 6 : 8)
      .map(p => ({ kind: 'page', key: 'p' + p.to, title: p.label, sub: p.group || 'Page', to: p.to }))
    if (!n || n.length < 2) return pageHits
    const studentHits = people.students.filter(s => norm(s.fullName).includes(n) || norm(s.admissionNo).includes(n) || (s.rollNumber && norm(s.rollNumber) === n)).slice(0, 6)
      .map(s => ({ kind: 'student', key: 's' + s.id, title: s.fullName, sub: `${s.className || ''}${s.rollNumber ? ' · Roll ' + s.rollNumber : ''}${s.admissionNo ? ' · ' + s.admissionNo : ''}`, to: `/students/${s.id}` }))
    const teacherHits = people.teachers.filter(t => norm(t.fullName).includes(n) || norm(t.email).includes(n) || norm(t.subject).includes(n)).slice(0, 5)
      .map(t => ({ kind: 'teacher', key: 't' + t.id, title: t.fullName, sub: [t.subject, t.email].filter(Boolean).join(' · ') || 'Teacher', to: `/teacher-management/${t.id}` }))
    return [...pageHits, ...studentHits, ...teacherHits]
  }, [q, pages, people])

  useEffect(() => { setCursor(0) }, [q])

  if (!open) return null

  function go(r) { if (!r) return; onClose(); navigate(r.to) }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]) }
    else if (e.key === 'Escape') { onClose() }
  }

  const KIND = { page: 'Page', student: 'Student', teacher: 'Teacher' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div onMouseDown={e => e.stopPropagation()} style={{ position: 'absolute', top: '12vh', left: '50%', transform: 'translateX(-50%)', width: 'min(640px, 94vw)', background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--gray-100)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search students, teachers, classes, pages…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, fontFamily: 'inherit', color: 'var(--text)' }} />
          <span style={{ fontSize: 11, fontWeight: 600, border: '1px solid var(--gray-200)', borderRadius: 5, padding: '1px 6px', color: 'var(--text-muted)' }}>Esc</span>
        </div>
        <div style={{ maxHeight: '56vh', overflowY: 'auto', padding: 6 }}>
          {results.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{people.loading ? 'Loading people…' : 'No matches.'}</div>
          )}
          {results.map((r, i) => (
            <div key={r.key} onMouseEnter={() => setCursor(i)} onClick={() => go(r)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 9, cursor: 'pointer', background: i === cursor ? 'var(--green-light)' : 'transparent' }}>
              <span style={{ width: 30, height: 30, borderRadius: r.kind === 'page' ? 8 : '50%', background: r.kind === 'page' ? 'var(--gray-50)' : 'var(--house-blue-light)', color: r.kind === 'page' ? 'var(--text-muted)' : 'var(--house-blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {r.kind === 'page' ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg> : (r.title || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub}</div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 99, padding: '2px 8px' }}>{KIND[r.kind]}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '8px 16px', borderTop: '1px solid var(--gray-100)', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>↑↓ move</span><span>↵ open</span><span style={{ marginLeft: 'auto' }}>{people.loaded ? `${people.students.length} students · ${people.teachers.length} teachers` : ''}</span>
        </div>
      </div>
    </div>
  )
}
