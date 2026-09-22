// admin/src/pages/examinations/DatesheetStage.jsx
// ============================================================================
// Stage: Date sheet (exam timetable). Reads the class's Setup subjects that are
// examined this term (via generated papers), lets the office arrange one slot
// per subject within the term's date frame, saves the schedule onto exam_papers
// (exam_date / start / end / venue), and exports a branded PDF whose QR opens
// the public verification page (the live schedule).
// ============================================================================

import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { examApi } from '../../lib/api'
import { exportDatesheetPDF } from '../../lib/datesheetPdf'
import { inp, lbl, card, th, td, Btn, Note, Spinner } from './ui.jsx'

const ACTIVITY = new Set(['cuet', 'eca', 'reading/writing', 'reading / writing', 'reading writing', 'discipline', 'work education'])
const isActivity = (n) => ACTIVITY.has(String(n || '').trim().toLowerCase())

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const isSunday = (d) => { try { return new Date(d + 'T00:00:00Z').getUTCDay() === 0 } catch { return false } }
const dayShort = (d) => { if (!d) return ''; try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) } catch { return '' } }

export default function DatesheetStage({ branch, sessionCode, className }) {
  const [data, setData] = useState(null)      // { terms, subjects, papers }
  const [termId, setTermId] = useState('')
  const [rows, setRows] = useState([])        // [{subjectId, subject, sort, examDate, startTime, endTime, venue}]
  const [frame, setFrame] = useState({ start: '', end: '' })
  const [defTime, setDefTime] = useState({ start: '10:00', end: '13:00' })
  const [holidays, setHolidays] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setData(null); setRows([]); setTermId(''); setMsg(null)
    Promise.all([
      examApi.classPapers(branch, sessionCode, className),
      getDocs(collection(db, 'nonWorkingDays')).then((snap) => {
        const set = new Set()
        snap.forEach((d) => { const x = d.data(); if ((x.branchCode == null || x.branchCode === branch) && (x.className == null || x.className === className) && x.date) set.add(x.date) })
        return set
      }).catch(() => new Set()),
    ]).then(([cp, hol]) => {
      if (cancelled) return
      setData(cp); setHolidays(hol)
      const withPapers = new Set((cp.papers || []).map((p) => p.term_id))
      const t = (cp.terms || []).find((x) => withPapers.has(x.id)) || (cp.terms || [])[0]
      if (t) setTermId(t.id)
    }).catch((e) => { if (!cancelled) setError(e.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branch, sessionCode, className])

  const term = useMemo(() => (data?.terms || []).find((t) => t.id === termId), [data, termId])

  // Build one row per examined scholastic subject when the term changes.
  useEffect(() => {
    if (!data || !termId) { setRows([]); return }
    const subById = new Map((data.subjects || []).map((s) => [s.id, s]))
    const bySub = new Map()
    for (const p of (data.papers || [])) {
      if (p.term_id !== termId) continue
      const s = subById.get(p.subject_id)
      if (!s || (s.kind && s.kind !== 'scholastic') || isActivity(s.subject_name)) continue
      const cur = bySub.get(p.subject_id) || { subjectId: p.subject_id, subject: s.subject_name, sort: s.sort_order ?? 999, examDate: '', startTime: '', endTime: '', venue: '' }
      if (p.exam_date && !cur.examDate) { cur.examDate = p.exam_date; cur.startTime = (p.exam_start_time || '').slice(0, 5); cur.endTime = (p.exam_end_time || '').slice(0, 5); cur.venue = p.venue || '' }
      bySub.set(p.subject_id, cur)
    }
    setRows([...bySub.values()].sort((a, b) => a.sort - b.sort || a.subject.localeCompare(b.subject)))
    setFrame({ start: term?.starts_on || '', end: term?.ends_on || '' })
    setMsg(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, termId])

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))

  function autoArrange() {
    if (!rows.length) return
    let cursor = frame.start || term?.starts_on
    if (!cursor) { setError('Set a start date first.'); return }
    const end = frame.end || term?.ends_on
    let ranPast = false
    const out = rows.map((r) => {
      while (isSunday(cursor) || holidays.has(cursor)) cursor = addDays(cursor, 1)
      if (end && cursor > end) ranPast = true
      const slot = { ...r, examDate: cursor, startTime: r.startTime || defTime.start, endTime: r.endTime || defTime.end }
      cursor = addDays(cursor, 1)
      return slot
    })
    setRows(out)
    setError(ranPast ? 'Arranged, but the schedule runs past the frame’s end date — widen the frame or edit dates.' : '')
    setMsg(ranPast ? null : 'Arranged — review, then Save.')
  }

  async function save() {
    setSaving(true); setError(''); setMsg(null)
    try {
      const slots = rows.map((r) => ({ subjectId: r.subjectId, examDate: r.examDate || null, startTime: r.startTime || null, endTime: r.endTime || null, venue: r.venue || null }))
      const { saved } = await examApi.saveDatesheet({ branchCode: branch, sessionCode, className, termId, slots })
      setMsg(`Saved ${saved} subjects.`)
      return true
    } catch (e) { setError(e.message || String(e)); return false }
    finally { setSaving(false) }
  }

  const verifyUrl = termId ? `${window.location.origin}/verify/datesheet?b=${encodeURIComponent(branch)}&s=${encodeURIComponent(sessionCode)}&c=${encodeURIComponent(className)}&t=${encodeURIComponent(termId)}` : ''

  async function saveAndPdf() {
    const dated = rows.filter((r) => r.examDate)
    if (!dated.length) { setError('No dates set yet — Auto-arrange or enter dates first.'); return }
    setBusy(true); setError('')
    try {
      if (!(await save())) return   // save first so the QR's verify page matches the print
      const ordered = [...dated].sort((a, b) => String(a.examDate).localeCompare(String(b.examDate)) || String(a.startTime || '').localeCompare(String(b.startTime || '')))
      await exportDatesheetPDF(ordered, { branch, className, session: sessionCode, termName: term?.name || 'Exam', verifyUrl })
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controls */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <span style={lbl}>Exam</span>
            <select value={termId} onChange={(e) => setTermId(e.target.value)} style={{ ...inp, minWidth: 150 }}>
              {(data?.terms || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div><span style={lbl}>Frame from</span><input type="date" value={frame.start || ''} onChange={(e) => setFrame((f) => ({ ...f, start: e.target.value }))} style={inp} /></div>
          <div><span style={lbl}>to</span><input type="date" value={frame.end || ''} onChange={(e) => setFrame((f) => ({ ...f, end: e.target.value }))} style={inp} /></div>
          <div><span style={lbl}>Default time</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="time" value={defTime.start} onChange={(e) => setDefTime((t) => ({ ...t, start: e.target.value }))} style={inp} />
              <span style={{ color: 'var(--text-muted)' }}>–</span>
              <input type="time" value={defTime.end} onChange={(e) => setDefTime((t) => ({ ...t, end: e.target.value }))} style={inp} />
            </span>
          </div>
          <Btn kind="ghost" onClick={autoArrange} disabled={!rows.length}>Auto-arrange</Btn>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn kind="ghost" onClick={save} disabled={saving || busy || !rows.length}>{saving ? 'Saving…' : 'Save'}</Btn>
            <Btn kind="primary" onClick={saveAndPdf} disabled={saving || busy || !rows.length}>{busy ? 'Preparing…' : 'Save & export PDF'}</Btn>
          </div>
        </div>
        {(msg || error) && <div style={{ marginTop: 10, fontSize: 12.5, color: error ? 'var(--crimson)' : 'var(--green-dark)' }}>{error || msg}</div>}
      </div>

      {rows.length === 0 ? (
        <Note tone="gold">No examined subjects for this exam yet. Generate the term's papers in the <b>Papers</b> stage first — the date sheet schedules those papers.</Note>
      ) : (
        <>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 32 }}>#</th>
                    <th style={th}>Subject</th>
                    <th style={{ ...th, width: 150 }}>Date</th>
                    <th style={{ ...th, width: 54 }}>Day</th>
                    <th style={{ ...th, width: 210 }}>Time</th>
                    <th style={{ ...th, width: 150 }}>Venue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const holiday = r.examDate && (isSunday(r.examDate) || holidays.has(r.examDate))
                    return (
                      <tr key={r.subjectId}>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{r.subject}</td>
                        <td style={td}><input type="date" value={r.examDate || ''} min={frame.start || undefined} max={frame.end || undefined} onChange={(e) => setRow(i, 'examDate', e.target.value)} style={{ ...inp, width: '100%', ...(holiday ? { borderColor: 'var(--crimson)', color: 'var(--crimson)' } : {}) }} /></td>
                        <td style={{ ...td, color: holiday ? 'var(--crimson)' : 'var(--text-muted)', fontSize: 11.5 }}>{dayShort(r.examDate)}</td>
                        <td style={td}>
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input type="time" value={r.startTime || ''} onChange={(e) => setRow(i, 'startTime', e.target.value)} style={{ ...inp, width: 92 }} />
                            <span style={{ color: 'var(--text-muted)' }}>–</span>
                            <input type="time" value={r.endTime || ''} onChange={(e) => setRow(i, 'endTime', e.target.value)} style={{ ...inp, width: 92 }} />
                          </span>
                        </td>
                        <td style={td}><input value={r.venue || ''} onChange={(e) => setRow(i, 'venue', e.target.value)} placeholder="—" style={{ ...inp, width: '100%' }} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Red dates fall on a Sunday or a marked holiday. The PDF's QR opens a public verification page showing the saved schedule — <b>Save & export</b> keeps the two in sync.
            {verifyUrl && <> · <a href={verifyUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--green-dark)', fontWeight: 600 }}>Open verify page</a></>}
          </div>
        </>
      )}
    </div>
  )
}
