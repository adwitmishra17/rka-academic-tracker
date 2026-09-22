// admin/src/pages/examinations/DatesheetStage.jsx
// ============================================================================
// Stage: Date sheet (exam timetable) — one COMBINED sheet per class band:
//   Nursery–UKG · Classes 1–10 · Classes 11–12.
// Unions the examined subjects across the band's classes; each subject is
// scheduled once and applied to every class in the band that sits it (written
// onto that class's exam_papers). Exports a Date × Class grid PDF whose QR
// opens the public verification page (the live band schedule).
// ============================================================================

import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { examApi } from '../../lib/api'
import { exportDatesheetPDF } from '../../lib/datesheetPdf'
import { inp, lbl, card, th, td, Btn, Note, Spinner } from './ui.jsx'

const ACTIVITY = new Set(['cuet', 'eca', 'reading/writing', 'reading / writing', 'reading writing', 'discipline', 'work education'])
const isActivity = (n) => ACTIVITY.has(String(n || '').trim().toLowerCase())
const norm = (s) => String(s || '').trim().toLowerCase()

const gradeOf = (c) => { const l = norm(c); if (l.includes('nursery')) return -3; if (l.includes('lkg')) return -2; if (l.includes('ukg')) return -1; const m = l.match(/class\s*(\d+)/); return m ? Number(m[1]) : 999 }
const bandOf = (c) => { const g = gradeOf(c); if (g <= -1) return 'pre'; if (g >= 1 && g <= 10) return 'main'; if (g === 11 || g === 12) return 'senior'; return null }
const BANDS = [{ key: 'pre', label: 'Nursery–UKG' }, { key: 'main', label: 'Classes 1–10' }, { key: 'senior', label: 'Classes 11–12' }]

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const isSunday = (d) => { try { return new Date(d + 'T00:00:00Z').getUTCDay() === 0 } catch { return false } }
const dayShort = (d) => { if (!d) return ''; try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) } catch { return '' } }

// "Class 1..Class 10" → "1–10"; pre-primary / streams shown short.
const shortClass = (c) => c.replace(/^Class\s*/i, '')
function compactClasses(names, bandClasses) {
  if (names.length === bandClasses.length) return 'All'
  const nums = names.map(gradeOf).filter((g) => g >= 1 && g <= 12).sort((a, b) => a - b)
  if (nums.length === names.length && nums.length > 2) {
    const parts = []; let s = nums[0], p = nums[0]
    for (let i = 1; i <= nums.length; i++) { if (nums[i] === p + 1) { p = nums[i]; continue } parts.push(s === p ? `${s}` : `${s}–${p}`); s = nums[i]; p = nums[i] }
    return parts.join(', ')
  }
  return names.map(shortClass).join(', ')
}

export default function DatesheetStage({ branch, sessionCode, classNames }) {
  const bandClasses = useMemo(() => {
    const g = { pre: [], main: [], senior: [] }
    for (const c of (classNames || [])) { const b = bandOf(c); if (b) g[b].push(c) }
    for (const k of Object.keys(g)) g[k].sort((a, b) => gradeOf(a) - gradeOf(b))
    return g
  }, [classNames])

  const [band, setBand] = useState('main')
  const [loaded, setLoaded] = useState(null)   // { terms, perClass: Map<class,{subById,papers}> }
  const [termId, setTermId] = useState('')
  const [rows, setRows] = useState([])          // [{key, subject, classes:[{className,subjectId}], sort, examDate, startTime, endTime, venue}]
  const [frame, setFrame] = useState({ start: '', end: '' })
  const [defTime, setDefTime] = useState({ start: '10:00', end: '13:00' })
  const [holidays, setHolidays] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState('')

  const classes = bandClasses[band] || []

  // Load every class in the band + holidays.
  useEffect(() => {
    let cancelled = false
    if (!classes.length) { setLoaded({ terms: [], perClass: new Map() }); return }
    setLoading(true); setError(''); setLoaded(null); setRows([]); setTermId(''); setMsg(null)
    Promise.all([
      Promise.all(classes.map((c) => examApi.classPapers(branch, sessionCode, c).then((r) => [c, r]).catch(() => [c, null]))),
      getDocs(collection(db, 'nonWorkingDays')).then((snap) => {
        const set = new Set(); snap.forEach((d) => { const x = d.data(); if ((x.branchCode == null || x.branchCode === branch) && x.date) set.add(x.date) }); return set
      }).catch(() => new Set()),
    ]).then(([results, hol]) => {
      if (cancelled) return
      const perClass = new Map(); let terms = []
      for (const [c, r] of results) {
        if (!r) continue
        if (!terms.length && r.terms?.length) terms = r.terms
        perClass.set(c, { subById: new Map((r.subjects || []).map((s) => [s.id, s])), papers: r.papers || [] })
      }
      setLoaded({ terms, perClass }); setHolidays(hol)
      const withPapers = new Set()
      for (const { papers } of perClass.values()) for (const p of papers) withPapers.add(p.term_id)
      const t = terms.find((x) => withPapers.has(x.id)) || terms[0]
      if (t) setTermId(t.id)
    }).catch((e) => { if (!cancelled) setError(e.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branch, sessionCode, band, JSON.stringify(classes)])

  const term = useMemo(() => (loaded?.terms || []).find((t) => t.id === termId), [loaded, termId])

  // Union the band's examined scholastic subjects for the selected term.
  useEffect(() => {
    if (!loaded || !termId) { setRows([]); return }
    const union = new Map()
    for (const [className, { subById, papers }] of loaded.perClass) {
      const seen = new Set()
      for (const p of papers) {
        if (p.term_id !== termId) continue
        const s = subById.get(p.subject_id)
        if (!s || (s.kind && s.kind !== 'scholastic') || isActivity(s.subject_name)) continue
        const key = norm(s.subject_name)
        if (seen.has(key + '|' + className)) continue
        seen.add(key + '|' + className)
        const u = union.get(key) || { key, subject: s.subject_name, classes: [], sort: s.sort_order ?? 999, examDate: '', startTime: '', endTime: '', venue: '' }
        u.classes.push({ className, subjectId: p.subject_id })
        u.sort = Math.min(u.sort, s.sort_order ?? 999)
        if (p.exam_date && !u.examDate) { u.examDate = p.exam_date; u.startTime = (p.exam_start_time || '').slice(0, 5); u.endTime = (p.exam_end_time || '').slice(0, 5); u.venue = p.venue || '' }
        union.set(key, u)
      }
    }
    setRows([...union.values()].sort((a, b) => (b.classes.length - a.classes.length) || a.sort - b.sort || a.subject.localeCompare(b.subject)))
    setFrame({ start: term?.starts_on || '', end: term?.ends_on || '' })
    setMsg(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, termId])

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
    setError(ranPast ? 'Arranged, but it runs past the frame’s end date — widen the frame or edit dates.' : '')
    setMsg(ranPast ? null : 'Arranged — review, then Save.')
  }

  async function save() {
    setSaving(true); setError(''); setMsg(null)
    try {
      const slots = rows.flatMap((r) => r.classes.map((c) => ({ subjectId: c.subjectId, examDate: r.examDate || null, startTime: r.startTime || null, endTime: r.endTime || null, venue: r.venue || null })))
      const { saved } = await examApi.saveDatesheet({ branchCode: branch, sessionCode, className: BANDS.find((b) => b.key === band)?.label, termId, slots })
      setMsg(`Saved — ${rows.filter((r) => r.examDate).length} subjects across ${classes.length} classes (${saved} slots).`)
      return true
    } catch (e) { setError(e.message || String(e)); return false }
    finally { setSaving(false) }
  }

  const bandLabel = BANDS.find((b) => b.key === band)?.label || ''
  const verifyUrl = termId ? `${window.location.origin}/verify/datesheet?b=${encodeURIComponent(branch)}&s=${encodeURIComponent(sessionCode)}&t=${encodeURIComponent(termId)}&classes=${encodeURIComponent(classes.join(','))}&label=${encodeURIComponent(bandLabel)}` : ''

  async function saveAndPdf() {
    const dated = rows.filter((r) => r.examDate)
    if (!dated.length) { setError('No dates set yet — Auto-arrange or enter dates first.'); return }
    setBusy(true); setError('')
    try {
      if (!(await save())) return
      await exportDatesheetPDF(dated, { branch, bandLabel, classes, session: sessionCode, termName: term?.name || 'Exam', verifyUrl })
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <span style={lbl}>Band</span>
            <select value={band} onChange={(e) => setBand(e.target.value)} style={{ ...inp, minWidth: 150 }}>
              {BANDS.map((b) => <option key={b.key} value={b.key} disabled={!(bandClasses[b.key] || []).length}>{b.label}{(bandClasses[b.key] || []).length ? '' : ' (none)'}</option>)}
            </select>
          </div>
          <div>
            <span style={lbl}>Exam</span>
            <select value={termId} onChange={(e) => setTermId(e.target.value)} style={{ ...inp, minWidth: 140 }}>
              {(loaded?.terms || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          {bandLabel}: <b>{classes.map(shortClass).join(', ') || '—'}</b>. A subject scheduled here applies to every class in the band that sits it.
        </div>
        {(msg || error) && <div style={{ marginTop: 8, fontSize: 12.5, color: error ? 'var(--crimson)' : 'var(--green-dark)' }}>{error || msg}</div>}
      </div>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <Note tone="gold">No examined subjects for this band + exam yet. Generate the term's papers for these classes in the <b>Papers</b> stage first.</Note>
      ) : (
        <>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 32 }}>#</th>
                    <th style={th}>Subject</th>
                    <th style={th}>Classes</th>
                    <th style={{ ...th, width: 150 }}>Date</th>
                    <th style={{ ...th, width: 50 }}>Day</th>
                    <th style={{ ...th, width: 200 }}>Time</th>
                    <th style={{ ...th, width: 130 }}>Venue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const holiday = r.examDate && (isSunday(r.examDate) || holidays.has(r.examDate))
                    return (
                      <tr key={r.key}>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{r.subject}</td>
                        <td style={{ ...td, fontSize: 11.5, color: 'var(--text-muted)' }}>{compactClasses(r.classes.map((c) => c.className), classes)}</td>
                        <td style={td}><input type="date" value={r.examDate || ''} min={frame.start || undefined} max={frame.end || undefined} onChange={(e) => setRow(i, 'examDate', e.target.value)} style={{ ...inp, width: '100%', ...(holiday ? { borderColor: 'var(--crimson)', color: 'var(--crimson)' } : {}) }} /></td>
                        <td style={{ ...td, color: holiday ? 'var(--crimson)' : 'var(--text-muted)', fontSize: 11.5 }}>{dayShort(r.examDate)}</td>
                        <td style={td}>
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input type="time" value={r.startTime || ''} onChange={(e) => setRow(i, 'startTime', e.target.value)} style={{ ...inp, width: 88 }} />
                            <span style={{ color: 'var(--text-muted)' }}>–</span>
                            <input type="time" value={r.endTime || ''} onChange={(e) => setRow(i, 'endTime', e.target.value)} style={{ ...inp, width: 88 }} />
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
            Red dates fall on a Sunday or a marked holiday. The PDF is a Date × Class grid; its QR opens a public verification page for the whole band — <b>Save & export</b> keeps them in sync.
            {verifyUrl && <> · <a href={verifyUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--green-dark)', fontWeight: 600 }}>Open verify page</a></>}
          </div>
        </>
      )}
    </div>
  )
}
