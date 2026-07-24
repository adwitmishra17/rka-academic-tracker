import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, deleteDoc, doc, query } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints } from '../lib/branchQuery'

// ============================================================
// Homework oversight — every homework broadcast teachers have given
// (Firestore `homework`, written by the teacher PWA). Filter by
// class, section, subject/teacher text, and date range; admins can
// delete a wrong entry (rules: isSchoolUser). Read-mostly by design —
// authoring happens in the teacher app.
// ============================================================

const daysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function Homework() {
  const { effectiveBranches } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [fromDate, setFromDate] = useState(daysAgo(14))
  const [toDate, setToDate] = useState(daysAgo(0))
  const [classFilter, setClassFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [text, setText] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const snap = await getDocs(query(
        collection(db, 'homework'),
        ...branchConstraints('branchCode', effectiveBranches),
      ))
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) {
      console.error('homework load error:', e)
      setError(e.message)
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [effectiveBranches])   // eslint-disable-line react-hooks/exhaustive-deps

  const classes = useMemo(() =>
    [...new Set(rows.map(r => r.className).filter(Boolean))].sort(), [rows])
  const sections = useMemo(() =>
    [...new Set(rows.map(r => r.section).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase()
    return rows
      .filter(r =>
        (!fromDate || (r.assignedDate || '') >= fromDate) &&
        (!toDate || (r.assignedDate || '') <= toDate) &&
        (!classFilter || r.className === classFilter) &&
        (!sectionFilter || r.section === sectionFilter) &&
        (!t
          || (r.subject || '').toLowerCase().includes(t)
          || (r.teacherName || '').toLowerCase().includes(t)
          || (r.title || '').toLowerCase().includes(t)))
      .sort((a, b) => (b.assignedDate || '').localeCompare(a.assignedDate || '')
        || (a.className || '').localeCompare(b.className || ''))
  }, [rows, fromDate, toDate, classFilter, sectionFilter, text])

  async function handleDelete(r) {
    if (!window.confirm(`Delete "${r.title}" (${r.className}-${r.section}, ${r.subject})?`)) return
    try {
      await deleteDoc(doc(db, 'homework', r.id))
      setRows(prev => prev.filter(x => x.id !== r.id))
    } catch (e) { setError(`Delete failed: ${e.message}`) }
  }

  const input = { padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--white)' }
  const th = { textAlign: 'left', padding: '9px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }
  const td = { padding: '9px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>Homework</h1>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {loading ? 'Loading…' : `${filtered.length} of ${rows.length} entries`}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14 }}>
        Given from the teacher app; parents see it per class-section in the parent app.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input type="date" style={input} value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <input type="date" style={input} value={toDate} onChange={e => setToDate(e.target.value)} />
        <select style={input} value={classFilter} onChange={e => setClassFilter(e.target.value)}>
          <option value="">All classes</option>
          {classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={input} value={sectionFilter} onChange={e => setSectionFilter(e.target.value)}>
          <option value="">All sections</option>
          {sections.map(s => <option key={s} value={s}>Section {s}</option>)}
        </select>
        <input style={{ ...input, minWidth: 200 }} placeholder="Search subject / teacher / title…"
          value={text} onChange={e => setText(e.target.value)} />
      </div>

      {error && <div style={{ background: '#fdecea', border: '1px solid rgba(139,26,26,0.25)', color: 'var(--crimson)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Given</th>
              <th style={th}>Class</th>
              <th style={th}>Subject</th>
              <th style={th}>Homework</th>
              <th style={th}>Due</th>
              <th style={th}>Teacher</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td style={{ ...td, color: 'var(--text-muted)', textAlign: 'center' }} colSpan={7}>
                No homework in this range.
              </td></tr>
            )}
            {filtered.map(r => (
              <tr key={r.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.assignedDate}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.className}-{r.section}</td>
                <td style={td}>{r.subject}</td>
                <td style={{ ...td, maxWidth: 380 }}>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  {r.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{r.description}</div>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.dueDate || '—'}</td>
                <td style={td}>{r.teacherName || r.teacherEmail || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button onClick={() => handleDelete(r)}
                    style={{ border: 'none', background: 'none', color: 'var(--crimson)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
