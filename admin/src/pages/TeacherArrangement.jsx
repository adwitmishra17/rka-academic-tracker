import React, { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, deleteDoc, doc, query, where, Timestamp, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { format, parseISO } from 'date-fns'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default function TeacherArrangement() {
  const { effectiveBranches, currentBranch, allowedBranches } = useAuth()
  const [date, setDate] = useState(todayStr())
  const [teachers, setTeachers] = useState([])
  const [timetable, setTimetable] = useState([])
  const [schedule, setSchedule] = useState([])
  const [arrangements, setArrangements] = useState([]) // for selected date
  const [allArrangements, setAllArrangements] = useState([]) // for history view
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState(1) // 1=select absent teacher+period, 2=select arrangement teacher
  const [modalPeriod, setModalPeriod] = useState(null)
  const [modalClass, setModalClass] = useState('')
  const [modalAbsentTeacher, setModalAbsentTeacher] = useState(null)
  const [modalArrangementTeacher, setModalArrangementTeacher] = useState(null)
  const [modalNotes, setModalNotes] = useState('')

  // View: 'day' or 'history'
  const [view, setView] = useState('day')
  const [historyTeacher, setHistoryTeacher] = useState('')

  const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // Per-branch periods doc. On All Branches (super admin), pick the
        // first allowed branch — schedule rendering needs a single template.
        const periodsBranch = currentBranch || allowedBranches[0] || 'MAIN'
        const [tSnap, ttSnap, periodsDoc] = await Promise.all([
          getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))),
          getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches))),
          getDoc(doc(db, 'settings', `periods_${periodsBranch}`)),
        ])
        setTeachers(tSnap.docs.map(d => ({ id:d.id, ...d.data() })).filter(t => t.isActive !== false).sort((a,b) => a.fullName.localeCompare(b.fullName)))
        setTimetable(ttSnap.docs.map(d => ({ id:d.id, ...d.data() })))

        // Build schedule
        if (periodsDoc.exists()) {
          const ps = periodsDoc.data()
          let cur = ps.startTime ? (parseInt(ps.startTime.split(':')[0])*60+parseInt(ps.startTime.split(':')[1])) : 560
          const perList = ps.periods?.length ? ps.periods : Array.from({length:Math.max(ps.weekdayPeriods||8,ps.saturdayPeriods||5)},()=>({duration:ps.duration||40}))
          const brkList = ps.breaks || (ps.breakAfter?[{afterPeriod:ps.breakAfter,duration:ps.breakDuration||20}]:[])
          const sch = []
          perList.forEach((p,i) => {
            const pNum=i+1, h=Math.floor(cur/60), m=cur%60, eh=Math.floor((cur+p.duration)/60), em=(cur+p.duration)%60
            sch.push({ period:pNum, label:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}–${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}` })
            cur += p.duration
            const brk = brkList.find(b => b.afterPeriod===pNum)
            if (brk) cur += brk.duration
          })
          setSchedule(sch)
        } else {
          setSchedule(Array.from({length:8},(_,i) => ({period:i+1, label:`P${i+1}`})))
        }
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [effectiveBranches, currentBranch])

  useEffect(() => { loadArrangements() }, [date, effectiveBranches])
  useEffect(() => { if (view === 'history') loadAllArrangements() }, [view, effectiveBranches])

  async function loadArrangements() {
    try {
      const snap = await getDocs(query(
        collection(db, 'arrangements'),
        where('date', '==', date),
        ...branchConstraints('branchCode', effectiveBranches)
      ))
      setArrangements(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    } catch(e) { console.error(e) }
  }

  async function loadAllArrangements() {
    try {
      const snap = await getDocs(query(collection(db, 'arrangements'), ...branchConstraints('branchCode', effectiveBranches)))
      setAllArrangements(snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => (b.date||'').localeCompare(a.date||'')))
    } catch(e) { console.error(e) }
  }

  function getDayName(dateStr) {
    try { return format(parseISO(dateStr), 'EEEE') } catch { return '' }
  }

  // Get timetable slots for a given day+period
  function slotsForPeriod(day, period) {
    return timetable.filter(s => s.day === day && s.period === period)
  }

  // Teachers who are FREE in a given day+period (not in timetable for that slot)
  function freeTeachers(day, period) {
    const busy = new Set(slotsForPeriod(day, period).map(s => s.teacherId))
    return teachers.filter(t => !busy.has(t.id))
  }

  // Classes scheduled in a given day+period
  function classesForPeriod(day, period) {
    return slotsForPeriod(day, period)
  }

  function openModal(period, slotInfo) {
    setModalPeriod(period)
    setModalClass(slotInfo?.className || '')
    setModalAbsentTeacher(slotInfo ? { id: slotInfo.teacherId, fullName: slotInfo.teacherName } : null)
    setModalArrangementTeacher(null)
    setModalNotes('')
    setStep(slotInfo ? 2 : 1)
    setShowModal(true)
  }

  async function handleSave() {
    if (!modalAbsentTeacher || !modalArrangementTeacher || !modalPeriod) return
    setSaving(true)
    const day = getDayName(date)
    const periodInfo = schedule.find(s => s.period === modalPeriod)
    // Derive branchCode for the arrangement record. The arrangement is for a
    // specific teacher's slot at a specific date/period — which by definition
    // is in one branch. Prefer the current branch view; otherwise use the
    // first branchCode listed on the absent teacher (single-branch teachers
    // unambiguous; cross-branch fallback to MAIN).
    const branchForArrangement =
      currentBranch ||
      (modalAbsentTeacher.branchCodes && modalAbsentTeacher.branchCodes[0]) ||
      'MAIN'
    try {
      await addDoc(collection(db, 'arrangements'), {
        date, day,
        period: modalPeriod,
        periodTime: periodInfo?.label || '',
        className: modalClass,
        absentTeacherId: modalAbsentTeacher.id,
        absentTeacherName: modalAbsentTeacher.fullName,
        arrangementTeacherId: modalArrangementTeacher.id,
        arrangementTeacherName: modalArrangementTeacher.fullName,
        notes: modalNotes.trim(),
        branchCode: branchForArrangement,
        createdAt: Timestamp.now(),
        createdBy: 'admin',
      })
      await loadArrangements()
      setShowModal(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this arrangement?')) return
    await deleteDoc(doc(db, 'arrangements', id))
    setArrangements(prev => prev.filter(a => a.id !== id))
    setAllArrangements(prev => prev.filter(a => a.id !== id))
  }

  const day = getDayName(date)
  const dayArrangements = arrangements
  const filteredHistory = historyTeacher
    ? allArrangements.filter(a => a.arrangementTeacherId === historyTeacher || a.absentTeacherId === historyTeacher)
    : allArrangements

  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const weekdayPeriods = 8
  const saturdayPeriods = 5
  const periodsForDay = (d) => d === 'Saturday' ? saturdayPeriods : weekdayPeriods
  const dayPeriods = schedule.filter(s => s.period <= periodsForDay(day))

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Teacher Arrangement</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Manage substitute teachers when a teacher is absent. Free teachers are shown based on the timetable.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {/* View toggle + date */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        <div style={{ display:'flex', background:'var(--gray-50)', borderRadius:'var(--radius-md)', padding:3, border:'1px solid var(--gray-100)' }}>
          {[['day','Day View'],['history','History']].map(([k,l]) => (
            <button key={k} onClick={() => setView(k)} style={{ padding:'7px 18px', borderRadius:'var(--radius-sm)', border:'none', fontSize:12, fontWeight:500, cursor:'pointer', background:view===k?'var(--white)':'transparent', color:view===k?'var(--green)':'var(--text-muted)', boxShadow:view===k?'var(--shadow-sm)':'none', transition:'all 0.15s' }}>{l}</button>
          ))}
        </div>
        {view === 'day' && (
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', cursor:'pointer' }}
          />
        )}
        {view === 'day' && date && (
          <span style={{ fontSize:13, color:'var(--text-muted)', fontWeight:500 }}>
            {format(parseISO(date), 'EEEE, d MMMM yyyy')}
          </span>
        )}
        {view === 'day' && (
          <button onClick={() => openModal(null, null)} style={{ marginLeft:'auto', padding:'9px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Arrangement
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : view === 'day' ? (
        <>
          {/* Period-wise grid */}
          <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:24 }}>
            {dayPeriods.map(s => {
              const periodSlots = classesForPeriod(day, s.period)
              const periodArrangements = dayArrangements.filter(a => a.period === s.period)
              return (
                <div key={s.period} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                  {/* Period header */}
                  <div style={{ padding:'10px 16px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', gap:12 }}>
                    <span style={{ fontSize:14, fontWeight:700, color:'var(--green-dark)', minWidth:28 }}>P{s.period}</span>
                    <span style={{ fontSize:12, color:'var(--green-mid)' }}>{s.label}</span>
                    <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:8 }}>{periodSlots.length} class{periodSlots.length!==1?'es':''} scheduled</span>
                    {periodArrangements.length > 0 && (
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background:'rgba(201,120,0,0.15)', color:'#b85c00', fontWeight:600 }}>
                        {periodArrangements.length} arrangement{periodArrangements.length!==1?'s':''}
                      </span>
                    )}
                    <button onClick={() => { setModalPeriod(s.period); setStep(1); setModalAbsentTeacher(null); setModalArrangementTeacher(null); setModalClass(''); setModalNotes(''); setShowModal(true) }}
                      style={{ marginLeft:'auto', fontSize:12, color:'var(--green)', background:'none', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-sm)', padding:'4px 12px', cursor:'pointer', fontWeight:500 }}>
                      + Add
                    </button>
                  </div>

                  {/* Scheduled classes + any arrangements */}
                  <div>
                    {periodSlots.map((slot, i) => {
                      const arr = periodArrangements.find(a => a.absentTeacherId === slot.teacherId && a.className === slot.className)
                      return (
                        <div key={slot.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderBottom:'1px solid var(--gray-50)', background: arr ? '#fff8f0' : 'var(--white)' }}>
                          <div style={{ width:32, height:32, borderRadius:'50%', background: arr ? 'rgba(201,120,0,0.15)' : 'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <span style={{ fontSize:10, fontWeight:700, color: arr ? '#b85c00' : 'var(--green)' }}>{slot.teacherName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', display:'flex', alignItems:'center', gap:8 }}>
                              {slot.teacherName}
                              {arr && <span style={{ fontSize:11, padding:'1px 7px', borderRadius:8, background:'rgba(139,26,26,0.1)', color:'var(--crimson)', fontWeight:600 }}>Absent</span>}
                            </div>
                            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{slot.className} · {slot.subject}</div>
                          </div>
                          {arr ? (
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:12, color:'#b85c00', fontWeight:600 }}>→ {arr.arrangementTeacherName}</div>
                              <div style={{ fontSize:11, color:'var(--text-muted)' }}>Arrangement</div>
                            </div>
                          ) : (
                            <button onClick={() => openModal(s.period, slot)} style={{ fontSize:12, color:'#b85c00', background:'rgba(201,120,0,0.08)', border:'1px solid rgba(201,120,0,0.2)', borderRadius:'var(--radius-sm)', padding:'4px 10px', cursor:'pointer' }}>
                              Mark absent
                            </button>
                          )}
                          {arr && (
                            <button onClick={() => handleDelete(arr.id)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer', marginLeft:4 }}>✕</button>
                          )}
                        </div>
                      )
                    })}

                    {/* Any additional arrangements not tied to a timetable slot */}
                    {periodArrangements.filter(a => !periodSlots.find(s => s.teacherId === a.absentTeacherId && s.className === a.className)).map(arr => (
                      <div key={arr.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderBottom:'1px solid var(--gray-50)', background:'#fff8f0' }}>
                        <div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(201,120,0,0.15)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <span style={{ fontSize:10, fontWeight:700, color:'#b85c00' }}>{arr.absentTeacherName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', display:'flex', alignItems:'center', gap:8 }}>
                            {arr.absentTeacherName}
                            <span style={{ fontSize:11, padding:'1px 7px', borderRadius:8, background:'rgba(139,26,26,0.1)', color:'var(--crimson)', fontWeight:600 }}>Absent</span>
                          </div>
                          <div style={{ fontSize:12, color:'var(--text-muted)' }}>{arr.className}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:12, color:'#b85c00', fontWeight:600 }}>→ {arr.arrangementTeacherName}</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)' }}>Arrangement</div>
                        </div>
                        <button onClick={() => handleDelete(arr.id)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer', marginLeft:4 }}>✕</button>
                      </div>
                    ))}

                    {periodSlots.length === 0 && periodArrangements.length === 0 && (
                      <div style={{ padding:'12px 16px', fontSize:13, color:'var(--gray-400)', fontStyle:'italic' }}>No classes scheduled this period.</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        /* HISTORY VIEW */
        <div>
          <div style={{ display:'flex', gap:12, marginBottom:16, alignItems:'center' }}>
            <select value={historyTeacher} onChange={e => setHistoryTeacher(e.target.value)} style={{ ...inp, maxWidth:280 }}>
              <option value="">All teachers</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
            <span style={{ fontSize:13, color:'var(--text-muted)' }}>{filteredHistory.length} arrangement{filteredHistory.length!==1?'s':''}</span>
          </div>

          {filteredHistory.length === 0 ? (
            <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:13 }}>
              No arrangement records found.
            </div>
          ) : (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'var(--gray-50)' }}>
                    {['Date','Period','Class','Absent Teacher','Arrangement Teacher','Notes',''].map(h => (
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((arr, i) => (
                    <tr key={arr.id} style={{ borderTop:'1px solid var(--gray-50)', background:i%2===0?'var(--white)':'var(--gray-50)' }}>
                      <td style={{ padding:'10px 14px', whiteSpace:'nowrap' }}>
                        <div style={{ fontWeight:500 }}>{arr.date}</div>
                        <div style={{ fontSize:11, color:'var(--text-muted)' }}>{arr.day}</div>
                      </td>
                      <td style={{ padding:'10px 14px', whiteSpace:'nowrap' }}>
                        <div style={{ fontWeight:600, color:'var(--green-dark)' }}>P{arr.period}</div>
                        <div style={{ fontSize:11, color:'var(--text-muted)' }}>{arr.periodTime}</div>
                      </td>
                      <td style={{ padding:'10px 14px' }}><span style={{ fontSize:12, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{arr.className}</span></td>
                      <td style={{ padding:'10px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:26, height:26, borderRadius:'50%', background:'rgba(139,26,26,0.1)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <span style={{ fontSize:9, fontWeight:700, color:'var(--crimson)' }}>{arr.absentTeacherName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                          </div>
                          <span style={{ fontWeight:500 }}>{arr.absentTeacherName}</span>
                        </div>
                      </td>
                      <td style={{ padding:'10px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:26, height:26, borderRadius:'50%', background:'rgba(201,120,0,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <span style={{ fontSize:9, fontWeight:700, color:'#b85c00' }}>{arr.arrangementTeacherName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                          </div>
                          <span style={{ fontWeight:500, color:'#b85c00' }}>{arr.arrangementTeacherName}</span>
                        </div>
                      </td>
                      <td style={{ padding:'10px 14px', color:'var(--text-muted)', fontSize:12, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{arr.notes || '—'}</td>
                      <td style={{ padding:'10px 14px' }}>
                        <button onClick={() => handleDelete(arr.id)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer' }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
          <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:520, boxShadow:'var(--shadow-lg)', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'var(--white)', zIndex:1 }}>
              <div>
                <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:600, color:'var(--green-dark)' }}>Add Arrangement</h2>
                <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{format(parseISO(date), 'EEEE, d MMM yyyy')} · {step === 1 ? 'Select absent teacher' : 'Select arrangement teacher'}</p>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22 }}>×</button>
            </div>

            <div style={{ padding:'20px' }}>
              {/* Period selector */}
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:6 }}>Period <span style={{ color:'var(--crimson)' }}>*</span></label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {dayPeriods.map(s => (
                    <button key={s.period} onClick={() => { setModalPeriod(s.period); setModalAbsentTeacher(null); setModalArrangementTeacher(null); setStep(1) }}
                      style={{ padding:'6px 12px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor:modalPeriod===s.period?'var(--green)':'var(--gray-200)', background:modalPeriod===s.period?'var(--green)':'var(--white)', color:modalPeriod===s.period?'white':'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer' }}>
                      P{s.period}<span style={{ fontSize:10, opacity:0.8, marginLeft:4 }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {modalPeriod && step === 1 && (
                <>
                  {/* Class selection */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:6 }}>Class</label>
                    <select value={modalClass} onChange={e => { setModalClass(e.target.value); setModalAbsentTeacher(null) }} style={inp}>
                      <option value="">All classes / manual entry</option>
                      {classesForPeriod(day, modalPeriod).map(s => (
                        <option key={s.id} value={s.className}>{s.className} — {s.teacherName}</option>
                      ))}
                    </select>
                  </div>

                  {/* Absent teacher — filtered by selected class or all */}
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:6 }}>Absent Teacher <span style={{ color:'var(--crimson)' }}>*</span></label>
                    <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:240, overflowY:'auto', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', padding:8 }}>
                      {(() => {
                        const periodSlots = classesForPeriod(day, modalPeriod)
                        const relevant = modalClass
                          ? periodSlots.filter(s => s.className === modalClass)
                          : periodSlots
                        const scheduled = relevant.map(s => ({ id:s.teacherId, fullName:s.teacherName, className:s.className, subject:s.subject }))
                        // Also allow picking any teacher not currently showing as absent today
                        const alreadyAbsent = new Set(arrangements.filter(a => a.period === modalPeriod).map(a => a.absentTeacherId))
                        const available = scheduled.filter(t => !alreadyAbsent.has(t.id))
                        if (available.length === 0) return <div style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic', padding:8 }}>No scheduled teachers for this period/class.</div>
                        return available.map(t => (
                          <button key={t.id} onClick={() => { setModalAbsentTeacher(t); setModalClass(t.className || modalClass); setStep(2) }}
                            style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor:modalAbsentTeacher?.id===t.id?'var(--crimson)':'var(--gray-100)', background:modalAbsentTeacher?.id===t.id?'var(--crimson-light)':'var(--white)', cursor:'pointer', textAlign:'left' }}>
                            <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                              <span style={{ fontSize:10, fontWeight:700, color:'var(--green)' }}>{t.fullName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                            </div>
                            <div>
                              <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{t.fullName}</div>
                              <div style={{ fontSize:11, color:'var(--text-muted)' }}>{t.className} · {t.subject}</div>
                            </div>
                            <span style={{ marginLeft:'auto', fontSize:11, padding:'2px 8px', borderRadius:8, background:'rgba(139,26,26,0.1)', color:'var(--crimson)' }}>Mark absent</span>
                          </button>
                        ))
                      })()}
                    </div>
                  </div>
                </>
              )}

              {modalPeriod && step === 2 && modalAbsentTeacher && (
                <>
                  {/* Absent teacher confirmed */}
                  <div style={{ background:'var(--crimson-light)', borderRadius:'var(--radius-sm)', padding:'10px 14px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--crimson)" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--crimson)' }}>{modalAbsentTeacher.fullName} — Absent</div>
                      <div style={{ fontSize:11, color:'var(--crimson)' }}>{modalClass} · P{modalPeriod}</div>
                    </div>
                    <button onClick={() => { setStep(1); setModalAbsentTeacher(null) }} style={{ marginLeft:'auto', fontSize:11, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer' }}>Change</button>
                  </div>

                  {/* Free teachers */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:6 }}>
                      Available Teachers for Arrangement
                      <span style={{ marginLeft:6, fontSize:11, fontWeight:400, color:'var(--green)' }}>— free in P{modalPeriod}</span>
                    </label>
                    <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:260, overflowY:'auto', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', padding:8 }}>
                      {freeTeachers(day, modalPeriod).length === 0 ? (
                        <div style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic', padding:8 }}>No free teachers in this period.</div>
                      ) : freeTeachers(day, modalPeriod).map(t => (
                        <button key={t.id} onClick={() => setModalArrangementTeacher(t)}
                          style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor:modalArrangementTeacher?.id===t.id?'#b85c00':'var(--gray-100)', background:modalArrangementTeacher?.id===t.id?'rgba(201,120,0,0.08)':'var(--white)', cursor:'pointer', textAlign:'left' }}>
                          <div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(201,120,0,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <span style={{ fontSize:10, fontWeight:700, color:'#b85c00' }}>{t.fullName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{t.fullName}</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>{(t.subjectsTaught||[]).slice(0,3).join(', ') || 'No subjects listed'}</div>
                          </div>
                          {modalArrangementTeacher?.id===t.id && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'rgba(201,120,0,0.15)', color:'#b85c00', fontWeight:600 }}>Selected ✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Notes <span style={{ fontWeight:400 }}>(optional)</span></label>
                    <input value={modalNotes} onChange={e => setModalNotes(e.target.value)} placeholder="e.g. Medical leave, personal work..." style={inp} />
                  </div>

                  <button onClick={handleSave} disabled={!modalArrangementTeacher || saving}
                    style={{ width:'100%', padding:'12px', background:!modalArrangementTeacher?'var(--gray-200)':'var(--green)', color:!modalArrangementTeacher?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:600, cursor:!modalArrangementTeacher?'not-allowed':'pointer' }}>
                    {saving ? 'Saving…' : `Confirm — ${modalArrangementTeacher?.fullName || '...'} covers P${modalPeriod}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
