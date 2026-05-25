import React, { useState, useEffect } from 'react'
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'

const ACTION_LABELS = {
  add: 'Added',
  edit: 'Edited',
  withdraw: 'Withdrawn',
  reactivate: 'Reactivated',
  transfer: 'Transferred',
  delete: 'Deleted',
  csv_import: 'Imported (CSV)',
}

const ACTION_COLORS = {
  add: 'var(--green)',
  edit: 'var(--gold-dark)',
  withdraw: 'var(--crimson)',
  reactivate: 'var(--green)',
  transfer: 'var(--gold-dark)',
  delete: 'var(--crimson)',
  csv_import: 'var(--green)',
}

function RoleBadge({ role }) {
  const isAdmin = role === 'admin'
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      background: isAdmin ? 'rgba(201,162,39,0.15)' : 'rgba(26,74,46,0.1)',
      color: isAdmin ? 'var(--gold-dark)' : 'var(--green-dark)',
    }}>
      {isAdmin ? 'Admin' : 'Class Teacher'}
    </span>
  )
}

function formatDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function ChangedFields({ changes }) {
  if (!changes || typeof changes !== 'object') return null
  const entries = Object.entries(changes)
  if (entries.length === 0) return null
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
      {entries.map(([field, { from, to }]) => (
        <div key={field} style={{ marginBottom: 2 }}>
          <strong style={{ color: 'var(--text)' }}>{field}:</strong>{' '}
          <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{String(from ?? '')}</span>
          {' → '}
          <span style={{ color: 'var(--green-dark)', fontWeight: 500 }}>{String(to ?? '')}</span>
        </div>
      ))}
    </div>
  )
}

export default function StudentAuditTab({ studentId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const q = query(
          collection(db, 'studentAudit'),
          where('studentId', '==', studentId),
          orderBy('performedAt', 'desc'),
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

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading history…</div>
  if (error) return <div style={{ padding: 16, color: 'var(--crimson)' }}>Error: {error}</div>
  if (entries.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center' }}>
        No audit history yet. Actions will appear here as they happen.
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--gray-100)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
            <th style={thStyle}>When</th>
            <th style={thStyle}>Action</th>
            <th style={thStyle}>By</th>
            <th style={thStyle}>Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.id} style={{ borderBottom: i < entries.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
              <td style={tdStyle}>{formatDate(e.performedAt)}</td>
              <td style={tdStyle}>
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: ACTION_COLORS[e.action] || 'var(--text)',
                }}>
                  {ACTION_LABELS[e.action] || e.action}
                </span>
              </td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500 }}>{e.performedByName || '(unknown)'}</span>
                  <RoleBadge role={e.performedByRole} />
                </div>
              </td>
              <td style={tdStyle}>
                <ChangedFields changes={e.changedFields} />
                {e.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{e.notes}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const thStyle = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 10.5,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
}

const tdStyle = {
  padding: '12px 14px',
  verticalAlign: 'top',
  color: 'var(--text)',
}
