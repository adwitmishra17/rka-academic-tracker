import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, setDoc, deleteDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchLabel } from '../lib/branch'
import { CLASS_NAMES } from '../lib/classes'

/* Non-working days (school calendar for STUDENT attendance).
   Written to Firestore `nonWorkingDays`, mirrored into the SMS Supabase
   `school_non_working_days` by the syncNonWorkingDays Cloud Function.
   Consumed by: the Teacher PWA (blocks marking on these days) and the SMS
   consecutive-absence flag (excludes these days). Sundays are always off. */

function eachDate(start, end) {
  const out = []
  const s = new Date(start + 'T00:00:00')
  const e = new Date((end || start) + 'T00:00:00')
  if (isNaN(s) || isNaN(e) || e < s) return out
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
const fmt = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export default function NonWorkingDays() {
  const { user, allowedBranches = [] } = useAuth()

  const [rows, setRows]       = useState(null)   // null = loading
  const [date, setDate]       = useState('')
  const [endDate, setEndDate] = useState('')
  const [label, setLabel]     = useState('')
  const [branchCode, setBranchCode] = useState('')
  const [className, setClassName]   = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const canBoth = allowedBranches.length > 1
  useEffect(() => { if (allowedBranches.length === 1) setBranchCode(allowedBranches[0]) }, [allowedBranches])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'nonWorkingDays'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))   // newest first
        setRows(list)
      },
      () => setRows([]))
    return unsub
  }, [])

  async function add() {
    setError('')
    if (!date) { setError('Pick a start date.'); return }
    if (!label.trim()) { setError('Add a label (e.g. Diwali).'); return }
    const days = eachDate(date, endDate)
    if (!days.length) { setError('The "to" date must be on or after the "from" date.'); return }
    setSaving(true)
    try {
      const actor = user?.email || user?.phoneNumber || user?.uid || 'admin'
      for (const d of days) {
        const id = `${d}|${branchCode || 'ALL'}|${className || 'ALL'}`
        await setDoc(doc(db, 'nonWorkingDays', id), {
          date: d,
          label: label.trim(),
          branchCode: branchCode || null,   // null = both branches
          className: className || null,     // null = all classes
          createdBy: actor,
          createdAt: Timestamp.now(),
        })
      }
      setDate(''); setEndDate(''); setLabel(''); setClassName('')
    } catch (e) { setError(e.message || 'Could not save.') }
    setSaving(false)
  }

  async function remove(id) {
    if (!window.confirm('Remove this non-working day?')) return
    try { await deleteDoc(doc(db, 'nonWorkingDays', id)) } catch (e) { setError(e.message) }
  }

  const inp = { padding: '9px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none' }
  const lbl = { fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }

  const branchOpts = canBoth
    ? [{ value: '', label: 'Both branches' }, ...allowedBranches.map((b) => ({ value: b, label: branchLabel(b) }))]
    : allowedBranches.map((b) => ({ value: b, label: branchLabel(b) }))

  return (
    <div style={{ padding: '24px 28px', maxWidth: 840 }}>
      <div className="fade-in" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 3 }}>Non-working Days</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Mark holidays / off days. Teachers can’t take attendance on these days, and they’re excluded from the consecutive-absence flag. Sundays are always off.
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      {/* Add form */}
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label style={lbl}>From date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inp, width: '100%' }} /></div>
          <div><label style={lbl}>To date <span style={{ color: 'var(--gray-400)' }}>(optional — for a range)</span></label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...inp, width: '100%' }} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Label</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Diwali, Sports Day, Rainy day" style={{ ...inp, width: '100%' }} /></div>
          <div><label style={lbl}>Branch</label>
            <select value={branchCode} onChange={(e) => setBranchCode(e.target.value)} style={{ ...inp, width: '100%' }}>
              {branchOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Applies to</label>
            <select value={className} onChange={(e) => setClassName(e.target.value)} style={{ ...inp, width: '100%' }}>
              <option value="">All classes</option>
              {CLASS_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {error && <div style={{ fontSize: 13, color: 'var(--crimson)', marginTop: 12 }}>{error}</div>}
        <button onClick={add} disabled={saving} style={{ marginTop: 14, padding: '11px 20px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : 'Add non-working day'}
        </button>
      </div>

      {/* List */}
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--gray-100)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Marked days</h3>
        </div>
        {rows == null ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No non-working days marked yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)' }}>
                {['Date', 'Label', 'Branch', 'Applies to', ''].map((h) => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--gray-50)' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 500 }}>{fmt(r.date)}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text)' }}>{r.label || '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>{r.branchCode ? branchLabel(r.branchCode) : 'Both'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>{r.className || 'All classes'}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <button onClick={() => remove(r.id)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', fontSize: 18, lineHeight: 1 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
