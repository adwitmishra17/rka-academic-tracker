import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, query, Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase/config'
import { useClasses, inferGradeBand } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
// CLASSES loaded via useClasses()
// Subjects loaded from settings/classSubjects
const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

// Shared card vocabulary (matches Dashboard "command centre").
const CARD = { background:'var(--white)', border:'1px solid var(--gray-100)', borderRadius:'var(--radius-lg)', overflow:'hidden' }
const CARD_HEAD = { padding:'13px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }

// Subject → stable hue, so a subject reads as the same colour everywhere.
// Rendered as a translucent tint + a solid dot, so it holds on both the
// light (#FFF) and dark (#22231C) card grounds without hard-coded pastels.
const SUBJECT_HUES = [152, 210, 32, 276, 4, 190, 96, 340, 50, 258, 128, 16, 168, 300]
function subjHue(subject) {
  if (!subject) return null
  let h = 0
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0
  return SUBJECT_HUES[h % SUBJECT_HUES.length]
}
const tintBg  = (hue) => hue == null ? 'transparent' : `hsl(${hue} 48% 50% / 0.13)`
const tintDot = (hue) => hue == null ? 'var(--gray-300)' : `hsl(${hue} 52% 52%)`

function timeToMinutes(t) { const [h,m] = t.split(':').map(Number); return h*60+m }
function minutesToTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` }
const initials = (n) => (n || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0,2).toUpperCase()

// Breaks in the Period Times format (multiple), with the legacy single
// breakAfter/breakDuration fields as fallback for pre-upgrade docs.
function breaksOf(settings) {
  if (settings.breaks?.length) return settings.breaks
  return settings.breakAfter
    ? [{ afterPeriod: Number(settings.breakAfter), duration: Number(settings.breakDuration || 20) }]
    : []
}

function buildSchedule(settings) {
  const { startTime='09:20', weekdayPeriods=8, saturdayPeriods=5 } = settings
  const maxPeriods = Math.max(Number(weekdayPeriods), Number(saturdayPeriods))
  // Per-period durations (Period Times' format); legacy docs carry one flat
  // duration. Same reader as TeacherArrangement/Dashboard, so the timetable
  // finally mirrors the configured schedule exactly.
  const perList = settings.periods?.length
    ? settings.periods
    : Array.from({ length: maxPeriods }, () => ({ duration: settings.duration || 40 }))
  const brkList = breaksOf(settings)
  let current = timeToMinutes(startTime)
  const periods = []
  for (let i = 1; i <= maxPeriods; i++) {
    const dur = Number(perList[i - 1]?.duration ?? perList[perList.length - 1]?.duration ?? 40)
    const start = minutesToTime(current)
    const end = minutesToTime(current + dur)
    periods.push({ period: i, start, end, label: `${start}–${end}` })
    current += dur
    const brk = brkList.find(b => Number(b.afterPeriod) === i)
    if (brk) {
      periods.push({ isBreak: true, after: i, start: end, end: minutesToTime(current + Number(brk.duration)), duration: Number(brk.duration) })
      current += Number(brk.duration)
    }
  }
  return periods
}

export default function Timetable() {
  const { classes: classDocs, classNames: CLASSES } = useClasses()
  const { effectiveBranches, currentBranch, allowedBranches, canSwitchBranches } = useAuth()
  const [formBranch, setFormBranch] = useState(() => currentBranch || allowedBranches[0])
  useEffect(() => {
    if (currentBranch) setFormBranch(currentBranch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranch])
  const showBranchPicker = !currentBranch && canSwitchBranches && allowedBranches.length > 1
  const navigate = useNavigate()
  const [teachers, setTeachers] = useState([])
  const [slots, setSlots] = useState([])
  const [settings, setSettings] = useState({})
  const [schedule, setSchedule] = useState([])
  const [allSubjects, setAllSubjects] = useState([])
  const [classSubjectsMap, setClassSubjectsMap] = useState({})
  const [selectedDay, setSelectedDay] = useState('Monday')
  const [viewMode, setViewMode] = useState('day')
  const [showModal, setShowModal] = useState(false)
  const [editSlot, setEditSlot] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({ day:'Monday', period:'1', teacherId:'', classNames:[], subject:'' })

  async function load() {
    // Read the per-branch periods doc. If on All Branches (super admin),
    // fall back to the user's first allowed branch (timetable structure
    // needs a single set of period times). MAIN/CITY branch admins always
    // resolve to their own branch.
    const periodsBranch = currentBranch || allowedBranches[0] || 'MAIN'
    const [tSnap, ttSnap, settingsDoc, subjectsDoc, classSubjectsDoc] = await Promise.all([
      getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))),
      getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches))),
      getDoc(doc(db, 'settings', `periods_${periodsBranch}`)),
      getDoc(doc(db, 'settings', 'subjects')),
      getDoc(doc(db, 'settings', 'classSubjects')),
    ])
    if (subjectsDoc.exists() && subjectsDoc.data().list?.length) setAllSubjects(subjectsDoc.data().list)
    if (classSubjectsDoc.exists() && classSubjectsDoc.data().map) setClassSubjectsMap(classSubjectsDoc.data().map)
    setTeachers(tSnap.docs.map(d => ({ id:d.id, ...d.data() })).filter(t => t.isActive !== false).sort((a,b) => a.fullName.localeCompare(b.fullName)))
    setSlots(ttSnap.docs.map(d => ({ id:d.id, ...d.data() })))
    const s = settingsDoc.exists() ? settingsDoc.data() : {}
    setSettings(s)
    setSchedule(buildSchedule(s))
    setLoaded(true)
  }

  useEffect(() => { load() }, [effectiveBranches, currentBranch])

  const weekdayPeriods = Number(settings.weekdayPeriods || 8)
  const saturdayPeriods = Number(settings.saturdayPeriods || 5)
  const periodsForDay = (day) => day === 'Saturday' ? saturdayPeriods : weekdayPeriods

  // A single, coherent branch drives the day grid (classes + slots): the
  // active branch, else the first allowed one (super admin on "All Branches"
  // can flip it with a small toggle so Main/City classes never merge into
  // one row by shared name).
  const gridBranch = currentBranch || formBranch || allowedBranches[0]

  // Get display time for a period number
  function periodLabel(p) {
    const row = schedule.find(s => !s.isBreak && s.period === p)
    return row ? row.label : ''
  }

  function openAdd(day, period, preClass) {
    setEditSlot(null)
    setForm({ day, period: String(period), teacherId:'', classNames: preClass ? [preClass] : [], subject:'' })
    setShowModal(true)
  }

  function openEdit(slot) {
    setEditSlot(slot)
    const existingClasses = slot.classNames?.length ? slot.classNames : (slot.className ? [slot.className] : [])
    setForm({ day: slot.day, period: String(slot.period), teacherId: slot.teacherId, classNames: existingClasses, subject: slot.subject })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.teacherId || form.classNames.length === 0 || !form.subject) return
    if (!editSlot && !formBranch) return  // need branch for new slots
    setSaving(true)
    const teacher = teachers.find(t => t.id === form.teacherId)
    const pLabel = periodLabel(Number(form.period))
    // className = joined for display/compat, classNames = array for queries
    const displayName = form.classNames.join(' + ')
    const data = { day: form.day, period: Number(form.period), teacherId: form.teacherId, teacherName: teacher?.fullName || '', className: displayName, classNames: form.classNames, subject: form.subject, periodTime: pLabel, academicYear: '2025-26', updatedAt: Timestamp.now() }
    try {
      if (editSlot) await updateDoc(doc(db, 'timetable', editSlot.id), data)
      else await addDoc(collection(db, 'timetable'), { ...data, branchCode: formBranch, createdAt: Timestamp.now() })
      await load(); setShowModal(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this period?')) return
    await deleteDoc(doc(db, 'timetable', id)); await load()
  }

  // ---- Day grid model: rows = classes, columns = periods --------------------
  const gridClasses = useMemo(() => {
    const list = classDocs.filter(c => !gridBranch || c.branchCode === gridBranch)
    const seen = new Set(); const out = []
    for (const c of list) { if (c.className && !seen.has(c.className)) { seen.add(c.className); out.push(c) } }
    return out   // already grade-sorted by useClasses
  }, [classDocs, gridBranch])

  const dayColumns = useMemo(
    () => schedule.filter(row => !row.isBreak ? row.period <= periodsForDay(selectedDay) : row.after < periodsForDay(selectedDay)),
    [schedule, selectedDay, weekdayPeriods, saturdayPeriods]
  )

  // key `${className}|${period}` → slots[] (combined-class slots land in every row)
  const cellMap = useMemo(() => {
    const m = new Map()
    for (const s of slots) {
      if (gridBranch && s.branchCode !== gridBranch) continue
      if (s.day !== selectedDay) continue
      const cls = s.classNames?.length ? s.classNames : (s.className ? [s.className] : [])
      for (const c of cls) {
        const k = `${c}|${s.period}`
        if (!m.has(k)) m.set(k, [])
        m.get(k).push(s)
      }
    }
    return m
  }, [slots, gridBranch, selectedDay])

  const daySummary = useMemo(() => {
    const maxP = periodsForDay(selectedDay)
    const dayS = slots.filter(s => s.day === selectedDay && (!gridBranch || s.branchCode === gridBranch))
    const filledCells = new Set()
    for (const s of dayS) {
      const cls = s.classNames?.length ? s.classNames : (s.className ? [s.className] : [])
      for (const c of cls) if (s.period <= maxP) filledCells.add(`${c}|${s.period}`)
    }
    return { assignments: dayS.length, filled: filledCells.size, total: gridClasses.length * maxP }
  }, [slots, gridBranch, selectedDay, gridClasses, weekdayPeriods, saturdayPeriods])

  return (
    <div style={{ padding:'24px 28px', maxWidth:1320 }}>
      <div className="fade-in" style={{ marginBottom:20, display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Timetable</h1>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>
            Mon–Fri: {weekdayPeriods} periods · Saturday: {saturdayPeriods} periods
            {breaksOf(settings).map(b => ` · Break after P${b.afterPeriod} (${b.duration} min)`).join('')}
          </p>
          <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button onClick={() => navigate('/period-settings')} style={{ fontSize:12, color:'var(--green)', fontWeight:500, padding:'7px 14px', border:'1px solid var(--green-muted)', borderRadius:20, background:'var(--green-light)', cursor:'pointer' }}>⚙ Period Settings</button>
          <div style={{ display:'flex', background:'var(--gray-50)', borderRadius:'var(--radius-md)', padding:3, border:'1px solid var(--gray-100)' }}>
            {[['day','By Day'],['teacher','By Teacher']].map(([k,l]) => (
              <button key={k} onClick={() => setViewMode(k)} style={{ padding:'7px 16px', borderRadius:'var(--radius-sm)', border:'none', fontSize:12, fontWeight:500, cursor:'pointer', background: viewMode===k ? 'var(--white)' : 'transparent', color: viewMode===k ? 'var(--green)' : 'var(--text-muted)', boxShadow: viewMode===k ? 'var(--shadow-sm)' : 'none', transition:'all 0.15s' }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Day tabs + (super-admin) grid-branch chooser */}
      {viewMode === 'day' && (
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:18, alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {DAYS.map(d => (
              <button key={d} onClick={() => setSelectedDay(d)} style={{ padding:'7px 14px', borderRadius:20, border:'1px solid', borderColor: selectedDay===d ? 'var(--green)' : 'var(--gray-200)', background: selectedDay===d ? 'var(--green)' : 'var(--white)', color: selectedDay===d ? 'white' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
                {d.slice(0,3)} <span style={{ opacity:0.7, fontSize:10 }}>({periodsForDay(d)}p)</span>
              </button>
            ))}
          </div>
          {showBranchPicker && (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:500 }}>Showing</span>
              <div style={{ display:'flex', background:'var(--gray-50)', borderRadius:'var(--radius-sm)', padding:3, border:'1px solid var(--gray-100)' }}>
                {allowedBranches.map(b => (
                  <button key={b} onClick={() => setFormBranch(b)} style={{ padding:'5px 12px', borderRadius:6, border:'none', fontSize:12, fontWeight:500, cursor:'pointer', background: gridBranch===b ? 'var(--white)' : 'transparent', color: gridBranch===b ? 'var(--green)' : 'var(--text-muted)', boxShadow: gridBranch===b ? 'var(--shadow-sm)' : 'none' }}>{branchLabel(b)}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* DAY VIEW — Class × Period grid */}
      {viewMode === 'day' && (
        <div style={CARD}>
          <div style={CARD_HEAD}>
            <div>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--green-dark)' }}>{selectedDay}</h2>
              <div style={{ fontSize:12, color:'var(--green-mid)', marginTop:2 }}>
                {daySummary.total === 0
                  ? 'No classes to schedule'
                  : `${daySummary.filled} of ${daySummary.total} cells filled · ${daySummary.assignments} assignment${daySummary.assignments===1?'':'s'}`}
              </div>
            </div>
            <span style={{ fontSize:11.5, color:'var(--text-muted)' }}>Tap a cell to assign · colour = subject</span>
          </div>

          {gridClasses.length === 0 ? (
            <div style={{ padding:48, textAlign:'center', color:'var(--text-muted)', fontSize:14 }}>
              {loaded ? 'No classes found for this branch.' : 'Loading…'}
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ borderCollapse:'separate', borderSpacing:0, fontSize:12.5, minWidth:'100%' }}>
                <thead>
                  <tr>
                    <th style={{ position:'sticky', left:0, zIndex:3, background:'var(--gray-50)', textAlign:'left', padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--gray-100)', minWidth:118, boxShadow:'2px 0 0 var(--gray-100)' }}>Class</th>
                    {dayColumns.map((col, i) => col.isBreak ? (
                      <th key={`b-${col.after}`} title={`Interval · ${col.duration} min · ${col.start}–${col.end}`} style={{ background:'var(--gold-light)', borderBottom:'1px solid var(--gray-100)', borderLeft:'1px solid var(--gray-100)', minWidth:38, width:38, color:'var(--gold-dark)', fontSize:10, fontWeight:600 }}>
                        <div style={{ writingMode:'vertical-rl', transform:'rotate(180deg)', margin:'0 auto', padding:'8px 0', whiteSpace:'nowrap' }}>☕ {col.duration}m</div>
                      </th>
                    ) : (
                      <th key={col.period} style={{ background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', borderLeft:'1px solid var(--gray-50)', padding:'8px 10px', textAlign:'center', minWidth:120, whiteSpace:'nowrap' }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'var(--green-dark)' }}>P{col.period}</div>
                        <div style={{ fontSize:10, fontWeight:400, color:'var(--text-muted)', marginTop:1 }}>{col.label}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridClasses.map((c, ri) => {
                    const band = c.gradeBand || inferGradeBand(c.className)
                    const prevBand = ri > 0 ? (gridClasses[ri-1].gradeBand || inferGradeBand(gridClasses[ri-1].className)) : band
                    const bandBreak = ri > 0 && band !== prevBand
                    return (
                      <tr key={c.className}>
                        <th style={{ position:'sticky', left:0, zIndex:2, background:'var(--white)', textAlign:'left', padding:'8px 14px', fontWeight:600, color:'var(--text)', whiteSpace:'nowrap', borderBottom:'1px solid var(--gray-50)', borderTop: bandBreak ? '2px solid var(--green-muted)' : 'none', boxShadow:'2px 0 0 var(--gray-100)' }}>
                          {c.className}
                        </th>
                        {dayColumns.map(col => {
                          if (col.isBreak) return <td key={`b-${col.after}`} style={{ background:'var(--gold-light)', borderLeft:'1px solid var(--gray-100)', borderBottom:'1px solid var(--gray-50)', borderTop: bandBreak ? '2px solid var(--green-muted)' : 'none' }} />
                          const cellSlots = cellMap.get(`${c.className}|${col.period}`) || []
                          const cellBorder = { borderLeft:'1px solid var(--gray-50)', borderBottom:'1px solid var(--gray-50)', borderTop: bandBreak ? '2px solid var(--green-muted)' : 'none', verticalAlign:'top', padding:3 }
                          if (cellSlots.length === 0) return (
                            <td key={col.period} style={cellBorder}>
                              <button onClick={() => openAdd(selectedDay, col.period, c.className)}
                                title={`Assign ${c.className} · P${col.period}`}
                                style={{ width:'100%', minHeight:48, border:'none', background:'transparent', borderRadius:8, cursor:'pointer', color:'var(--gray-200)', fontSize:16, transition:'all 0.12s' }}
                                onMouseEnter={e=>{ e.currentTarget.style.background='var(--green-light)'; e.currentTarget.style.color='var(--green)' }}
                                onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--gray-200)' }}>+</button>
                            </td>
                          )
                          return (
                            <td key={col.period} style={cellBorder}>
                              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                                {cellSlots.map(slot => {
                                  const hue = subjHue(slot.subject)
                                  const combined = (slot.classNames?.length || 0) > 1
                                  return (
                                    <button key={slot.id} onClick={() => openEdit(slot)}
                                      title={`${slot.subject} · ${slot.teacherName}${combined ? ' · combined: ' + slot.classNames.join(', ') : ''} — click to edit`}
                                      style={{ textAlign:'left', width:'100%', minHeight:48, border:`1px solid ${tintBg(hue)}`, background:tintBg(hue), borderRadius:8, padding:'6px 8px', cursor:'pointer', display:'flex', flexDirection:'column', gap:2, transition:'all 0.12s' }}
                                      onMouseEnter={e=>{ e.currentTarget.style.boxShadow='var(--shadow-sm)'; e.currentTarget.style.transform='translateY(-1px)' }}
                                      onMouseLeave={e=>{ e.currentTarget.style.boxShadow='none'; e.currentTarget.style.transform='none' }}>
                                      <div style={{ display:'flex', alignItems:'center', gap:5, minWidth:0 }}>
                                        <span style={{ width:7, height:7, borderRadius:'50%', background:tintDot(hue), flexShrink:0 }} />
                                        <span style={{ fontWeight:600, color:'var(--text)', fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{slot.subject}</span>
                                      </div>
                                      <div style={{ fontSize:11, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                        {slot.teacherName}
                                        {combined && <span style={{ marginLeft:4, fontSize:9.5, padding:'0 5px', borderRadius:6, background:'var(--gold-light)', color:'var(--gold-dark)', fontWeight:600 }}>+{slot.classNames.length - 1}</span>}
                                      </div>
                                    </button>
                                  )
                                })}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TEACHER VIEW */}
      {viewMode === 'teacher' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {teachers.length === 0 ? (
            <div style={{ textAlign:'center', padding:48, ...CARD, color:'var(--text-muted)', fontSize:14 }}>No teachers found.</div>
          ) : teachers.map(t => {
            const tSlots = slots.filter(s => s.teacherId === t.id)
            const maxP = weekdayPeriods
            return (
              <div key={t.id} style={CARD}>
                <div style={{ padding:'12px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:34, height:34, borderRadius:'50%', background:'var(--green)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'white' }}>{initials(t.fullName)}</span>
                  </div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{t.fullName}</div>
                    <div style={{ fontSize:11, color:'var(--green-mid)' }}>{tSlots.length} periods/week</div>
                  </div>
                </div>
                {tSlots.length === 0 ? (
                  <div style={{ padding:'14px 18px', fontSize:13, color:'var(--gray-400)', fontStyle:'italic' }}>No periods assigned yet.</div>
                ) : (
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ borderCollapse:'separate', borderSpacing:0, fontSize:12, minWidth:600 }}>
                      <thead>
                        <tr style={{ background:'var(--gray-50)' }}>
                          <th style={{ padding:'8px 14px', textAlign:'left', color:'var(--text-muted)', fontWeight:600, fontSize:11, textTransform:'uppercase', whiteSpace:'nowrap', borderBottom:'1px solid var(--gray-100)' }}>Day</th>
                          {schedule.filter(r => !r.isBreak && r.period <= maxP).map(r => (
                            <th key={r.period} style={{ padding:'8px 6px', textAlign:'center', color:'var(--text-muted)', fontWeight:600, fontSize:10, borderBottom:'1px solid var(--gray-100)', borderLeft:'1px solid var(--gray-50)' }}>
                              <div>P{r.period}</div>
                              <div style={{ fontWeight:400, fontSize:9, opacity:0.7 }}>{r.start}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {DAYS.map(day => (
                          <tr key={day}>
                            <td style={{ padding:'8px 14px', fontWeight:500, color:'var(--text)', whiteSpace:'nowrap', borderBottom:'1px solid var(--gray-50)' }}>{day}</td>
                            {schedule.filter(r => !r.isBreak && r.period <= maxP).map(r => {
                              if (r.period > periodsForDay(day)) return <td key={r.period} style={{ background:'var(--gray-50)', borderLeft:'1px solid var(--gray-100)', borderBottom:'1px solid var(--gray-50)' }} />
                              const slot = tSlots.find(s => s.day === day && s.period === r.period)
                              const hue = slot ? subjHue(slot.subject) : null
                              return (
                                <td key={r.period} style={{ padding:'4px 5px', textAlign:'center', borderLeft:'1px solid var(--gray-50)', borderBottom:'1px solid var(--gray-50)' }}>
                                  {slot ? (
                                    <div onClick={() => openEdit(slot)} style={{ background: tintBg(hue), borderRadius:6, padding:'4px 6px', fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
                                      <div style={{ fontWeight:600, color:'var(--text)' }}>{slot.subject}</div>
                                      <div style={{ color:'var(--text-muted)', fontSize:10 }}>{(slot.classNames?.length ? slot.classNames.join('+') : slot.className || '').replace(/Class /g,'')}</div>
                                    </div>
                                  ) : <span style={{ color:'var(--gray-200)' }}>—</span>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
          <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:440, boxShadow:'var(--shadow-lg)' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:600, color:'var(--green-dark)' }}>{editSlot ? 'Edit Period' : `Assign — ${form.day} Period ${form.period}`}</h2>
              <button onClick={() => setShowModal(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22, lineHeight:1 }}>×</button>
            </div>
            <div style={{ padding:'20px' }}>
              {showBranchPicker && !editSlot && (
                <div style={{ padding:'10px 12px', background:'var(--green-light)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-sm)', marginBottom:12 }}>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--green-mid)', display:'block', marginBottom:6 }}>Branch <span style={{ color:'var(--crimson)' }}>*</span></label>
                  <div style={{ display:'flex', gap:14 }}>
                    {allowedBranches.map(b => (
                      <label key={b} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13 }}>
                        <input type="radio" name="ttBranch" checked={formBranch === b} onChange={() => { setFormBranch(b); setForm(p => ({ ...p, teacherId: '', classNames: [] })) }} />
                        <span>{branchLabel(b)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Day</label>
                  <select value={form.day} onChange={e => setForm(p=>({...p,day:e.target.value,period:'1'}))} style={inp}>
                    {DAYS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Period</label>
                  <select value={form.period} onChange={e => setForm(p=>({...p,period:e.target.value}))} style={inp}>
                    {schedule.filter(r => !r.isBreak && r.period <= periodsForDay(form.day)).map(r => (
                      <option key={r.period} value={r.period}>P{r.period} · {r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Teacher <span style={{ color:'var(--crimson)' }}>*</span></label>
                <select value={form.teacherId} onChange={e => setForm(p=>({...p,teacherId:e.target.value}))} style={inp}>
                  <option value="">Select teacher…</option>
                  {(formBranch ? teachers.filter(t => (t.branchCodes || []).includes(formBranch)) : teachers).map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                </select>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:6 }}>
                    Class <span style={{ color:'var(--crimson)' }}>*</span>
                    <span style={{ fontSize:11, fontWeight:400, color:'var(--text-muted)', marginLeft:6 }}>Select up to 3 for combined classes</span>
                  </label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {(formBranch ? [...new Set(classDocs.filter(c => c.branchCode === formBranch).map(c => c.className))] : CLASSES).map(c => {
                      const selected = form.classNames.includes(c)
                      const atLimit = form.classNames.length >= 3 && !selected
                      return (
                        <button key={c} type="button"
                          disabled={atLimit}
                          onClick={() => setForm(p => ({
                            ...p,
                            classNames: selected ? p.classNames.filter(x => x !== c) : [...p.classNames, c],
                            subject: ''
                          }))}
                          style={{ padding:'5px 11px', borderRadius:16, border:'1px solid', borderColor: selected ? 'var(--green)' : 'var(--gray-200)', background: selected ? 'var(--green)' : 'var(--white)', color: selected ? 'white' : atLimit ? 'var(--gray-300)' : 'var(--text-muted)', fontSize:12, fontWeight: selected ? 600 : 400, cursor: atLimit ? 'not-allowed' : 'pointer', transition:'all 0.12s', opacity: atLimit ? 0.5 : 1 }}>
                          {c.replace('Class ','')}
                        </button>
                      )
                    })}
                  </div>
                  {form.classNames.length > 0 && (
                    <div style={{ marginTop:8, fontSize:12, color:'var(--green)', fontWeight:500 }}>
                      Selected: {form.classNames.join(' + ')}
                      {form.classNames.length >= 2 && <span style={{ marginLeft:8, fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)' }}>Combined class ({form.classNames.length})</span>}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Subject <span style={{ color:'var(--crimson)' }}>*</span></label>
                  <select value={form.subject} onChange={e => setForm(p=>({...p,subject:e.target.value}))} style={inp}>
                    <option value="">Select subject…</option>
                    {(() => {
                      const teacher = teachers.find(t => t.id === form.teacherId)
                      // Get subjects allowed for selected classes (intersection if multiple)
                      let classSubs = []
                      if (form.classNames.length > 0) {
                        const perClass = form.classNames.map(cls => classSubjectsMap[cls] || allSubjects)
                        // Union of all selected classes' subjects
                        classSubs = [...new Set(perClass.flat())].sort()
                      } else {
                        classSubs = allSubjects
                      }
                      // Filter to teacher's subjects if assigned
                      const teacherSubs = teacher?.subjectsTaught?.length ? teacher.subjectsTaught : null
                      const final = teacherSubs ? classSubs.filter(s => teacherSubs.includes(s)) : classSubs
                      return (final.length > 0 ? final : classSubs).map(s => <option key={s}>{s}</option>)
                    })()}
                  </select>
                </div>
              </div>

              {/* Period time preview */}
              {form.period && (
                <div style={{ background:'var(--green-light)', borderRadius:'var(--radius-sm)', padding:'8px 12px', marginBottom:16, fontSize:12, color:'var(--green-dark)' }}>
                  ⏰ This period runs {periodLabel(Number(form.period))}
                  {(() => {
                    const brk = breaksOf(settings).find(b => Number(b.afterPeriod) === Number(form.period))
                    return brk && (
                      <span style={{ marginLeft:8, color:'var(--gold-dark)' }}>· Followed by {brk.duration}-min interval</span>
                    )
                  })()}
                </div>
              )}

              <div style={{ display:'flex', gap:10 }}>
                <button onClick={handleSave} disabled={saving||!form.teacherId||form.classNames.length===0||!form.subject} style={{ flex:1, padding:'11px', background:(!form.teacherId||form.classNames.length===0||!form.subject)?'var(--gray-200)':'var(--green)', color:(!form.teacherId||form.classNames.length===0||!form.subject)?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:(!form.teacherId||form.classNames.length===0||!form.subject)?'not-allowed':'pointer' }}>
                  {saving ? 'Saving…' : editSlot ? 'Update' : 'Assign Period'}
                </button>
                {editSlot && (
                  <button onClick={() => { handleDelete(editSlot.id); setShowModal(false) }} style={{ padding:'11px 16px', background:'var(--crimson-light)', color:'var(--crimson)', border:'1px solid var(--crimson)', borderRadius:'var(--radius-md)', fontSize:14, cursor:'pointer', fontWeight:500 }}>Remove</button>
                )}
                <button onClick={() => setShowModal(false)} style={{ padding:'11px 16px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:14, cursor:'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
