// =========================================================================
// StudentAttendanceTab.jsx — list of attendance entries for one student
// Shows latest 60 days, summary stats at top
// =========================================================================

import React, { useState, useEffect } from 'react'
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { friendlyDateLabel } from '../lib/attendanceDates'

export default function StudentAttendanceTab({ studentId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const q = query(
          collection(db, 'studentAttendance'),
          where('studentId', '==', studentId),
          orderBy('date', 'desc'),
          limit(60),
        )
        const snap = await getDocs(q)
        if (cancelled) return
        setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [studentId])

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading attendance…</div>
  if (error) return <div style={{ padding: 16, color: 'var(--crimson)' }}>Error: {error}</div>
  if (entries.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)' }}>
        No attendance recorded yet for this student.
      </div>
    )
  }

  const presentCount = entries.filter(e => e.status === 'present' && !e.isLate).length
  const lateCount = entries.filter(e => e.status === 'present' && e.isLate).length
  const absentCount = entries.filter(e => e.status === 'absent').length
  const total = entries.length
  const pct = total > 0 ? Math.round(((presentCount + lateCount) / total) * 100) : 0

  return (
    <div>
      {/* Stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 10, marginBottom: 14,
      }}>
        <Stat label="Recorded" value={total} />
        <Stat label="Present" value={presentCount} color="var(--green)" />
        <Stat label="Late" value={lateCount} color="#c9a227" />
        <Stat label="Absent" value={absentCount} color="var(--crimson)" />
        <Stat label="Attendance" value={pct + '%'} color="var(--green-dark)" />
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
        Showing last {entries.length} marked days. Step-2 reporting will add monthly working-days breakdown.
      </p>

      {/* Entries */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Marked by</th>
              <th style={thStyle}>When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              let label, color
              if (e.status === 'absent') { label = 'Absent'; color = 'var(--crimson)' }
              else if (e.isLate) { label = 'Present (Late)'; color = '#c9a227' }
              else { label = 'Present'; color = 'var(--green)' }
              const when = e.editedAt
                ? formatDateTime(e.editedAt) + ' (edited)'
                : formatDateTime(e.markedAt)
              return (
                <tr key={e.id} style={{ borderBottom: i < entries.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                  <td style={tdStyle}>{friendlyDateLabel(e.date)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>
                  </td>
                  <td style={tdStyle}>
                    <span>{e.markedByName || '?'}</span>
                    <span style={{
                      fontSize: 10, marginLeft: 6, padding: '2px 8px', borderRadius: 10,
                      background: e.markedByRole === 'admin' ? 'rgba(201,162,39,0.15)' : 'rgba(26,74,46,0.1)',
                      color: e.markedByRole === 'admin' ? '#8a6d18' : 'var(--green-dark)',
                      fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>{e.markedByRole === 'admin' ? 'Admin' : 'Teacher'}</span>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>{when}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color || 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function formatDateTime(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
}

const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }
const tdStyle = { padding: '11px 14px', verticalAlign: 'top', color: 'var(--text)' }
