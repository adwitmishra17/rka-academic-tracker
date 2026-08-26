import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, getDoc, setDoc, doc, query, where, Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase/config'
import { branchLabel } from '../lib/branch'

/* ============================================================
   Monthly Tests — the regime replaces admin scheduling.

   One config doc (settings/testRegime) declares: which months are
   exam/vacation months (no monthly test), default max/pass marks,
   grace days for late entry, and the tested subjects per class.
   Teachers' PWA shows an auto card per (class, subject) they teach;
   the tests/{MT_*} doc materializes on their first marks save.

   This panel is the admin's view: a month rail + a class × subject
   completeness matrix (green done · gold in-progress · red missing
   for past months), plus the regime editor.
   ============================================================ */

export const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
// Academic order: April … March
const SESSION_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]

const sanitize = (s) => String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
export const monthlySlotId = (session, monthNo, className, subject, branchCode) =>
  `MT_${session}_${String(monthNo).padStart(2, '0')}_${sanitize(className)}_${sanitize(subject)}_${sanitize(branchCode || 'MAIN')}`

function sessionCodeNow(d = new Date()) {
  const y = d.getFullYear()
  const sy = (d.getMonth() + 1) >= 4 ? y : y - 1
  return `${sy}-${String((sy + 1) % 100).padStart(2, '0')}`
}
// Calendar year a session-month falls in (Apr–Dec = start year, Jan–Mar = +1)
function yearOfMonth(session, monthNo) {
  const startYear = Number(String(session).slice(0, 4))
  return monthNo >= 4 ? startYear : startYear + 1
}

export default function MonthlyTestsPanel({ classDocs, allowedBranches, currentBranch }) {
  const navigate = useNavigate()
  const [regime, setRegime] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [monthlyDocs, setMonthlyDocs] = useState([])
  const [classSubjectsMap, setClassSubjectsMap] = useState({})
  const [branch, setBranch] = useState(() => currentBranch || allowedBranches[0] || 'MAIN')
  useEffect(() => { if (currentBranch) setBranch(currentBranch) }, [currentBranch])
  const [editorOpen, setEditorOpen] = useState(false)
  const [savingRegime, setSavingRegime] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [editorClass, setEditorClass] = useState('Class 9')

  const session = regime?.session || sessionCodeNow()
  const now = new Date()
  const nowMonth = now.getMonth() + 1
  const [month, setMonth] = useState(nowMonth)

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'settings', 'testRegime')),
      getDocs(query(collection(db, 'tests'), where('kind', '==', 'monthly'))),
      getDoc(doc(db, 'settings', 'classSubjects')),
    ]).then(([rg, ts, cs]) => {
      const r = rg.exists() ? rg.data() : null
      setRegime(r)
      setMonthlyDocs(ts.docs.map(d => ({ id: d.id, ...d.data() })))
      if (cs.exists() && cs.data().map) setClassSubjectsMap(cs.data().map)
      // If the running month is blocked (exam/vacation), open on the latest allowed month ≤ now
      if (r) {
        const blocked = (m) => (r.examMonths || {})[String(m)] || (r.skipMonths || []).includes(m)
        if (blocked(nowMonth)) {
          const past = SESSION_MONTHS.filter(m =>
            !blocked(m) && (yearOfMonth(r.session || sessionCodeNow(), m) < now.getFullYear()
              || (yearOfMonth(r.session || sessionCodeNow(), m) === now.getFullYear() && m <= nowMonth)))
          if (past.length) setMonth(past[past.length - 1])
        }
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blockReason = (m) => {
    if (!regime) return null
    return (regime.examMonths || {})[String(m)] || ((regime.skipMonths || []).includes(m) ? 'Vacation' : null)
  }

  // Time relation of the selected month to today (drives pending-colour)
  const monthYear = yearOfMonth(session, month)
  const monthState = monthYear < now.getFullYear() || (monthYear === now.getFullYear() && month < nowMonth)
    ? 'past' : (monthYear === now.getFullYear() && month === nowMonth) ? 'current' : 'future'

  // Classes shown: this branch's classes that the regime tests (non-empty subject list)
  const rows = useMemo(() => {
    if (!regime) return []
    const branchClasses = [...new Set((classDocs || []).filter(c => c.branchCode === branch).map(c => c.className))]
    const list = branchClasses.length ? branchClasses : Object.keys(regime.testedSubjects || {})
    return list
      .filter(cls => (regime.testedSubjects?.[cls] || []).length > 0)
      .map(cls => ({ className: cls, subjects: regime.testedSubjects[cls] }))
  }, [regime, classDocs, branch])

  const docsById = useMemo(() => new Map(monthlyDocs.map(t => [t.id, t])), [monthlyDocs])

  function cellStatus(cls, subject) {
    const id = monthlySlotId(session, month, cls, subject, branch)
    const t = docsById.get(id)
    if (t) return { status: t.marksEntered ? 'done' : 'started', id }
    return { status: 'pending', id }
  }

  // ── Regime editor helpers ──
  function patchRegime(patch) { setRegime(r => ({ ...(r || {}), ...patch })) }
  async function saveRegime() {
    if (!regime) return
    setSavingRegime(true)
    try {
      await setDoc(doc(db, 'settings', 'testRegime'), {
        ...regime,
        session: regime.session || sessionCodeNow(),
        updatedAt: Timestamp.now(),
      }, { merge: false })
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000)
    } catch (e) { console.error(e); alert('Could not save: ' + (e.message || e)) }
    setSavingRegime(false)
  }
  function toggleTested(cls, subject) {
    const cur = regime?.testedSubjects?.[cls] || []
    const next = cur.includes(subject) ? cur.filter(s => s !== subject) : [...cur, subject].sort()
    patchRegime({ testedSubjects: { ...(regime?.testedSubjects || {}), [cls]: next } })
  }
  function setExamMonth(label, m) {
    const ex = { ...(regime?.examMonths || {}) }
    for (const k of Object.keys(ex)) if (ex[k] === label) delete ex[k]
    if (m) ex[String(m)] = label
    patchRegime({ examMonths: ex })
  }
  function toggleSkipMonth(m) {
    const cur = regime?.skipMonths || []
    patchRegime({ skipMonths: cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m].sort((a, b) => a - b) })
  }

  if (!loaded) {
    return <div style={{ textAlign: 'center', padding: 48 }}><div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
  }
  if (!regime) {
    return (
      <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '28px 22px', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500 }}>Monthly-test regime is not set up.</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>The settings/testRegime document is missing — seed it from the Classes &amp; Subjects list, then reload.</p>
      </div>
    )
  }

  const EXAM_LABELS = ['Periodic Test 1', 'Half Yearly', 'Periodic Test 2', 'Annual Exam']
  const examMonthOf = (label) => {
    const ex = regime.examMonths || {}
    const hit = Object.entries(ex).find(([, v]) => v === label)
    return hit ? Number(hit[0]) : ''
  }
  const chip = (bg, fg, bd) => ({ fontSize: 11.5, padding: '4px 10px', borderRadius: 12, background: bg, color: fg, border: `1px solid ${bd}`, fontWeight: 500, cursor: 'pointer', lineHeight: 1.4 })

  return (
    <div className="fade-in">
      {/* Controls row: branch + regime toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {allowedBranches.length > 1 && !currentBranch && (
          <div style={{ display: 'flex', gap: 6 }}>
            {allowedBranches.map(b => (
              <button key={b} onClick={() => setBranch(b)} style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid', borderColor: branch === b ? 'var(--green)' : 'var(--gray-200)', background: branch === b ? 'var(--green)' : 'var(--white)', color: branch === b ? 'white' : 'var(--text-muted)', fontSize: 12.5, fontWeight: branch === b ? 600 : 400, cursor: 'pointer' }}>{branchLabel(b)}</button>
            ))}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {savedFlash && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>✓ Saved</span>}
          <button onClick={() => setEditorOpen(o => !o)} style={{ padding: '8px 14px', background: editorOpen ? 'var(--green)' : 'var(--white)', color: editorOpen ? 'white' : 'var(--text-muted)', border: `1px solid ${editorOpen ? 'var(--green)' : 'var(--gray-200)'}`, borderRadius: 'var(--radius-md)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
            ⚙ Regime settings
          </button>
        </div>
      </div>

      {/* Regime editor */}
      {editorOpen && (
        <div className="fade-in" style={{ background: 'var(--white)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-lg)', padding: '18px 20px', marginBottom: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Exam months (no monthly test)</div>
              {EXAM_LABELS.map(label => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1 }}>{label}</span>
                  <select value={examMonthOf(label)} onChange={e => setExamMonth(label, e.target.value ? Number(e.target.value) : null)} style={{ padding: '5px 8px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5 }}>
                    <option value="">—</option>
                    {SESSION_MONTHS.map(m => <option key={m} value={m}>{MONTH_NAMES[m]}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Vacation months (skipped)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SESSION_MONTHS.map(m => {
                  const on = (regime.skipMonths || []).includes(m)
                  return (
                    <button key={m} onClick={() => toggleSkipMonth(m)} style={chip(on ? 'var(--crimson-light)' : 'var(--white)', on ? 'var(--crimson)' : 'var(--text-muted)', on ? 'rgba(139,26,26,0.25)' : 'var(--gray-200)')}>
                      {MONTH_NAMES[m].slice(0, 3)}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
                <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Max marks<br />
                  <input type="number" value={regime.defaults?.maxMarks ?? 25} onChange={e => patchRegime({ defaults: { ...(regime.defaults || {}), maxMarks: Number(e.target.value || 0) } })} style={{ width: 70, padding: '6px 8px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, marginTop: 3 }} />
                </label>
                <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Pass marks<br />
                  <input type="number" value={regime.defaults?.passMarks ?? 10} onChange={e => patchRegime({ defaults: { ...(regime.defaults || {}), passMarks: Number(e.target.value || 0) } })} style={{ width: 70, padding: '6px 8px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, marginTop: 3 }} />
                </label>
                <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Grace days<br />
                  <input type="number" value={regime.graceDays ?? 7} onChange={e => patchRegime({ graceDays: Number(e.target.value || 0) })} style={{ width: 70, padding: '6px 8px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, marginTop: 3 }} />
                </label>
              </div>
            </div>
          </div>

          {/* Per-class tested subjects */}
          <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tested subjects</div>
              <select value={editorClass} onChange={e => setEditorClass(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5 }}>
                {Object.keys(regime.testedSubjects || {}).sort().map(c => <option key={c}>{c}</option>)}
              </select>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>green = tested monthly · empty list exempts the class</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {[...new Set([...(classSubjectsMap[editorClass] || []), ...(regime.testedSubjects?.[editorClass] || [])])].sort().map(s => {
                const on = (regime.testedSubjects?.[editorClass] || []).includes(s)
                return (
                  <button key={s} onClick={() => toggleTested(editorClass, s)} style={chip(on ? 'var(--green)' : 'var(--white)', on ? 'white' : 'var(--text-muted)', on ? 'var(--green)' : 'var(--gray-200)')}>
                    {s}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveRegime} disabled={savingRegime} style={{ padding: '9px 20px', background: savingRegime ? 'var(--gray-200)' : 'var(--green)', color: savingRegime ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: savingRegime ? 'default' : 'pointer' }}>
              {savingRegime ? 'Saving…' : 'Save regime'}
            </button>
          </div>
        </div>
      )}

      {/* Month rail */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {SESSION_MONTHS.map(m => {
          const reason = blockReason(m)
          const active = month === m
          return (
            <button key={m} onClick={() => !reason && setMonth(m)} disabled={!!reason} title={reason || ''}
              style={{ padding: '7px 12px', borderRadius: 'var(--radius-md)', border: '1px solid', fontSize: 12,
                borderColor: active ? 'var(--green)' : 'var(--gray-200)',
                background: reason ? 'var(--gray-50)' : active ? 'var(--green)' : 'var(--white)',
                color: reason ? 'var(--gray-400)' : active ? 'white' : 'var(--text-muted)',
                fontWeight: active ? 600 : 400, cursor: reason ? 'not-allowed' : 'pointer' }}>
              {MONTH_NAMES[m].slice(0, 3)}
              {reason && <span style={{ display: 'block', fontSize: 9, marginTop: 1 }}>{reason === 'Vacation' ? 'Vacation' : reason.split(' ').map(w => w[0]).join('')}</span>}
            </button>
          )
        })}
      </div>

      {/* Completeness matrix */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '11px 18px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {MONTH_NAMES[month]} · {branchLabel(branch)}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--green)' }}>■</span> done&nbsp;&nbsp;
            <span style={{ color: 'var(--gold)' }}>■</span> in progress&nbsp;&nbsp;
            <span style={{ color: monthState === 'past' ? 'var(--crimson)' : 'var(--gray-400)' }}>■</span> {monthState === 'past' ? 'missing' : monthState === 'future' ? 'not due yet' : 'awaiting'}
          </span>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No classes with tested subjects for {branchLabel(branch)} — set them in ⚙ Regime settings.
          </div>
        ) : rows.map(({ className, subjects }) => {
          const statuses = subjects.map(s => ({ subject: s, ...cellStatus(className, s) }))
          const done = statuses.filter(x => x.status === 'done').length
          return (
            <div key={className} style={{ padding: '12px 18px', borderTop: '1px solid var(--gray-50)' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{className}</span>
                <span style={{ marginLeft: 10, fontSize: 11.5, color: done === subjects.length ? 'var(--green)' : 'var(--text-muted)', fontWeight: 500 }}>
                  {done}/{subjects.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {statuses.map(({ subject, status, id }) => {
                  const clickable = status !== 'pending'
                  const bg = status === 'done' ? 'var(--green)' : status === 'started' ? 'var(--gold-light)' : monthState === 'past' ? 'var(--crimson-light)' : 'var(--gray-50)'
                  const fg = status === 'done' ? 'white' : status === 'started' ? 'var(--gold-dark)' : monthState === 'past' ? 'var(--crimson)' : 'var(--gray-400)'
                  const bd = status === 'done' ? 'var(--green)' : status === 'started' ? 'rgba(201,162,39,0.35)' : monthState === 'past' ? 'rgba(139,26,26,0.2)' : 'var(--gray-200)'
                  return (
                    <button key={subject} onClick={() => clickable && navigate(`/tests/${id}`)}
                      title={status === 'pending' ? 'No marks yet' : 'Open test detail'}
                      style={{ ...chip(bg, fg, bd), cursor: clickable ? 'pointer' : 'default' }}>
                      {subject}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
