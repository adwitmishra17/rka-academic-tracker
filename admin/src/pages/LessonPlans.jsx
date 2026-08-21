import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, query, where, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getApp } from 'firebase/app'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { useNavigate } from 'react-router-dom'
import { format, subDays, startOfWeek, addDays, parseISO, getDay } from 'date-fns'

// CLASSES loaded via useClasses({ includeAll: true })

function weekLabel(weekStart) {
  const s = new Date(weekStart)
  const e = addDays(s, 5)
  return `${format(s,'d MMM')} – ${format(e,'d MMM yyyy')}`
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8]

// '09:07:23' / ISO → 'HH:MM' for the tiny HRMS arrival label.
function fmtInTime(v) {
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

// When was a plan submitted, as 'yyyy-MM-dd' (submittedAt is a Firestore
// Timestamp; adminEdited copies may carry ISO strings — handle both).
function planSubmitDateStr(p) {
  const t = p?.submittedAt
  const d = t?.toDate?.() ?? (t ? new Date(t) : null)
  return d && !isNaN(d) ? format(d, 'yyyy-MM-dd') : null
}

export default function LessonPlans() {
  const { classNames: CLASSES } = useClasses({ includeAll: true })
  const { effectiveBranches } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState([])
  const [teachers, setTeachers] = useState([])
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterClass, setFilterClass] = useState('All')
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterWeek, setFilterWeek] = useState('')
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [editData, setEditData] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Heatmap view state (mirrors the Lesson Log heatmap; plans are
  // forward-looking so future dates are allowed)
  const [view, setView] = useState('list') // 'list' | 'heatmap'
  const [pdDate, setPdDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [pdShowOnlyMissing, setPdShowOnlyMissing] = useState(false)
  const [pdTimetable, setPdTimetable] = useState([])
  const [pdDayPlans, setPdDayPlans] = useState([])
  const [pdLoading, setPdLoading] = useState(false)
  // Live HRMS attendance for pdDate (null = unavailable / future date).
  const [pdHrms, setPdHrms] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const [plansSnap, teachersSnap, fieldsDoc] = await Promise.all([
          getDocs(query(collection(db, 'lessonPlans'), ...branchConstraints('branchCode', effectiveBranches))),
          getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))),
          getDocs(query(collection(db, 'settings'))),
        ])
        setPlans(plansSnap.docs.map(d => ({ id:d.id, ...d.data() }))
          .filter(p => p.status !== 'superseded')
          .sort((a,b) => (b.dateStr||'').localeCompare(a.dateStr||'')))
        setTeachers(teachersSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        const fDoc = fieldsDoc.docs.find(d => d.id === 'lessonPlanFields')
        if (fDoc?.data()?.fields) setFields(fDoc.data().fields)
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [effectiveBranches])

  // Load heatmap data for the selected date
  useEffect(() => {
    if (view !== 'heatmap') return
    async function loadPd() {
      setPdLoading(true)
      try {
        let plansForDay = []
        try {
          const snap = await getDocs(query(
            collection(db, 'lessonPlans'),
            where('dateStr', '==', pdDate),
            ...branchConstraints('branchCode', effectiveBranches),
          ))
          plansForDay = snap.docs.map(d => ({ id:d.id, ...d.data() }))
        } catch(e) {
          const all = await getDocs(query(collection(db, 'lessonPlans'), ...branchConstraints('branchCode', effectiveBranches)))
          plansForDay = all.docs.map(d => ({ id:d.id, ...d.data() })).filter(p => p.dateStr === pdDate)
        }
        const ttSnap = await getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches)))
        setPdTimetable(ttSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        setPdDayPlans(plansForDay.filter(p => p.status !== 'superseded'))
      } catch(e) { console.error('Plan heatmap load error:', e) }
      setPdLoading(false)
    }
    loadPd()
  }, [view, pdDate, effectiveBranches])

  // Live HRMS attendance — joins via teacher.hrmsEmployeeId. Only meaningful
  // for today/past (future dates have no punches yet); failure = no badges.
  useEffect(() => {
    if (view !== 'heatmap') return
    let cancelled = false
    setPdHrms(null)
    if (pdDate > format(new Date(), 'yyyy-MM-dd')) return
    // Functions codebase pins region asia-south2 (setGlobalOptions) — the
    // client default is us-central1, so the region must be explicit here.
    httpsCallable(getFunctions(getApp(), 'asia-south2'), 'getHrmsDayAttendance')({ date: pdDate })
      .then(res => { if (!cancelled) setPdHrms(res.data) })
      .catch(err => { console.warn('HRMS attendance unavailable:', err?.message || err) })
    return () => { cancelled = true }
  }, [view, pdDate])

  // ============ PLAN HEATMAP COMPUTATION (mirrors Lessons.jsx) ============
  const planHeatmap = useMemo(() => {
    if (view !== 'heatmap') return null
    const dayName = DAYS_OF_WEEK[getDay(parseISO(pdDate))]
    const dayLower = dayName.toLowerCase()
    const todaySlots = pdTimetable.filter(s => (s.day || '').toLowerCase() === dayLower)

    const teacherIdsWithSlots = new Set(todaySlots.map(s => s.teacherId).filter(Boolean))
    const allRelevantTeachers = teachers.filter(t => teacherIdsWithSlots.has(t.id))

    const slotMap = {}
    todaySlots.forEach(s => {
      if (!s.teacherId || !s.period) return
      if (!slotMap[s.teacherId]) slotMap[s.teacherId] = {}
      slotMap[s.teacherId][s.period] = s
    })

    // Plans key to their timetable slot directly (periodId = slot doc id);
    // legacy plans without periodId fall back to (teacher, period) matching.
    const planBySlot = new Map()
    const legacyPlans = []
    pdDayPlans.forEach(p => {
      if (p.periodId) { if (!planBySlot.has(p.periodId)) planBySlot.set(p.periodId, p) }
      else legacyPlans.push(p)
    })

    function computeStatus(teacherId, period) {
      const slot = slotMap[teacherId]?.[period]
      if (!slot) return { status: 'free', slot: null, plan: null }
      const plan = planBySlot.get(slot.id)
        || legacyPlans.find(p => p.teacherId === teacherId && Number(p.period) === Number(period))
      if (!plan) return { status: 'missing', slot, plan: null }
      // A plan should be written BEFORE the teaching day — submitted on the
      // day itself (or after) counts as covered, but flagged late.
      const submitted = planSubmitDateStr(plan)
      if (submitted && submitted >= pdDate) return { status: 'late', slot, plan }
      return { status: 'planned', slot, plan }
    }

    // HRMS overlay: same rules as the Lesson Log heatmap — only when the day
    // shows real staff activity, soft "no punch yet" before 11 AM today.
    const hrmsMap = (pdHrms && pdHrms.date === pdDate && pdHrms.staffDayActive)
      ? pdHrms.byEmployee : null
    const softMorning = pdDate === format(new Date(), 'yyyy-MM-dd') && new Date().getHours() < 11

    const rows = allRelevantTeachers.map(t => {
      let cells = PERIODS.map(p => ({ period: p, ...computeStatus(t.id, p) }))

      const hrms = (hrmsMap && t.hrmsEmployeeId) ? hrmsMap[t.hrmsEmployeeId] : null
      let hrmsBadge = null
      if (hrms) {
        if (hrms.status === 'leave') hrmsBadge = { kind: 'leave', text: 'On leave · HRMS' }
        else if (hrms.status === 'no_punch') {
          hrmsBadge = softMorning
            ? { kind: 'nopunch', text: 'No punch yet · HRMS' }
            : { kind: 'absent', text: 'Absent · HRMS' }
        } else if (hrms.status === 'present' && hrms.in) {
          hrmsBadge = { kind: 'present', text: `in ${fmtInTime(hrms.in)}` }
        }
      }
      if (hrmsBadge && (hrmsBadge.kind === 'absent' || hrmsBadge.kind === 'leave')) {
        cells = cells.map(c => c.status === 'missing' ? { ...c, status: 'absent', hrmsAbsent: true } : c)
      }

      const scheduledCount = cells.filter(c => c.status !== 'free' && c.status !== 'absent').length
      const plannedCount = cells.filter(c => c.status === 'planned' || c.status === 'late').length
      const missingCount = cells.filter(c => c.status === 'missing').length
      const lateCount = cells.filter(c => c.status === 'late').length
      return { teacher: t, cells, scheduledCount, plannedCount, missingCount, lateCount, hrmsBadge }
    }).sort((a, b) => {
      if (a.missingCount !== b.missingCount) return b.missingCount - a.missingCount
      return a.teacher.fullName.localeCompare(b.teacher.fullName)
    })

    let totalScheduled = 0, totalPlanned = 0, totalLate = 0
    const periodMissing = { 1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0 }
    rows.forEach(r => {
      r.cells.forEach(c => {
        if (c.status === 'free' || c.status === 'absent') return
        totalScheduled++
        if (c.status === 'planned') totalPlanned++
        if (c.status === 'late') { totalPlanned++; totalLate++ }
        if (c.status === 'missing') periodMissing[c.period]++
      })
    })
    const coverage = totalScheduled > 0 ? Math.round((totalPlanned / totalScheduled) * 100) : 0
    let mostMissedPeriod = null, mostMissedCount = 0
    Object.keys(periodMissing).forEach(p => {
      if (periodMissing[p] > mostMissedCount) { mostMissedCount = periodMissing[p]; mostMissedPeriod = p }
    })
    const hrmsAbsentCount = rows.filter(r => r.hrmsBadge?.kind === 'absent').length
    const hrmsLeaveCount = rows.filter(r => r.hrmsBadge?.kind === 'leave').length
    return { dayName, rows, totalScheduled, totalPlanned, totalLate, coverage, mostMissedPeriod, mostMissedCount, hrmsAbsentCount, hrmsLeaveCount }
  }, [view, pdDate, pdTimetable, pdDayPlans, teachers, pdHrms])

  const pdVisibleRows = planHeatmap
    ? (pdShowOnlyMissing ? planHeatmap.rows.filter(r => r.missingCount > 0) : planHeatmap.rows)
    : []

  const weeks = [...new Set(plans.map(p => p.weekStart).filter(Boolean))].sort().reverse()

  const filtered = plans.filter(p =>
    (filterClass === 'All' || p.className === filterClass) &&
    (!filterTeacher || p.teacherId === filterTeacher) &&
    (!filterWeek || p.weekStart === filterWeek)
  )

  // Group by week → teacher → date
  const grouped = filtered.reduce((acc, p) => {
    const wk = p.weekStart || 'Unknown'
    if (!acc[wk]) acc[wk] = {}
    const tId = p.teacherName || p.teacherId || 'Unknown'
    if (!acc[wk][tId]) acc[wk][tId] = []
    acc[wk][tId].push(p)
    return acc
  }, {})

  async function handleDelete(planId) {
    if (!confirm('Delete this lesson plan? This cannot be undone.')) return
    try {
      await deleteDoc(doc(db, 'lessonPlans', planId))
      setPlans(prev => prev.filter(p => p.id !== planId))
      if (selectedPlan?.id === planId) setSelectedPlan(null)
    } catch(e) { console.error(e) }
  }

  async function handleSave() {
    if (!selectedPlan) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'lessonPlans', selectedPlan.id), { data: editData, adminEdited: true, adminEditedAt: new Date().toISOString() })
      setPlans(prev => prev.map(p => p.id === selectedPlan.id ? { ...p, data: editData } : p))
      setSelectedPlan(p => ({ ...p, data: editData }))
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none', boxSizing:'border-box' }

  function renderPlanHeatmap() {
    const today = format(new Date(), 'yyyy-MM-dd')
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')
    return (
      <div>
        {/* Filters — plans are forward-looking, so future dates are allowed */}
        <div style={{ display:'flex', gap:12, marginBottom:18, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)' }}>Date</label>
            <input type="date" value={pdDate} onChange={e => setPdDate(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)' }} />
            {pdDate !== today && (
              <button onClick={() => setPdDate(today)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Today</button>
            )}
            {pdDate !== tomorrow && (
              <button onClick={() => setPdDate(tomorrow)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Tomorrow →</button>
            )}
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text)', cursor:'pointer', padding:'8px 12px', background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)' }}>
            <input type="checkbox" checked={pdShowOnlyMissing} onChange={e => setPdShowOnlyMissing(e.target.checked)} />
            Show only teachers with missing plans
          </label>
        </div>

        {pdLoading ? (
          <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
        ) : !planHeatmap || planHeatmap.rows.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
            <p style={{ color:'var(--text-muted)', fontSize:14 }}>No timetable slots scheduled for {format(parseISO(pdDate), 'EEEE, d MMM yyyy')}.</p>
            <p style={{ color:'var(--text-muted)', fontSize:13, marginTop:4 }}>Add periods in the Timetable to see plan coverage here.</p>
          </div>
        ) : (
          <>
            {/* Stats banner */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:18 }}>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 18px', borderTop:'3px solid var(--green)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', lineHeight:1 }}>{planHeatmap.coverage}%</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>Coverage · {planHeatmap.totalPlanned} of {planHeatmap.totalScheduled} periods planned</div>
              </div>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 18px', borderTop:'3px solid var(--gold)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--gold-dark)', lineHeight:1 }}>{planHeatmap.totalLate}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>Submitted on/after the day (not in advance)</div>
              </div>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 18px', borderTop:'3px solid var(--crimson)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--crimson)', lineHeight:1 }}>{planHeatmap.mostMissedPeriod ? `P${planHeatmap.mostMissedPeriod}` : '—'}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>Most unplanned period{planHeatmap.mostMissedCount > 0 ? ` · ${planHeatmap.mostMissedCount} missing` : ''}</div>
              </div>
            </div>

            {/* Legend */}
            <div style={{ display:'flex', gap:18, marginBottom:14, fontSize:11, color:'var(--text-muted)', flexWrap:'wrap' }}>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--green)', borderRadius:3, display:'inline-block' }} /> Planned in advance</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--gold)', borderRadius:3, display:'inline-block' }} /> Submitted on/after the day</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--crimson-light)', border:'1px dashed var(--crimson)', borderRadius:3, display:'inline-block' }} /> No plan</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--gray-100)', borderRadius:3, display:'inline-block' }} /> No period scheduled</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--gray-100)', color:'var(--text-muted)', borderRadius:3, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700 }}>A</span> Absent (HRMS)</span>
            </div>

            {/* HRMS day summary — only when the overlay found someone away */}
            {(planHeatmap.hrmsAbsentCount > 0 || planHeatmap.hrmsLeaveCount > 0) && (
              <div style={{ marginBottom:14, padding:'8px 14px', background:'var(--crimson-light)', borderRadius:'var(--radius-sm)', fontSize:12, color:'var(--crimson)', fontWeight:500 }}>
                Per HRMS biometric records: {planHeatmap.hrmsAbsentCount > 0 && `${planHeatmap.hrmsAbsentCount} teacher${planHeatmap.hrmsAbsentCount > 1 ? 's' : ''} absent`}
                {planHeatmap.hrmsAbsentCount > 0 && planHeatmap.hrmsLeaveCount > 0 && ' · '}
                {planHeatmap.hrmsLeaveCount > 0 && `${planHeatmap.hrmsLeaveCount} on leave`} — their unplanned periods are excused above.
              </div>
            )}

            {/* Heatmap grid */}
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', overflow:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:'4px 4px', padding:'12px' }}>
                <thead>
                  <tr>
                    <th style={{ padding:'6px 10px', textAlign:'left', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', minWidth:160 }}>Teacher</th>
                    {PERIODS.map(p => (
                      <th key={p} style={{ padding:'6px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', textAlign:'center', minWidth:48 }}>P{p}</th>
                    ))}
                    <th style={{ padding:'6px 10px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', textAlign:'right' }}>Planned</th>
                  </tr>
                </thead>
                <tbody>
                  {pdVisibleRows.map(row => (
                    <tr key={row.teacher.id}>
                      <td style={{ padding:'6px 10px', fontSize:12, color:'var(--text)', fontWeight:500 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:24, height:24, borderRadius:'50%', background: row.missingCount > 0 ? 'var(--crimson-light)' : 'var(--green-light)', color: row.missingCount > 0 ? 'var(--crimson)' : 'var(--green)', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{(row.teacher.fullName||'?')[0]}</div>
                          <span>{row.teacher.fullName}</span>
                          {row.hrmsBadge && (row.hrmsBadge.kind === 'present' ? (
                            <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:400, whiteSpace:'nowrap' }}>{row.hrmsBadge.text}</span>
                          ) : (
                            <span style={{
                              fontSize:9.5, fontWeight:600, whiteSpace:'nowrap', padding:'2px 7px', borderRadius:8,
                              background: row.hrmsBadge.kind === 'absent' ? 'var(--crimson-light)' : row.hrmsBadge.kind === 'leave' ? 'var(--gold-light, #fdf3d8)' : 'var(--gray-100)',
                              color: row.hrmsBadge.kind === 'absent' ? 'var(--crimson)' : row.hrmsBadge.kind === 'leave' ? 'var(--gold-dark)' : 'var(--text-muted)',
                            }}>{row.hrmsBadge.text}</span>
                          ))}
                        </div>
                      </td>
                      {row.cells.map(cell => {
                        let bg = 'var(--gray-100)', color = 'var(--gray-400)', label = '', border = 'none', cursor = 'default'
                        if (cell.status === 'planned') { bg = 'var(--green)'; color = 'white'; label = '✓'; cursor = 'pointer' }
                        else if (cell.status === 'late') { bg = 'var(--gold)'; color = 'white'; label = '⏱'; cursor = 'pointer' }
                        else if (cell.status === 'missing') { bg = 'var(--crimson-light)'; color = 'var(--crimson)'; label = '✕'; border = '1px dashed var(--crimson)' }
                        else if (cell.status === 'absent') { bg = 'var(--gray-100)'; color = 'var(--text-muted)'; label = 'A' }
                        const canOpen = cell.plan && (cell.status === 'planned' || cell.status === 'late')
                        return (
                          <td key={cell.period} style={{ padding:0, textAlign:'center' }}>
                            <button
                              onClick={() => canOpen && (setSelectedPlan(cell.plan), setEditData(cell.plan.data || {}))}
                              disabled={!canOpen}
                              title={cell.slot ? `${cell.slot.className || ''} · ${cell.slot.subject || ''}${cell.hrmsAbsent ? ' · Absent per HRMS' : ''}${cell.status === 'late' ? ` · submitted ${planSubmitDateStr(cell.plan) || ''}` : ''}` : 'No period'}
                              style={{ width:'100%', height:32, background: bg, color, border, borderRadius:5, fontSize:12, fontWeight:700, cursor, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-body)' }}
                            >{label}</button>
                          </td>
                        )
                      })}
                      <td style={{ padding:'6px 10px', textAlign:'right', fontSize:11, color: row.missingCount > 0 ? 'var(--crimson)' : 'var(--green-mid)', fontWeight:600 }}>
                        {row.plannedCount}/{row.scheduledCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pdShowOnlyMissing && pdVisibleRows.length === 0 && (
              <div style={{ textAlign:'center', padding:32, background:'var(--green-light)', borderRadius:'var(--radius-md)', marginTop:14 }}>
                <p style={{ color:'var(--green-dark)', fontSize:13, fontWeight:500 }}>✓ No missing plans! Every scheduled period for {format(parseISO(pdDate), 'EEEE d MMM')} has a lesson plan.</p>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  if (selectedPlan) return (
    <div style={{ padding:'28px 36px', maxWidth:800 }}>
      <button onClick={() => { setSelectedPlan(null); setEditData({}) }} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:20, padding:0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Lesson Plans
      </button>

      <div style={{ background:'var(--green-dark)', borderRadius:'var(--radius-lg)', padding:'20px 24px', marginBottom:24, color:'white', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg, var(--gold), transparent)' }} />
        <div style={{ fontSize:16, fontWeight:600, marginBottom:6 }}>{selectedPlan.teacherName} — {selectedPlan.className} · {selectedPlan.subject}</div>
        <div style={{ fontSize:13, opacity:0.7 }}>
          {selectedPlan.dateStr} · Period {selectedPlan.period} · {selectedPlan.periodTime}
          {selectedPlan.adminEdited && <span style={{ marginLeft:10, background:'rgba(201,162,39,0.2)', padding:'2px 8px', borderRadius:8, fontSize:11, color:'var(--gold)' }}>Admin edited</span>}
        </div>
      </div>

      {saved && <div style={{ background:'var(--green)', color:'white', padding:'10px 16px', borderRadius:'var(--radius-md)', marginBottom:16, fontSize:13, fontWeight:500 }}>✓ Plan updated successfully</div>}

      <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:24 }}>
        {(fields.length > 0 ? fields : Object.keys(selectedPlan.data||{}).map(id => ({ id, label:id, type:'textarea', required:false }))).map(f => (
          <div key={f.id}>
            <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>
              {f.label}
              {f.required && <span style={{ color:'var(--crimson)', marginLeft:3 }}>*</span>}
            </label>
            {f.type === 'textarea' ? (
              <textarea value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} rows={3} style={{ ...inp, resize:'vertical' }} />
            ) : f.type === 'select' ? (
              <select value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} style={inp}>
                <option value="">Select…</option>
                {(f.options||[]).map(o => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input type="text" value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} style={inp} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:10 }}>
        <button onClick={handleSave} disabled={saving} style={{ padding:'12px 32px', background: saving?'var(--gray-200)':'var(--green)', color: saving?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: saving?'not-allowed':'pointer', boxShadow: saving?'none':'0 2px 8px rgba(26,74,46,0.25)' }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={() => handleDelete(selectedPlan.id)} style={{ padding:'12px 20px', background:'var(--crimson-light)', color:'var(--crimson)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:'pointer' }}>
          Delete Plan
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ padding:'28px 36px', maxWidth: view === 'heatmap' ? 1400 : 1100 }}>
      <div className="fade-in" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Lesson Plans</h1>
        <p style={{ fontSize:14, color:'var(--text-muted)' }}>{view === 'list' ? 'All teacher-submitted lesson plans. Click any plan to view or edit.' : 'Daily plan coverage heatmap — who has a lesson plan for each scheduled period'}</p>
        <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {/* View toggle (mirrors the Lesson Log page) */}
      <div style={{ display:'flex', gap:2, marginBottom:22, borderBottom:'1px solid var(--gray-100)' }}>
        <button onClick={() => setView('list')} style={{ padding:'10px 20px', background:'none', border:'none', borderBottom: view === 'list' ? '2px solid var(--green)' : '2px solid transparent', color: view === 'list' ? 'var(--green-dark)' : 'var(--text-muted)', fontSize:13, fontWeight: view === 'list' ? 600 : 500, cursor:'pointer', fontFamily:'var(--font-body)', marginBottom:-1, display:'flex', alignItems:'center', gap:7 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          List view
        </button>
        <button onClick={() => setView('heatmap')} style={{ padding:'10px 20px', background:'none', border:'none', borderBottom: view === 'heatmap' ? '2px solid var(--green)' : '2px solid transparent', color: view === 'heatmap' ? 'var(--green-dark)' : 'var(--text-muted)', fontSize:13, fontWeight: view === 'heatmap' ? 600 : 500, cursor:'pointer', fontFamily:'var(--font-body)', marginBottom:-1, display:'flex', alignItems:'center', gap:7 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Heatmap
        </button>
      </div>

      {view === 'heatmap' ? renderPlanHeatmap() : (<>
      {/* Filters */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:24 }}>
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          <option value="">All teachers</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
        </select>
        <select value={filterWeek} onChange={e => setFilterWeek(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          <option value="">All weeks</option>
          {weeks.map(w => <option key={w} value={w}>{weekLabel(w)}</option>)}
        </select>
        <div style={{ marginLeft:'auto', fontSize:13, color:'var(--text-muted)', alignSelf:'center' }}>{filtered.length} plan{filtered.length!==1?'s':''}</div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:64 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 24px', background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:14 }}>
          No lesson plans submitted yet.
        </div>
      ) : (
        Object.entries(grouped).sort((a,b) => b[0].localeCompare(a[0])).map(([week, byTeacher]) => (
          <div key={week} style={{ marginBottom:28 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
              <span>Week of {weekLabel(week)}</span>
              <div style={{ flex:1, height:1, background:'var(--gray-100)' }} />
              <span>{Object.values(byTeacher).flat().length} plans</span>
            </div>
            {Object.entries(byTeacher).map(([teacherName, teacherPlans]) => (
              <div key={teacherName} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', marginBottom:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{teacherName}</span>
                  <span style={{ fontSize:12, color:'var(--green-mid)' }}>{teacherPlans.length} period{teacherPlans.length!==1?'s':''}</span>
                </div>
                <div style={{ padding:'8px 12px', display:'flex', flexDirection:'column', gap:6 }}>
                  {teacherPlans.sort((a,b) => (a.dateStr||'').localeCompare(b.dateStr||'')).map(plan => (
                    <div key={plan.id} onClick={() => { setSelectedPlan(plan); setEditData(plan.data||{}) }} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', borderRadius:'var(--radius-md)', background:'var(--gray-50)', cursor:'pointer', transition:'background 0.15s' }}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--green-light)'}
                      onMouseLeave={e=>e.currentTarget.style.background='var(--gray-50)'}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', gap:7, alignItems:'center', marginBottom:3, flexWrap:'wrap' }}>
                          <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{plan.dateStr} · Period {plan.period}</span>
                          <span style={{ fontSize:11, padding:'1px 7px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{plan.className}</span>
                          <span style={{ fontSize:11, padding:'1px 7px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)' }}>{plan.subject}</span>
                          {plan.adminEdited && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'rgba(201,162,39,0.15)', color:'var(--gold-dark)' }}>Edited</span>}
                        </div>
                        {plan.data?.topics && <div style={{ fontSize:12, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{plan.data.topics}</div>}
                      </div>
                        <button onClick={e => { e.stopPropagation(); handleDelete(plan.id) }} style={{ padding:'4px 10px', background:'var(--crimson-light)', color:'var(--crimson)', border:'none', borderRadius:'var(--radius-sm)', fontSize:11, fontWeight:500, cursor:'pointer', flexShrink:0 }}>Delete</button>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ flexShrink:0 }}><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
      </>)}
    </div>
  )
}
