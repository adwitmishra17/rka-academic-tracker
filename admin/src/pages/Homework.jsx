import React, { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, deleteDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getApp } from 'firebase/app'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { format, parseISO, getDay } from 'date-fns'

// ============================================================
// Homework oversight (Firestore `homework`, written by the teacher PWA).
//  - List view: every homework broadcast, filterable + deletable.
//  - Heatmap view: daily compliance grid — for each scheduled class·subject,
//    was homework set that day. Mirrors the Lesson Log heatmap (timetable +
//    arrangements + live HRMS absence overlay). Homework is per class·subject
//    per day (no period), so all periods of the same class share one status.
// ============================================================

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8]
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const fmtInTime = (v) => { if (!v) return ''; const s = String(v); const m = s.match(/(\d{1,2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : s }

export default function Homework() {
  const { effectiveBranches } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [view, setView] = useState('list')      // 'list' | 'heatmap'

  // ---- list state ----
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fromDate, setFromDate] = useState(daysAgo(14))
  const [toDate, setToDate] = useState(daysAgo(0))
  const [classFilter, setClassFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [text, setText] = useState('')

  // ---- heatmap state ----
  const [teachers, setTeachers] = useState([])
  const [hmDate, setHmDate] = useState(today)
  const [hmShowOnlyMissing, setHmShowOnlyMissing] = useState(false)
  const [hmTimetable, setHmTimetable] = useState([])
  const [hmDayHw, setHmDayHw] = useState([])
  const [hmArrangements, setHmArrangements] = useState([])
  const [hmLoading, setHmLoading] = useState(false)
  const [hmDetail, setHmDetail] = useState(null)
  const [hmHrms, setHmHrms] = useState(null)

  async function load() {
    setLoading(true); setError('')
    try {
      const snap = await getDocs(query(collection(db, 'homework'), ...branchConstraints('branchCode', effectiveBranches)))
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) { console.error('homework load error:', e); setError(e.message) }
    setLoading(false)
  }
  useEffect(() => { load() }, [effectiveBranches])   // eslint-disable-line react-hooks/exhaustive-deps

  // teachers (heatmap rows)
  useEffect(() => {
    getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches)))
      .then(s => setTeachers(s.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [effectiveBranches])

  // heatmap day data
  useEffect(() => {
    if (view !== 'heatmap') return
    async function loadHm() {
      setHmLoading(true)
      try {
        let hwForDay = []
        try {
          const snap = await getDocs(query(
            collection(db, 'homework'),
            where('assignedDate', '==', hmDate),
            ...branchConstraints('branchCode', effectiveBranches),
          ))
          hwForDay = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        } catch {
          const all = await getDocs(query(collection(db, 'homework'), ...branchConstraints('branchCode', effectiveBranches)))
          hwForDay = all.docs.map(d => ({ id: d.id, ...d.data() })).filter(h => h.assignedDate === hmDate)
        }
        let arrangements = []
        try {
          const arrSnap = await getDocs(query(collection(db, 'arrangements'), where('date', '==', hmDate), ...branchConstraints('branchCode', effectiveBranches)))
          arrangements = arrSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        } catch { /* arrangements optional */ }
        const ttSnap = await getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches)))
        setHmTimetable(ttSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setHmDayHw(hwForDay)
        setHmArrangements(arrangements)
      } catch (e) { console.error('Homework heatmap load error:', e) }
      setHmLoading(false)
    }
    loadHm()
  }, [view, hmDate, effectiveBranches])

  // live HRMS attendance for the day (asia-south2, like the lesson heatmap)
  useEffect(() => {
    if (view !== 'heatmap') return
    let cancelled = false
    setHmHrms(null)
    httpsCallable(getFunctions(getApp(), 'asia-south2'), 'getHrmsDayAttendance')({ date: hmDate })
      .then(res => { if (!cancelled) setHmHrms(res.data) })
      .catch(err => { console.warn('HRMS attendance unavailable:', err?.message || err) })
    return () => { cancelled = true }
  }, [view, hmDate])

  // ---- list derived ----
  const classes = useMemo(() => [...new Set(rows.map(r => r.className).filter(Boolean))].sort(), [rows])
  const sections = useMemo(() => [...new Set(rows.map(r => r.section).filter(Boolean))].sort(), [rows])
  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase()
    return rows
      .filter(r =>
        (!fromDate || (r.assignedDate || '') >= fromDate) &&
        (!toDate || (r.assignedDate || '') <= toDate) &&
        (!classFilter || r.className === classFilter) &&
        (!sectionFilter || r.section === sectionFilter) &&
        (!t || (r.subject || '').toLowerCase().includes(t) || (r.teacherName || '').toLowerCase().includes(t) || (r.title || '').toLowerCase().includes(t)))
      .sort((a, b) => (b.assignedDate || '').localeCompare(a.assignedDate || '') || (a.className || '').localeCompare(b.className || ''))
  }, [rows, fromDate, toDate, classFilter, sectionFilter, text])

  async function handleDelete(r) {
    if (!window.confirm(`Delete "${r.title}" (${r.className}-${r.section}, ${r.subject})?`)) return
    try { await deleteDoc(doc(db, 'homework', r.id)); setRows(prev => prev.filter(x => x.id !== r.id)) }
    catch (e) { setError(`Delete failed: ${e.message}`) }
  }

  // ============ HEATMAP COMPUTATION ============
  const heatmap = useMemo(() => {
    if (view !== 'heatmap') return null
    const dayName = DAYS_OF_WEEK[getDay(parseISO(hmDate))]
    const dayLower = dayName.toLowerCase()
    const todaySlots = hmTimetable.filter(s => (s.day || '').toLowerCase() === dayLower)
    const teacherIdsWithSlots = new Set(todaySlots.map(s => s.teacherId).filter(Boolean))
    const relevantTeachers = teachers.filter(t => teacherIdsWithSlots.has(t.id))

    const slotMap = {}
    todaySlots.forEach(s => {
      if (!s.teacherId || !s.period) return
      if (!slotMap[s.teacherId]) slotMap[s.teacherId] = {}
      slotMap[s.teacherId][s.period] = s
    })
    hmArrangements.forEach(arr => {
      if (!arr.coveringTeacherId || !arr.absentTeacherId || !arr.period) return
      const original = slotMap[arr.absentTeacherId]?.[arr.period]
      if (!original) return
      slotMap[arr.absentTeacherId][arr.period] = { ...original, _absent: true }
      if (!slotMap[arr.coveringTeacherId]) slotMap[arr.coveringTeacherId] = {}
      slotMap[arr.coveringTeacherId][arr.period] = { ...original, _covering: true, _coveringFor: arr.absentTeacherName }
    })

    // Homework is class-level and period-less. A scheduled class·subject "has
    // homework" if the teacher who owns that slot broadcast homework for that
    // class + subject that day. Timetable slots carry NO section, so teacher
    // identity (homework.teacherEmail ↔ teacher.email — the same join the
    // exam-subject assignment uses) is what disambiguates two teachers who
    // share a class+subject; matching on class+subject alone would credit both.
    function computeStatus(teacherId, teacherEmail, period) {
      const slot = slotMap[teacherId]?.[period]
      if (!slot) return { status: 'free', slot: null, homework: null }
      if (slot._absent) return { status: 'absent', slot, homework: null }
      const slotClassNames = Array.isArray(slot.classNames) && slot.classNames.length
        ? slot.classNames.map(c => (c || '').trim())
        : (slot.className || '').split('+').map(c => c.trim()).filter(Boolean)
      const subj = (slot.subject || '').toLowerCase().trim()
      const hw = hmDayHw.find(h => {
        if ((h.subject || '').toLowerCase().trim() !== subj) return false
        const hwClass = (h.className || '').trim()
        if (!slotClassNames.some(c => c === hwClass)) return false
        // Attribute to the slot's teacher when we can (covering teacher included).
        if (teacherEmail && h.teacherEmail && String(h.teacherEmail).toLowerCase().trim() !== teacherEmail) return false
        return true
      })
      return hw ? { status: 'set', slot, homework: hw } : { status: 'missing', slot, homework: null }
    }

    const hrmsMap = (hmHrms && hmHrms.date === hmDate && hmHrms.staffDayActive) ? hmHrms.byEmployee : null
    const softMorning = hmDate === today && new Date().getHours() < 11

    const rows_ = relevantTeachers.map(t => {
      const tEmail = (t.email || t.personalEmail || '').toLowerCase().trim()
      let cells = PERIODS.map(p => ({ period: p, ...computeStatus(t.id, tEmail, p) }))
      const hrms = (hrmsMap && t.hrmsEmployeeId) ? hrmsMap[t.hrmsEmployeeId] : null
      let hrmsBadge = null
      if (hrms) {
        if (hrms.status === 'leave') hrmsBadge = { kind: 'leave', text: 'On leave · HRMS' }
        else if (hrms.status === 'no_punch') hrmsBadge = softMorning ? { kind: 'nopunch', text: 'No punch yet · HRMS' } : { kind: 'absent', text: 'Absent · HRMS' }
        else if (hrms.status === 'present' && hrms.in) hrmsBadge = { kind: 'present', text: `in ${fmtInTime(hrms.in)}` }
      }
      if (hrmsBadge && (hrmsBadge.kind === 'absent' || hrmsBadge.kind === 'leave')) {
        cells = cells.map(c => c.status === 'missing' ? { ...c, status: 'absent', hrmsAbsent: true } : c)
      }
      const scheduledCount = cells.filter(c => c.status !== 'free' && c.status !== 'absent').length
      const setCount = cells.filter(c => c.status === 'set').length
      const missingCount = cells.filter(c => c.status === 'missing').length
      return { teacher: t, cells, scheduledCount, setCount, missingCount, hrmsBadge }
    }).sort((a, b) => (b.missingCount - a.missingCount) || a.teacher.fullName.localeCompare(b.teacher.fullName))

    let totalScheduled = 0, totalSet = 0
    const periodMissing = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 }
    rows_.forEach(r => r.cells.forEach(c => {
      if (c.status === 'free' || c.status === 'absent') return
      totalScheduled++
      if (c.status === 'set') totalSet++
      if (c.status === 'missing') periodMissing[c.period]++
    }))
    const compliance = totalScheduled > 0 ? Math.round((totalSet / totalScheduled) * 100) : 0
    let mostMissedPeriod = null, mostMissedCount = 0
    Object.keys(periodMissing).forEach(p => { if (periodMissing[p] > mostMissedCount) { mostMissedCount = periodMissing[p]; mostMissedPeriod = p } })
    const hrmsAbsentCount = rows_.filter(r => r.hrmsBadge?.kind === 'absent').length
    const hrmsLeaveCount = rows_.filter(r => r.hrmsBadge?.kind === 'leave').length
    return { dayName, rows: rows_, totalScheduled, totalSet, compliance, mostMissedPeriod, mostMissedCount, hrmsAbsentCount, hrmsLeaveCount }
  }, [view, hmDate, hmTimetable, hmDayHw, hmArrangements, teachers, hmHrms, today])

  const visibleRows = heatmap ? (hmShowOnlyMissing ? heatmap.rows.filter(r => r.missingCount > 0) : heatmap.rows) : []

  const input = { padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--white)' }
  const th = { textAlign: 'left', padding: '9px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }
  const td = { padding: '9px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

  return (
    <div style={{ padding: 24, maxWidth: view === 'heatmap' ? 1400 : 1100 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>Homework</h1>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {view === 'list' ? (loading ? 'Loading…' : `${filtered.length} of ${rows.length} entries`) : 'Daily compliance heatmap — which scheduled classes got homework'}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 14 }}>
        Given from the teacher app; parents see it per class-section in the parent app.
      </p>

      {/* View tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--gray-200)' }}>
        <button onClick={() => setView('list')} style={tabStyle(view === 'list')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
          List view
        </button>
        <button onClick={() => setView('heatmap')} style={tabStyle(view === 'heatmap')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          Heatmap
        </button>
      </div>

      {error && <div style={{ background: '#fdecea', border: '1px solid rgba(139,26,26,0.25)', color: 'var(--crimson)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {view === 'list' ? renderList() : renderHeatmap()}

      {/* Detail panel */}
      {hmDetail && (
        <div onClick={() => setHmDetail(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(420px, 90vw)', height: '100%', background: 'var(--white)', boxShadow: 'var(--shadow-lg)', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--green-dark)' }}>Period {hmDetail.period} · {hmDetail.teacher.fullName}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{format(parseISO(hmDate), 'EEEE, d MMMM yyyy')}</p>
              </div>
              <button onClick={() => setHmDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22 }}>×</button>
            </div>
            {hmDetail.status === 'set' && (
              <div style={{ background: 'var(--green-light)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>✓ Homework set</div>
                <div style={{ fontSize: 13, color: 'var(--green-dark)', fontWeight: 500 }}>{hmDetail.slot.className} · {hmDetail.slot.subject}</div>
              </div>
            )}
            {hmDetail.status === 'missing' && (
              <div style={{ background: 'var(--crimson-light)', border: '1px solid rgba(139,26,26,0.2)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--crimson)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>✕ No homework set</div>
                <div style={{ fontSize: 13, color: 'var(--crimson)', fontWeight: 500 }}>{hmDetail.slot.className} · {hmDetail.slot.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--crimson)', marginTop: 6, opacity: 0.85 }}>This class·subject was scheduled today but no homework was broadcast for it.</div>
              </div>
            )}
            {hmDetail.homework && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Homework</div>
                  <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>{hmDetail.homework.title || '—'}</div>
                  {hmDetail.homework.description && <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{hmDetail.homework.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
                  <div><div style={metaLabel}>Due</div><div style={{ fontSize: 13 }}>{hmDetail.homework.dueDate || '—'}</div></div>
                  <div><div style={metaLabel}>Set by</div><div style={{ fontSize: 13 }}>{hmDetail.homework.teacherName || hmDetail.homework.teacherEmail || '—'}</div></div>
                </div>
              </>
            )}
            {hmDetail.slot?._covering && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--gold-light)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--gold-dark)' }}>
                ℹ {hmDetail.teacher.fullName} is covering for {hmDetail.slot._coveringFor || 'an absent teacher'} for this period.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // ===================== LIST =====================
  function renderList() {
    return (
      <>
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
          <input style={{ ...input, minWidth: 200 }} placeholder="Search subject / teacher / title…" value={text} onChange={e => setText(e.target.value)} />
        </div>
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Given</th><th style={th}>Class</th><th style={th}>Subject</th><th style={th}>Homework</th><th style={th}>Due</th><th style={th}>Teacher</th><th style={th} />
            </tr></thead>
            <tbody>
              {!loading && filtered.length === 0 && (
                <tr><td style={{ ...td, color: 'var(--text-muted)', textAlign: 'center' }} colSpan={7}>No homework in this range.</td></tr>
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
                    <button onClick={() => handleDelete(r)} style={{ border: 'none', background: 'none', color: 'var(--crimson)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  // ===================== HEATMAP =====================
  function renderHeatmap() {
    return (
      <div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>Date</label>
            <input type="date" value={hmDate} onChange={e => setHmDate(e.target.value)} max={today} style={{ padding: '8px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)' }} />
            {hmDate !== today && <button onClick={() => setHmDate(today)} style={{ fontSize: 11, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Jump to today</button>}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', cursor: 'pointer', padding: '8px 12px', background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)' }}>
            <input type="checkbox" checked={hmShowOnlyMissing} onChange={e => setHmShowOnlyMissing(e.target.checked)} />
            Show only teachers with missing homework
          </label>
        </div>

        {hmLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><div style={{ width: 32, height: 32, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
        ) : !heatmap || heatmap.rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No timetable slots scheduled for {format(parseISO(hmDate), 'EEEE, d MMM yyyy')}.</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Add periods in the Timetable to see homework compliance here.</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
              <div style={statCard('var(--green)')}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', lineHeight: 1 }}>{heatmap.compliance}%</div>
                <div style={statSub}>Homework set · {heatmap.totalSet} of {heatmap.totalScheduled} scheduled class·subjects</div>
              </div>
              <div style={statCard('var(--gold)')}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--gold-dark)', lineHeight: 1 }}>{heatmap.totalScheduled - heatmap.totalSet}</div>
                <div style={statSub}>Classes without homework today</div>
              </div>
              <div style={statCard('var(--crimson)')}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--crimson)', lineHeight: 1 }}>{heatmap.mostMissedPeriod ? `P${heatmap.mostMissedPeriod}` : '—'}</div>
                <div style={statSub}>Most missed period{heatmap.mostMissedCount > 0 ? ` · ${heatmap.mostMissedCount} missed` : ''}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 18, marginBottom: 14, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span style={legendItem}><span style={{ width: 12, height: 12, background: 'var(--green)', borderRadius: 3, display: 'inline-block' }} /> Homework set</span>
              <span style={legendItem}><span style={{ width: 12, height: 12, background: 'var(--crimson-light)', border: '1px dashed var(--crimson)', borderRadius: 3, display: 'inline-block' }} /> No homework</span>
              <span style={legendItem}><span style={{ width: 12, height: 12, background: 'var(--gray-100)', borderRadius: 3, display: 'inline-block' }} /> No period scheduled</span>
              <span style={legendItem}><span style={{ width: 12, height: 12, background: 'var(--gray-100)', color: 'var(--text-muted)', borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>A</span> Absent (HRMS / arrangement)</span>
            </div>

            {(heatmap.hrmsAbsentCount > 0 || heatmap.hrmsLeaveCount > 0) && (
              <div style={{ marginBottom: 14, padding: '8px 14px', background: 'var(--crimson-light)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--crimson)', fontWeight: 500 }}>
                Per HRMS biometric records: {heatmap.hrmsAbsentCount > 0 && `${heatmap.hrmsAbsentCount} teacher${heatmap.hrmsAbsentCount > 1 ? 's' : ''} absent`}
                {heatmap.hrmsAbsentCount > 0 && heatmap.hrmsLeaveCount > 0 && ' · '}
                {heatmap.hrmsLeaveCount > 0 && `${heatmap.hrmsLeaveCount} on leave`} — their classes are excused above.
              </div>
            )}

            <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-100)', overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '4px 4px', padding: 12 }}>
                <thead><tr>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 160 }}>Teacher</th>
                  {PERIODS.map(p => <th key={p} style={{ padding: 6, fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', minWidth: 48 }}>P{p}</th>)}
                  <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Set</th>
                </tr></thead>
                <tbody>
                  {visibleRows.map(row => (
                    <tr key={row.teacher.id}>
                      <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: row.missingCount > 0 ? 'var(--crimson-light)' : 'var(--green-light)', color: row.missingCount > 0 ? 'var(--crimson)' : 'var(--green)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(row.teacher.fullName || '?')[0]}</div>
                          <span>{row.teacher.fullName}</span>
                          {row.hrmsBadge && (row.hrmsBadge.kind === 'present' ? (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, whiteSpace: 'nowrap' }}>{row.hrmsBadge.text}</span>
                          ) : (
                            <span style={{ fontSize: 9.5, fontWeight: 600, whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: 8, background: row.hrmsBadge.kind === 'absent' ? 'var(--crimson-light)' : row.hrmsBadge.kind === 'leave' ? 'var(--gold-light, #fdf3d8)' : 'var(--gray-100)', color: row.hrmsBadge.kind === 'absent' ? 'var(--crimson)' : row.hrmsBadge.kind === 'leave' ? 'var(--gold-dark)' : 'var(--text-muted)' }}>{row.hrmsBadge.text}</span>
                          ))}
                        </div>
                      </td>
                      {row.cells.map(cell => {
                        let bg = 'var(--gray-100)', color = 'var(--gray-400)', label = '', border = 'none', cursor = 'default'
                        if (cell.status === 'set') { bg = 'var(--green)'; color = 'white'; label = '✓'; cursor = 'pointer' }
                        else if (cell.status === 'missing') { bg = 'var(--crimson-light)'; color = 'var(--crimson)'; label = '✕'; border = '1px dashed var(--crimson)'; cursor = 'pointer' }
                        else if (cell.status === 'absent') { bg = 'var(--gray-100)'; color = 'var(--text-muted)'; label = 'A' }
                        return (
                          <td key={cell.period} style={{ padding: 0, textAlign: 'center' }}>
                            <button
                              onClick={() => cell.status !== 'free' && cell.status !== 'absent' && setHmDetail({ teacher: row.teacher, period: cell.period, slot: cell.slot, homework: cell.homework, status: cell.status })}
                              disabled={cell.status === 'free' || cell.status === 'absent'}
                              title={cell.slot ? `${cell.slot.className || ''} · ${cell.slot.subject || ''}${cell.hrmsAbsent ? ' · Absent per HRMS' : ''}` : 'No period'}
                              style={{ width: '100%', height: 32, background: bg, color, border, borderRadius: 5, fontSize: 12, fontWeight: 700, cursor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)' }}
                            >{label}</button>
                          </td>
                        )
                      })}
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: row.missingCount > 0 ? 'var(--crimson)' : 'var(--green-mid)', fontWeight: 600 }}>{row.setCount}/{row.scheduledCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hmShowOnlyMissing && visibleRows.length === 0 && (
              <div style={{ textAlign: 'center', padding: 32, background: 'var(--green-light)', borderRadius: 'var(--radius-md)', marginTop: 14 }}>
                <p style={{ color: 'var(--green-dark)', fontSize: 13, fontWeight: 500 }}>✓ Every scheduled class got homework today.</p>
              </div>
            )}
          </>
        )}
      </div>
    )
  }
}

function tabStyle(active) {
  return { padding: '10px 20px', background: 'none', border: 'none', borderBottom: active ? '2px solid var(--green)' : '2px solid transparent', color: active ? 'var(--green-dark)' : 'var(--text-muted)', fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'var(--font-body)', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 7 }
}
const statCard = (c) => ({ background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-100)', padding: '14px 18px', borderTop: `3px solid ${c}` })
const statSub = { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }
const legendItem = { display: 'flex', alignItems: 'center', gap: 5 }
const metaLabel = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }
