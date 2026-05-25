import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, query, Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
// CLASSES loaded via useClasses()
// Subjects loaded from settings/classSubjects
const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

function timeToMinutes(t) { const [h,m] = t.split(':').map(Number); return h*60+m }
function minutesToTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` }

function buildSchedule(settings) {
  const { startTime='09:20', duration=40, breakAfter=4, breakDuration=20, weekdayPeriods=8, saturdayPeriods=5 } = settings
  const maxPeriods = Math.max(Number(weekdayPeriods), Number(saturdayPeriods))
  let current = timeToMinutes(startTime)
  const periods = []
  for (let i = 1; i <= maxPeriods; i++) {
    const start = minutesToTime(current)
    const end = minutesToTime(current + Number(duration))
    periods.push({ period: i, start, end, label: `${start}–${end}` })
    current += Number(duration)
    if (i === Number(breakAfter)) {
      periods.push({ isBreak: true, after: i, start: end, end: minutesToTime(current + Number(breakDuration)), duration: Number(breakDuration) })
      current += Number(breakDuration)
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
  }

  useEffect(() => { load() }, [effectiveBranches, currentBranch])

  const weekdayPeriods = Number(settings.weekdayPeriods || 8)
  const saturdayPeriods = Number(settings.saturdayPeriods || 5)
  const periodsForDay = (day) => day === 'Saturday' ? saturdayPeriods : weekdayPeriods

  // Get display time for a period number
  function periodLabel(p) {
    const row = schedule.find(s => !s.isBreak && s.period === p)
    return row ? row.label : ''
  }

  function openAdd(day, period) {
    setEditSlot(null)
    setForm({ day, period: String(period), teacherId:'', classNames:[], subject:'' })
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

  const clrs = ['#e8f2ec','#fdf6e3','#fdf0f0','#e6f1fb','#f0e8f5','#e8f5f0']
  const clrMap = {}; let ci = 0
  slots.forEach(s => { if (!clrMap[s.subject]) clrMap[s.subject] = clrs[ci++ % clrs.length] })

  return (
    <div style={{ padding:'24px 28px', maxWidth:1300 }}>
      <div className="fade-in" style={{ marginBottom:20, display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Timetable</h1>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>
            Mon–Fri: {weekdayPeriods} periods · Saturday: {saturdayPeriods} periods
            {settings.breakAfter && ` · Break after P${settings.breakAfter} (${settings.breakDuration} min)`}
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

      {/* Day tabs */}
      {viewMode === 'day' && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:18 }}>
          {DAYS.map(d => (
            <button key={d} onClick={() => setSelectedDay(d)} style={{ padding:'7px 14px', borderRadius:20, border:'1px solid', borderColor: selectedDay===d ? 'var(--green)' : 'var(--gray-200)', background: selectedDay===d ? 'var(--green)' : 'var(--white)', color: selectedDay===d ? 'white' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
              {d.slice(0,3)} <span style={{ opacity:0.7, fontSize:10 }}>({periodsForDay(d)}p)</span>
            </button>
          ))}
        </div>
      )}

      {/* DAY VIEW */}
      {viewMode === 'day' && (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          <div style={{ padding:'13px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--green-dark)' }}>{selectedDay}</h2>
            <span style={{ fontSize:12, color:'var(--green-mid)' }}>{(() => {
                const daySlots = slots.filter(s=>s.day===selectedDay)
                const filledPeriods = new Set(daySlots.map(s=>s.period)).size
                const totalSlots = daySlots.length
                const maxP = periodsForDay(selectedDay)
                if (totalSlots === 0) return `0 of ${maxP} periods assigned`
                if (totalSlots === filledPeriods) return `${filledPeriods} of ${maxP} periods assigned`
                return `${filledPeriods} of ${maxP} periods assigned · ${totalSlots} total class slots`
              })()}</span>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  {['Period','Time','Teacher','Class','Subject',''].map(h => (
                    <th key={h} style={{ padding:'9px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule
                  .filter(row => !row.isBreak ? row.period <= periodsForDay(selectedDay) : row.after < periodsForDay(selectedDay))
                  .map((row, idx) => {
                  if (row.isBreak) return (
                    <tr key={`break-${row.after}`} style={{ background:'#fffbea', borderTop:'1px solid rgba(201,162,39,0.2)' }}>
                      <td colSpan={6} style={{ padding:'8px 16px', fontSize:12, color:'var(--gold-dark)', fontWeight:500 }}>
                        ☕ Interval — {row.duration} min &nbsp;·&nbsp; {row.start}–{row.end}
                      </td>
                    </tr>
                  )
                  const period = row.period
                  const periodSlots = slots.filter(s => s.day === selectedDay && s.period === period)
                  if (periodSlots.length === 0) return (
                    <tr key={period} onClick={() => openAdd(selectedDay, period)} style={{ borderTop:'1px solid var(--gray-50)', cursor:'pointer' }}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--green-light)'}
                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{ padding:'12px 16px', fontWeight:700, color:'var(--text-muted)' }}>P{period}</td>
                      <td style={{ padding:'12px 16px', color:'var(--text-muted)', fontSize:12 }}>{row.label}</td>
                      <td colSpan={3} style={{ padding:'12px 16px', color:'var(--gray-400)', fontStyle:'italic', fontSize:12 }}>Click to assign</td>
                      <td style={{ padding:'12px 16px' }}><span style={{ fontSize:12, color:'var(--green)', fontWeight:500 }}>+ Add</span></td>
                    </tr>
                  )
                  return [
                    ...periodSlots.map((slot, si) => (
                      <tr key={slot.id} style={{ borderTop:'1px solid var(--gray-50)', background: si%2===0 ? 'var(--white)' : 'var(--gray-50)' }}>
                        {si===0 && <td rowSpan={periodSlots.length + 1} style={{ padding:'12px 16px', fontWeight:700, color:'var(--green-dark)', verticalAlign:'top' }}>P{period}</td>}
                        {si===0 && <td rowSpan={periodSlots.length + 1} style={{ padding:'12px 16px', color:'var(--text-muted)', fontSize:12, verticalAlign:'top', whiteSpace:'nowrap' }}>{row.label}</td>}
                        <td style={{ padding:'11px 16px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                              <span style={{ fontSize:11, fontWeight:700, color:'var(--green)' }}>{slot.teacherName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                            </div>
                            <span style={{ fontWeight:500 }}>{slot.teacherName}</span>
                          </div>
                        </td>
                        <td style={{ padding:'11px 16px' }}><span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{slot.className}</span></td>
                        <td style={{ padding:'11px 16px' }}>{slot.subject}</td>
                        <td style={{ padding:'11px 16px' }}>
                          <div style={{ display:'flex', gap:10 }}>
                            <button onClick={() => openEdit(slot)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Edit</button>
                            <button onClick={() => handleDelete(slot.id)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer' }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    )),
                    // Always show + Add another row at the bottom of each period
                    <tr key={`add-${period}`} style={{ borderTop:'1px solid var(--gray-50)', background:'var(--gray-50)' }}>
                      <td colSpan={3} style={{ padding:'8px 16px', color:'var(--text-muted)', fontSize:12, fontStyle:'italic' }}>
                        {periodSlots.length} class{periodSlots.length > 1 ? 'es' : ''} assigned this period
                      </td>
                      <td colSpan={2} style={{ padding:'8px 16px' }}>
                        <button onClick={() => openAdd(selectedDay, period)} style={{ fontSize:12, color:'var(--green)', background:'var(--green-light)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-sm)', padding:'4px 12px', cursor:'pointer', fontWeight:500 }}>
                          + Add another class
                        </button>
                      </td>
                    </tr>
                  ]
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TEACHER VIEW */}
      {viewMode === 'teacher' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {teachers.length === 0 ? (
            <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:14 }}>No teachers found.</div>
          ) : teachers.map(t => {
            const tSlots = slots.filter(s => s.teacherId === t.id)
            const maxP = weekdayPeriods
            return (
              <div key={t.id} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                <div style={{ padding:'12px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:34, height:34, borderRadius:'50%', background:'var(--green)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'white' }}>{t.fullName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
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
                    <table style={{ borderCollapse:'collapse', fontSize:12, minWidth:600 }}>
                      <thead>
                        <tr style={{ background:'var(--gray-50)' }}>
                          <th style={{ padding:'8px 14px', textAlign:'left', color:'var(--text-muted)', fontWeight:600, fontSize:11, textTransform:'uppercase', whiteSpace:'nowrap' }}>Day</th>
                          {schedule.filter(r => !r.isBreak && r.period <= maxP).map(r => (
                            <th key={r.period} style={{ padding:'8px 6px', textAlign:'center', color:'var(--text-muted)', fontWeight:600, fontSize:10 }}>
                              <div>P{r.period}</div>
                              <div style={{ fontWeight:400, fontSize:9, opacity:0.7 }}>{r.start}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {DAYS.map(day => (
                          <tr key={day} style={{ borderTop:'1px solid var(--gray-50)' }}>
                            <td style={{ padding:'8px 14px', fontWeight:500, color:'var(--text)', whiteSpace:'nowrap' }}>{day}</td>
                            {schedule.filter(r => !r.isBreak && r.period <= maxP).map(r => {
                              if (r.period > periodsForDay(day)) return <td key={r.period} style={{ background:'var(--gray-50)', borderLeft:'1px solid var(--gray-100)' }} />
                              const slot = tSlots.find(s => s.day === day && s.period === r.period)
                              return (
                                <td key={r.period} style={{ padding:'4px 5px', textAlign:'center', borderLeft:'1px solid var(--gray-50)' }}>
                                  {slot ? (
                                    <div onClick={() => openEdit(slot)} style={{ background: clrMap[slot.subject] || 'var(--green-light)', borderRadius:6, padding:'4px 6px', fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
                                      <div style={{ fontWeight:600, color:'var(--green-dark)' }}>{slot.subject}</div>
                                      <div style={{ color:'var(--text-muted)', fontSize:10 }}>{slot.className?.replace('Class ','')}</div>
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
                  {Number(form.period) === Number(settings.breakAfter) && (
                    <span style={{ marginLeft:8, color:'var(--gold-dark)' }}>· Followed by {settings.breakDuration}-min interval</span>
                  )}
                </div>
              )}

              <div style={{ display:'flex', gap:10 }}>
                <button onClick={handleSave} disabled={saving||!form.teacherId||form.classNames.length===0||!form.subject} style={{ flex:1, padding:'11px', background:(!form.teacherId||form.classNames.length===0||!form.subject)?'var(--gray-200)':'var(--green)', color:(!form.teacherId||form.classNames.length===0||!form.subject)?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:(!form.teacherId||form.classNames.length===0||!form.subject)?'not-allowed':'pointer' }}>
                  {saving ? 'Saving…' : editSlot ? 'Update' : 'Assign Period'}
                </button>
                <button onClick={() => setShowModal(false)} style={{ padding:'11px 16px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:14, cursor:'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
