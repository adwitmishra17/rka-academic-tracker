import React, { useState, useEffect } from 'react'
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useNavigate } from 'react-router-dom'

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
      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
      letterSpacing: '0.04em', textTransform: 'uppercase',
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

const PAGE_SIZE = 200

export default function StudentAuditLog() {
  const nav = useNavigate()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterAction, setFilterAction] = useState('All')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const q = query(
          collection(db, 'studentAudit'),
          orderBy('performedAt', 'desc'),
          limit(PAGE_SIZE),
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
  }, [])

  const visible = filterAction === 'All' ? entries : entries.filter(e => e.action === filterAction)

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1300 }}>
      <button
        onClick={() => nav('/students')}
        style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0,
        }}
      >
        ← Back to Students
      </button>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600,
          color: 'var(--green-dark)', marginBottom: 6,
        }}>
          Student Audit Log
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Most recent {PAGE_SIZE} actions across all students.
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 10, borderRadius: 1 }} />
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'var(--white)', border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16,
      }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Filter
        </label>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          style={{
            border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
            padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', color: 'var(--text)',
            background: 'var(--white)',
          }}
        >
          <option value="All">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {visible.length} entries
        </div>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
      {error && <div style={{ padding: 16, color: 'var(--crimson)', background: 'var(--crimson-light)' }}>Error: {error}</div>}

      {!loading && !error && visible.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)' }}>
          No audit entries.
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Student</th>
                <th style={thStyle}>Class</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>By</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                  <td style={tdStyle}>{formatDate(e.performedAt)}</td>
                  <td style={tdStyle}>
                    <a
                      href="#"
                      onClick={(ev) => { ev.preventDefault(); nav('/students/' + e.studentId) }}
                      style={{ color: 'var(--green-dark)', textDecoration: 'none', fontWeight: 500 }}
                    >
                      {e.studentName}
                    </a>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: 'var(--text-muted)' }}>{e.className}</span>
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>({e.branchCode})</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ACTION_COLORS[e.action] || 'var(--text)' }}>
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 500 }}>{e.performedByName || '(unknown)'}</span>
                      <RoleBadge role={e.performedByRole} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
