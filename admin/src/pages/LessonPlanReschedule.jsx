import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, query, where, doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { format, addDays, parseISO } from 'date-fns'
import { cascadeShift, cascadeUtils } from '../utils/cascadeEngine'

const { weekStart, dayName } = cascadeUtils

const SESSION_END = '2027-03-31'  // hard end of academic session for drop boundary

function inp() {
  return { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }
}

function Chip({ kind = 'gray', children }) {
  const styles = {
    green:   { bg:'var(--green-light)',   color:'var(--green)' },
    gold:    { bg:'var(--gold-light)',    color:'var(--gold-dark)' },
    crimson: { bg:'var(--crimson-light)', color:'var(--crimson)' },
    gray:    { bg:'var(--gray-100)',      color:'var(--text-muted)' },
  }
  const s = styles[kind] || styles.gray
  return <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 9px', borderRadius:12, fontSize:10.5, fontWeight:600, background:s.bg, color:s.color }}>{children}</span>
}

export default function LessonPlanReschedule() {
  const { effectiveBranches, currentBranch, allowedBranches } = useAuth()
  const [mode, setMode] = useState('selected')

  const [teachers, setTeachers] = useState([])
  const [loadError, setLoadError] = useState('')

  // Mode A
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [shiftDays, setShiftDays] = useState(1)
  const [matchPeriod, setMatchPeriod] = useState(true)
  const [cascadeOnCollision, setCascadeOnCollision] = useState(true)
  const [reason, setReason] = useState('')
  const [allPlans, setAllPlans] = useState([])
  const [allActivePlans, setAllActivePlans] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  // Mode B
  const [holidayDate, setHolidayDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [holidayLabel, setHolidayLabel] = useState('')
  const [holidayScope, setHolidayScope] = useState('all')
  const [holidayTeacher, setHolidayTeacher] = useState('')
  const [holidayLoading, setHolidayLoading] = useState(false)

  // Shared preview & commit
  const [preview, setPreview] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))).then(snap =>
      setTeachers(snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(t => t.isActive !== false).sort((a,b) => a.fullName.localeCompare(b.fullName)))
    ).catch(e => console.error('teachers load:', e))
  }, [effectiveBranches])

  async function loadPlans() {
    if (!selectedTeacher || !selectedDate) return
    setLoading(true); setPreviewing(true); setAllPlans([]); setSelected(new Set()); setLoadError(''); setPreview(null); setDone(null)
    try {
      // Single-field query: fetch ALL active plans for this teacher (covers entire term).
      // We need this for cascade collision detection — plans on dates after selectedDate
      // could be evicted forward if cascade hits their slots.
      const snap = await getDocs(query(
        collection(db, 'lessonPlans'),
        where('teacherId', '==', selectedTeacher),
        ...branchConstraints('branchCode', effectiveBranches)
      ))
      const allActive = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(p => p.status !== 'superseded')

      // For the UI, only show plans on or after the selected date (consistent with previous behaviour)
      const future = allActive.filter(p => (p.dateStr || '') >= selectedDate).sort((a,b) => {
        const dc = (a.dateStr||'').localeCompare(b.dateStr||'')
        return dc !== 0 ? dc : (a.period||0) - (b.period||0)
      })

      setAllPlans(future)            // shown in the selectable list
      setAllActivePlans(allActive)   // used by cascade engine for collision detection
      setSelected(new Set(future.map(p => p.id)))
      if (future.length === 0) {
        setLoadError('No upcoming lesson plans found for this teacher on or after the selected date.')
      }
    } catch(e) {
      console.error('LessonPlanReschedule load:', e)
      if (e.code === 'permission-denied') {
        setLoadError('Permission denied. Check admin access and Firestore rules.')
      } else {
        setLoadError('Could not load plans: ' + (e.message || e.code || 'unknown error'))
      }
    }
    setLoading(false)
  }

  async function buildPreviewSelected() {
    setPreview(null); setLoadError('')
    if (selected.size === 0) {
      setLoadError('Select at least one plan to shift')
      return
    }
    try {
      const ttSnap = await getDocs(query(
        collection(db, 'timetable'),
        where('teacherId', '==', selectedTeacher),
        ...branchConstraints('branchCode', effectiveBranches)
      ))
      const timetable = ttSnap.docs.map(d => ({ id:d.id, ...d.data() }))
      const toShift = allPlans.filter(p => selected.has(p.id))
      const earliestSourceDate = toShift.map(p => p.dateStr).sort()[0]
      const earliestTarget = format(addDays(parseISO(earliestSourceDate), shiftDays), 'yyyy-MM-dd')
      const result = cascadeShift({
        plansToShift: toShift,
        allTeacherPlans: allActivePlans,
        timetable,
        fromDate: earliestTarget,
        sessionEnd: SESSION_END,
        matchPeriod,
        cascade: cascadeOnCollision,
      })
      const teacher = teachers.find(t => t.id === selectedTeacher)
      setPreview({
        ...result,
        teacherName: teacher?.fullName || '',
        teacherId: selectedTeacher,
        sourceDate: earliestSourceDate,
        kind: 'selected',
      })
    } catch(e) {
      console.error('Preview error:', e)
      setLoadError('Could not build preview: ' + (e.message || 'unknown error'))
    }
  }

  async function buildPreviewHoliday() {
    setPreview(null); setLoadError(''); setHolidayLoading(true)
    try {
      const affectedTeacherIds = holidayScope === 'all' ? teachers.map(t => t.id) : (holidayTeacher ? [holidayTeacher] : [])
      if (affectedTeacherIds.length === 0) {
        setLoadError('Pick a scope (all teachers or one teacher)')
        setHolidayLoading(false)
        return
      }
      const teacherResults = []
      for (const tId of affectedTeacherIds) {
        const planSnap = await getDocs(query(
          collection(db, 'lessonPlans'),
          where('teacherId', '==', tId),
          where('dateStr', '>=', holidayDate),
          ...branchConstraints('branchCode', effectiveBranches)
        ))
        const allActive = planSnap.docs.map(d => ({ id:d.id, ...d.data() })).filter(p => p.status !== 'superseded')
        const onHoliday = allActive.filter(p => p.dateStr === holidayDate)
        if (onHoliday.length === 0) continue
        const ttSnap = await getDocs(query(
          collection(db, 'timetable'),
          where('teacherId', '==', tId),
          ...branchConstraints('branchCode', effectiveBranches)
        ))
        const timetable = ttSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        const result = cascadeShift({
          plansToShift: onHoliday,
          allTeacherPlans: allActive,
          timetable,
          fromDate: holidayDate,
          sessionEnd: SESSION_END,
          matchPeriod: true,
          cascade: true,
        })
        const teacher = teachers.find(t => t.id === tId)
        teacherResults.push({
          teacherId: tId,
          teacherName: teacher?.fullName || '',
          plansOnHoliday: onHoliday,
          resolved: result.resolved,
          dropped: result.dropped,
          refused: result.refused,
        })
      }
      setPreview({
        kind: 'holiday',
        holidayDate,
        holidayLabel: holidayLabel.trim() || 'School holiday',
        scope: holidayScope,
        teacherResults,
      })
    } catch(e) {
      console.error('Holiday preview error:', e)
      setLoadError('Could not build preview: ' + (e.message || 'unknown error'))
    }
    setHolidayLoading(false)
  }

  async function commitPreview() {
    if (!preview) return
    setCommitting(true)
    const now = Timestamp.now()
    const cascadeId = now.toMillis().toString()
    let committedCount = 0, droppedCount = 0, refusedCount = 0
    try {
      if (preview.kind === 'selected') {
        const reasonText = reason.trim() || 'Rescheduled by admin'
        for (const r of preview.resolved) {
          const {id: _id, ...planData} = r.plan
          await addDoc(collection(db, 'lessonPlans'), {
            ...planData,
            // Explicit branchCode: prefer the source plan's, fall back to current
            // branch view, fall back to first allowed branch. Bulletproofs against
            // any pre-2c plans that lack branchCode.
            branchCode: planData.branchCode || currentBranch || allowedBranches[0] || 'MAIN',
            periodId: r.newSlotId,
            period: Number(r.slot.period),
            periodTime: r.slot.periodTime || planData.periodTime || '',
            dateStr: r.newDate,
            day: dayName(r.newDate),
            weekStart: weekStart(r.newDate),
            rescheduledFrom: r.plan.dateStr,
            rescheduledBy: 'admin',
            rescheduleReason: reasonText,
            cascadeId,
            submittedAt: now,
            status: 'submitted',
          })
          await updateDoc(doc(db, 'lessonPlans', r.plan.id), {
            status: 'superseded',
            rescheduledTo: r.newDate,
            rescheduledBy: 'admin',
            rescheduleReason: reasonText,
            cascadeId,
          })
          committedCount++
        }
        droppedCount = preview.dropped.length
        refusedCount = preview.refused.length
      } else if (preview.kind === 'holiday') {
        const reasonText = `Holiday: ${preview.holidayLabel}`
        for (const tr of preview.teacherResults) {
          for (const r of tr.resolved) {
            const {id: _id, ...planData} = r.plan
            await addDoc(collection(db, 'lessonPlans'), {
              ...planData,
              branchCode: planData.branchCode || currentBranch || allowedBranches[0] || 'MAIN',
              periodId: r.newSlotId,
              period: Number(r.slot.period),
              periodTime: r.slot.periodTime || planData.periodTime || '',
              dateStr: r.newDate,
              day: dayName(r.newDate),
              weekStart: weekStart(r.newDate),
              rescheduledFrom: r.plan.dateStr,
              rescheduledBy: 'admin-holiday',
              rescheduleReason: reasonText,
              cascadeId,
              submittedAt: now,
              status: 'submitted',
            })
            await updateDoc(doc(db, 'lessonPlans', r.plan.id), {
              status: 'superseded',
              rescheduledTo: r.newDate,
              rescheduledBy: 'admin-holiday',
              rescheduleReason: reasonText,
              cascadeId,
            })
            committedCount++
          }
          droppedCount += tr.dropped.length
        }
      }
      setDone({ committedCount, droppedCount, refusedCount })
      setPreview(null); setAllPlans([]); setSelected(new Set()); setPreviewing(false)
    } catch(e) {
      console.error('Commit error:', e)
      setLoadError('Commit failed (some changes may have been written): ' + (e.message || e.code || 'unknown'))
    }
    setCommitting(false)
  }

  function togglePlan(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
    setPreview(null)
  }
  function toggleAll(check) { setSelected(check ? new Set(allPlans.map(p => p.id)) : new Set()); setPreview(null) }
  function toggleDate(dateStr, check) {
    const ids = allPlans.filter(p => p.dateStr === dateStr).map(p => p.id)
    setSelected(prev => { const next = new Set(prev); ids.forEach(id => check ? next.add(id) : next.delete(id)); return next })
    setPreview(null)
  }

  const byDate = useMemo(() => {
    const acc = {}
    for (const p of allPlans) { if (!acc[p.dateStr]) acc[p.dateStr] = []; acc[p.dateStr].push(p) }
    return acc
  }, [allPlans])
  const allChecked = allPlans.length > 0 && allPlans.every(p => selected.has(p.id))
  const someChecked = allPlans.some(p => selected.has(p.id))

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>
      <div className="fade-in" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Reschedule Lesson Plans</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Shift plans forward when teachers are absent or schedule changes. Cascade collisions handled automatically.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg,var(--gold),transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:22, background:'var(--gray-50)', padding:6, borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)' }}>
        <button onClick={() => { setMode('selected'); setPreview(null); setDone(null); setLoadError('') }} style={{
            flex:1, padding:'12px 14px', borderRadius:'var(--radius-sm)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:11,
            background: mode==='selected' ? 'var(--white)' : 'transparent',
            boxShadow: mode==='selected' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            fontFamily:'var(--font-body)', textAlign:'left' }}>
          <div style={{ width:32, height:32, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                        background: mode==='selected' ? 'var(--green-light)' : 'var(--gray-100)',
                        color: mode==='selected' ? 'var(--green)' : 'var(--text-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:13, fontWeight:600, color: mode==='selected' ? 'var(--green-dark)' : 'var(--text)', marginBottom:3 }}>Reschedule selected plans</div>
            <div style={{ fontSize:10.5, color:'var(--text-muted)', lineHeight:1.3 }}>Pick specific plans to shift forward</div>
          </div>
        </button>
        <button onClick={() => { setMode('holiday'); setPreview(null); setDone(null); setLoadError('') }} style={{
            flex:1, padding:'12px 14px', borderRadius:'var(--radius-sm)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:11,
            background: mode==='holiday' ? 'var(--white)' : 'transparent',
            boxShadow: mode==='holiday' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            fontFamily:'var(--font-body)', textAlign:'left' }}>
          <div style={{ width:32, height:32, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                        background: mode==='holiday' ? 'var(--green-light)' : 'var(--gray-100)',
                        color: mode==='holiday' ? 'var(--green)' : 'var(--text-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:13, fontWeight:600, color: mode==='holiday' ? 'var(--green-dark)' : 'var(--text)', marginBottom:3 }}>Insert holiday</div>
            <div style={{ fontSize:10.5, color:'var(--text-muted)', lineHeight:1.3 }}>Mark a day off; cascade everyone forward</div>
          </div>
        </button>
      </div>

      {done && (
        <div style={{ background: done.committedCount > 0 ? 'var(--green)' : 'var(--gold-dark)', borderRadius:'var(--radius-lg)', padding:'14px 18px', marginBottom:18, color:'white', display:'flex', alignItems:'center', gap:12 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:600 }}>{done.committedCount} plan{done.committedCount!==1?'s':''} rescheduled</div>
            <div style={{ fontSize:12, opacity:0.85, marginTop:2 }}>
              Originals marked superseded · {done.droppedCount > 0 ? `${done.droppedCount} dropped (extended past session end)` : 'No plans dropped'}
            </div>
          </div>
        </div>
      )}

      {loadError && (
        <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.25)', borderRadius:'var(--radius-md)', padding:'11px 14px', marginBottom:14, display:'flex', gap:10, alignItems:'flex-start' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--crimson)" strokeWidth="2" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div style={{ fontSize:12, color:'var(--crimson)', lineHeight:1.5 }}>{loadError}</div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:22, alignItems:'start' }}>
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden', position:'sticky', top:20 }}>
          <div style={{ padding:'13px 18px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>
              {mode === 'selected' ? 'Setup' : 'Holiday details'}
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>
              {mode === 'selected' ? 'Pick plans and choose how far to shift' : 'School-wide or per-teacher cascade'}
            </div>
          </div>
          <div style={{ padding:18, display:'flex', flexDirection:'column', gap:14 }}>

            {mode === 'selected' && (
              <>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Teacher <span style={{ color:'var(--crimson)' }}>*</span></label>
                  <select value={selectedTeacher} onChange={e => { setSelectedTeacher(e.target.value); setAllPlans([]); setPreview(null); setPreviewing(false) }} style={inp()}>
                    <option value="">Select teacher…</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>From date <span style={{ color:'var(--crimson)' }}>*</span></label>
                  <input type="date" value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setAllPlans([]); setPreview(null); setPreviewing(false) }} style={inp()} />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Shift forward by</label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8 }}>
                    {[1,2,3,5,7].map(n => (
                      <button key={n} onClick={() => { setShiftDays(n); setPreview(null) }} style={{ padding:'7px 13px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor:shiftDays===n?'var(--green)':'var(--gray-200)', background:shiftDays===n?'var(--green)':'var(--white)', color:shiftDays===n?'white':'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer' }}>+{n}d</button>
                    ))}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <input type="number" min="1" max="60" value={shiftDays} onChange={e => { setShiftDays(Math.max(1, Number(e.target.value))); setPreview(null) }} style={{ ...inp(), width:70, textAlign:'center' }} />
                    <span style={{ fontSize:12, color:'var(--text-muted)' }}>day{shiftDays!==1?'s':''} · Sundays skipped</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Cascade on collision</label>
                  <div style={{ display:'inline-flex', background:'var(--gray-100)', borderRadius:'var(--radius-sm)', padding:3, border:'1px solid var(--gray-200)' }}>
                    <button onClick={() => { setCascadeOnCollision(true); setPreview(null) }} style={{ padding:'6px 14px', borderRadius:4, border:'none', cursor:'pointer', fontSize:11, fontWeight:600, background:cascadeOnCollision?'white':'transparent', color:cascadeOnCollision?'var(--green-dark)':'var(--text-muted)', boxShadow:cascadeOnCollision?'0 1px 3px rgba(0,0,0,0.08)':'none' }}>On</button>
                    <button onClick={() => { setCascadeOnCollision(false); setPreview(null) }} style={{ padding:'6px 14px', borderRadius:4, border:'none', cursor:'pointer', fontSize:11, fontWeight:600, background:!cascadeOnCollision?'white':'transparent', color:!cascadeOnCollision?'var(--green-dark)':'var(--text-muted)', boxShadow:!cascadeOnCollision?'0 1px 3px rgba(0,0,0,0.08)':'none' }}>Off</button>
                  </div>
                  <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:5, lineHeight:1.4 }}>Push existing plan forward if target slot is taken. Recommended ON.</p>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Match by</label>
                  <div style={{ display:'inline-flex', background:'var(--gray-100)', borderRadius:'var(--radius-sm)', padding:3, border:'1px solid var(--gray-200)' }}>
                    <button onClick={() => { setMatchPeriod(true); setPreview(null) }} style={{ padding:'6px 12px', borderRadius:4, border:'none', cursor:'pointer', fontSize:11, fontWeight:600, background:matchPeriod?'white':'transparent', color:matchPeriod?'var(--green-dark)':'var(--text-muted)', boxShadow:matchPeriod?'0 1px 3px rgba(0,0,0,0.08)':'none' }}>Same period</button>
                    <button onClick={() => { setMatchPeriod(false); setPreview(null) }} style={{ padding:'6px 12px', borderRadius:4, border:'none', cursor:'pointer', fontSize:11, fontWeight:600, background:!matchPeriod?'white':'transparent', color:!matchPeriod?'var(--green-dark)':'var(--text-muted)', boxShadow:!matchPeriod?'0 1px 3px rgba(0,0,0,0.08)':'none' }}>Any period</button>
                  </div>
                  <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:5, lineHeight:1.4 }}>Strict keeps period order; loose finds next occurrence regardless of period.</p>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Reason (optional)</label>
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Teacher absent" style={inp()} />
                </div>
                <button onClick={loadPlans} disabled={!selectedTeacher || !selectedDate || loading} style={{ padding:'11px', background:(!selectedTeacher||!selectedDate)?'var(--gray-200)':'var(--gold)', color:(!selectedTeacher||!selectedDate)?'var(--gray-400)':'#1a2e10', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:(!selectedTeacher||!selectedDate)?'not-allowed':'pointer', boxShadow:(!selectedTeacher||!selectedDate)?'none':'0 2px 8px rgba(201,162,39,0.3)' }}>
                  {loading ? 'Loading…' : '↓ Load plans'}
                </button>
                {previewing && !loading && allPlans.length > 0 && !preview && (
                  <button onClick={buildPreviewSelected} disabled={selected.size === 0} style={{ padding:'11px', background:selected.size===0?'var(--gray-200)':'var(--green)', color:selected.size===0?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:selected.size===0?'not-allowed':'pointer' }}>
                    Build cascade preview →
                  </button>
                )}
              </>
            )}

            {mode === 'holiday' && (
              <>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Holiday date <span style={{ color:'var(--crimson)' }}>*</span></label>
                  <input type="date" value={holidayDate} onChange={e => { setHolidayDate(e.target.value); setPreview(null) }} style={inp()} />
                  <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{holidayDate ? format(parseISO(holidayDate), 'EEEE, d MMMM yyyy') : ''}</p>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Holiday name / reason</label>
                  <input value={holidayLabel} onChange={e => setHolidayLabel(e.target.value)} placeholder="e.g. Eid al-Fitr, Election Duty" style={inp()} />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Scope</label>
                  <div onClick={() => { setHolidayScope('all'); setPreview(null) }} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px', border:'1px solid', borderColor:holidayScope==='all'?'var(--green)':'var(--gray-200)', borderRadius:'var(--radius-sm)', cursor:'pointer', marginBottom:8, background:holidayScope==='all'?'var(--green-light)':'white' }}>
                    <div style={{ width:18, height:18, border:'2px solid', borderColor:holidayScope==='all'?'var(--green)':'var(--gray-300)', borderRadius:4, flexShrink:0, marginTop:1, display:'flex', alignItems:'center', justifyContent:'center', background:holidayScope==='all'?'var(--green)':'white' }}>
                      {holidayScope==='all' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12.5, fontWeight:600, color:holidayScope==='all'?'var(--green-dark)':'var(--text)', lineHeight:1.2 }}>All teachers</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2, lineHeight:1.4 }}>School-wide cascade</div>
                    </div>
                  </div>
                  <div onClick={() => { setHolidayScope('teacher'); setPreview(null) }} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px', border:'1px solid', borderColor:holidayScope==='teacher'?'var(--green)':'var(--gray-200)', borderRadius:'var(--radius-sm)', cursor:'pointer', background:holidayScope==='teacher'?'var(--green-light)':'white' }}>
                    <div style={{ width:18, height:18, border:'2px solid', borderColor:holidayScope==='teacher'?'var(--green)':'var(--gray-300)', borderRadius:4, flexShrink:0, marginTop:1, display:'flex', alignItems:'center', justifyContent:'center', background:holidayScope==='teacher'?'var(--green)':'white' }}>
                      {holidayScope==='teacher' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12.5, fontWeight:600, color:holidayScope==='teacher'?'var(--green-dark)':'var(--text)', lineHeight:1.2 }}>Specific teacher only</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2, lineHeight:1.4 }}>Useful for individual leave</div>
                    </div>
                  </div>
                </div>
                {holidayScope === 'teacher' && (
                  <div>
                    <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:6 }}>Teacher <span style={{ color:'var(--crimson)' }}>*</span></label>
                    <select value={holidayTeacher} onChange={e => { setHolidayTeacher(e.target.value); setPreview(null) }} style={inp()}>
                      <option value="">Select teacher…</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                    </select>
                  </div>
                )}
                <button onClick={buildPreviewHoliday} disabled={!holidayDate || (holidayScope==='teacher' && !holidayTeacher) || holidayLoading} style={{ padding:'11px', background:(!holidayDate||(holidayScope==='teacher'&&!holidayTeacher))?'var(--gray-200)':'var(--green)', color:(!holidayDate||(holidayScope==='teacher'&&!holidayTeacher))?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:(!holidayDate||(holidayScope==='teacher'&&!holidayTeacher))?'not-allowed':'pointer' }}>
                  {holidayLoading ? 'Building preview…' : 'Preview cascade →'}
                </button>
              </>
            )}
          </div>
        </div>

        <div>
          {mode === 'selected' && previewing && !loading && allPlans.length > 0 && !preview && (
            <PlanSelectorList byDate={byDate} selected={selected} togglePlan={togglePlan} toggleAll={toggleAll} toggleDate={toggleDate} allChecked={allChecked} someChecked={someChecked} allPlans={allPlans} />
          )}
          {preview && preview.kind === 'selected' && (
            <CascadePreview preview={preview} onCommit={commitPreview} onCancel={() => setPreview(null)} committing={committing} />
          )}
          {preview && preview.kind === 'holiday' && (
            <HolidayPreview preview={preview} onCommit={commitPreview} onCancel={() => setPreview(null)} committing={committing} />
          )}
          {mode === 'selected' && !previewing && !preview && !done && (
            <EmptyState title="No plans loaded yet" desc="Select a teacher and date, then click Load plans"
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>} />
          )}
          {mode === 'holiday' && !preview && !done && (
            <EmptyState title="No preview yet" desc="Pick the holiday date and scope, then click Preview cascade"
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>} />
          )}
          {mode === 'selected' && loading && (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:48, textAlign:'center' }}>
              <div style={{ width:30, height:30, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PlanSelectorList({ byDate, selected, togglePlan, toggleAll, toggleDate, allChecked, someChecked, allPlans }) {
  return (
    <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
      <div style={{ padding:'13px 18px', background:'var(--gold-light)', borderBottom:'1px solid rgba(201,162,39,0.2)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = !allChecked && someChecked }}
            onChange={e => toggleAll(e.target.checked)} style={{ width:16, height:16, cursor:'pointer', accentColor:'var(--green)' }} />
          <span style={{ fontSize:13, fontWeight:600, color:'var(--gold-dark)' }}>{selected.size} of {allPlans.length} plans selected</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => toggleAll(true)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Select all</button>
          <span style={{ color:'var(--gray-300)' }}>·</span>
          <button onClick={() => toggleAll(false)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Deselect all</button>
        </div>
      </div>
      <div style={{ maxHeight:520, overflowY:'auto' }}>
        {Object.entries(byDate).map(([dateStr, plans]) => {
          const dateSelected = plans.every(p => selected.has(p.id))
          const dateSome = plans.some(p => selected.has(p.id))
          return (
            <div key={dateStr}>
              <div style={{ padding:'8px 18px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:10, position:'sticky', top:0, zIndex:1 }}>
                <input type="checkbox" checked={dateSelected} ref={el => { if (el) el.indeterminate = !dateSelected && dateSome }}
                  onChange={e => toggleDate(dateStr, e.target.checked)} style={{ width:15, height:15, cursor:'pointer', accentColor:'var(--green)' }} />
                <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{format(parseISO(dateStr), 'EEEE, d MMMM yyyy')}</span>
                <span style={{ fontSize:11, color:'var(--text-muted)' }}>{plans.filter(p => selected.has(p.id)).length}/{plans.length}</span>
              </div>
              {plans.map(plan => {
                const isSel = selected.has(plan.id)
                return (
                  <div key={plan.id} onClick={() => togglePlan(plan.id)}
                    style={{ padding:'11px 18px 11px 48px', borderBottom:'1px solid var(--gray-50)', display:'flex', alignItems:'flex-start', gap:12, cursor:'pointer', background:isSel?'#f0faf4':'var(--white)' }}>
                    <input type="checkbox" checked={isSel} onChange={() => togglePlan(plan.id)} onClick={e => e.stopPropagation()}
                      style={{ width:15, height:15, marginTop:2, cursor:'pointer', accentColor:'var(--green)', flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:3 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>P{plan.period}</span>
                        {plan.periodTime && <span style={{ fontSize:11, color:'var(--text-muted)' }}>{plan.periodTime}</span>}
                        <span style={{ fontSize:11, padding:'1px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{plan.className}</span>
                        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{plan.subject}</span>
                        {plan.status === 'rescheduled' && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'var(--gold-light)', color:'var(--gold-dark)' }}>↻</span>}
                      </div>
                      {plan.data?.topics && (
                        <div style={{ fontSize:12, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:400 }}>{plan.data.topics}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CascadePreview({ preview, onCommit, onCancel, committing }) {
  const byDestDate = {}
  for (const r of preview.resolved) {
    if (!byDestDate[r.newDate]) byDestDate[r.newDate] = []
    byDestDate[r.newDate].push(r)
  }
  const sortedDates = Object.keys(byDestDate).sort()
  return (
    <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
      <div style={{ padding:'14px 18px', background:'linear-gradient(90deg, var(--green-light), #f0f7f2)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:38, height:38, background:'var(--green)', color:'white', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>
            Preview · {preview.resolved.length} plan{preview.resolved.length !== 1 ? 's' : ''} will move
          </div>
          <div style={{ fontSize:11.5, color:'var(--green-mid)', marginTop:2 }}>
            {preview.teacherName} · {preview.dropped.length === 0 ? 'no plans dropped' : `${preview.dropped.length} dropped`}
          </div>
        </div>
        <div style={{ display:'flex', gap:14 }}>
          <Stat value={preview.resolved.length} label="Moved" color="var(--green-dark)" />
          {preview.dropped.length > 0 && <Stat value={preview.dropped.length} label="Dropped" color="var(--crimson)" />}
          {preview.refused.length > 0 && <Stat value={preview.refused.length} label="Refused" color="var(--gold-dark)" />}
        </div>
      </div>

      {(preview.dropped.length > 0 || preview.refused.length > 0) && (
        <div style={{ margin:'14px 18px 0', padding:'11px 14px', background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.25)', borderRadius:'var(--radius-sm)', display:'flex', gap:10, alignItems:'flex-start' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--crimson)" strokeWidth="2.2" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>
          <div style={{ fontSize:11.5, color:'var(--crimson)', lineHeight:1.5 }}>
            {preview.dropped.length > 0 && <div><strong>{preview.dropped.length} plan{preview.dropped.length!==1?'s':''} cannot be rescheduled</strong> — cascade exceeded session end ({SESSION_END}).</div>}
            {preview.refused.length > 0 && <div style={{ marginTop:4 }}><strong>{preview.refused.length} refused</strong> due to slot collision (cascade is OFF).</div>}
          </div>
        </div>
      )}

      <div style={{ padding:'18px 20px' }}>
        {sortedDates.map(date => (
          <div key={date} style={{ marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
              <span style={{ fontFamily:'var(--font-display)', fontSize:13, fontWeight:600, color:'var(--text)' }}>{format(parseISO(date), 'EEEE, d MMMM')}</span>
              <Chip kind="green">{byDestDate[date].length} arriving</Chip>
            </div>
            <div style={{ background:'var(--gray-50)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'8px 12px' }}>
              {byDestDate[date].map((r, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom: i === byDestDate[date].length-1 ? 'none' : '1px dashed var(--gray-200)' }}>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, color:'var(--text-muted)', background:'white', padding:'3px 7px', borderRadius:4, border:'1px solid var(--gray-200)' }}>P{r.slot.period}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11.5, fontWeight:600, color:'var(--text)' }}>{r.plan.className} · {r.plan.subject}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.plan.data?.topics ? r.plan.data.topics.substring(0, 60) : '—'}</div>
                  </div>
                  <Chip kind="gold">From {format(parseISO(r.plan.dateStr), 'EEE d MMM')}</Chip>
                </div>
              ))}
            </div>
          </div>
        ))}

        {preview.dropped.length > 0 && (
          <div style={{ marginTop:14, padding:'11px 14px', background:'#fef5f5', borderRadius:'var(--radius-md)', border:'1px solid rgba(139,26,26,0.15)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:12, fontWeight:600, color:'var(--crimson)', marginBottom:6 }}>Dropped plans</div>
            {preview.dropped.map((d, i) => (
              <div key={i} style={{ fontSize:11, color:'var(--text)', display:'flex', gap:8, padding:'4px 0' }}>
                <span style={{ color:'var(--text-muted)' }}>{d.plan.dateStr}</span>
                <span>·</span>
                <span style={{ fontWeight:500 }}>P{d.plan.period} {d.plan.className} {d.plan.subject}</span>
                <span style={{ color:'var(--crimson)', marginLeft:'auto' }}>{d.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding:'14px 20px', background:'var(--gray-50)', borderTop:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontSize:12, color:'var(--text-muted)' }}>
          <strong style={{ color:'var(--green-dark)' }}>{preview.resolved.length} plans</strong> will move forward · originals kept for audit
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel} disabled={committing} style={{ padding:'10px 16px', background:'white', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer' }}>Back to selection</button>
          <button onClick={onCommit} disabled={committing || preview.resolved.length === 0} style={{ padding:'12px 22px', background:'linear-gradient(135deg, var(--gold), var(--gold-dark))', color:'var(--green-dark)', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:700, cursor:committing?'wait':'pointer', display:'flex', alignItems:'center', gap:8, boxShadow:'0 3px 12px rgba(201,162,39,0.3)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            {committing ? 'Committing…' : 'Confirm cascade'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HolidayPreview({ preview, onCommit, onCancel, committing }) {
  const totalAffectedTeachers = preview.teacherResults.length
  const totalPlans = preview.teacherResults.reduce((sum, tr) => sum + tr.plansOnHoliday.length, 0)
  const totalResolved = preview.teacherResults.reduce((sum, tr) => sum + tr.resolved.length, 0)
  const totalDropped = preview.teacherResults.reduce((sum, tr) => sum + tr.dropped.length, 0)

  return (
    <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
      <div style={{ padding:'14px 18px', background:'linear-gradient(90deg, var(--crimson-light), #fdf0f0)', borderBottom:'1px solid rgba(139,26,26,0.2)', display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:38, height:38, background:'var(--crimson)', color:'white', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/></svg>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--crimson)' }}>{preview.holidayLabel} · {format(parseISO(preview.holidayDate), 'EEE, d MMM')}</div>
          <div style={{ fontSize:11.5, color:'var(--crimson)', opacity:0.8, marginTop:2 }}>{totalPlans} plan{totalPlans!==1?'s':''} cancelled · cascading across {totalAffectedTeachers} teacher{totalAffectedTeachers!==1?'s':''} · {totalDropped} dropped</div>
        </div>
        <div style={{ display:'flex', gap:14 }}>
          <Stat value={totalPlans} label="Plans" color="var(--crimson)" />
          <Stat value={totalAffectedTeachers} label="Teachers" color="var(--gold-dark)" />
        </div>
      </div>

      {totalDropped > 0 && (
        <div style={{ margin:'14px 18px 0', padding:'11px 14px', background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.25)', borderRadius:'var(--radius-sm)', display:'flex', gap:10, alignItems:'flex-start' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--crimson)" strokeWidth="2.2" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>
          <div style={{ fontSize:11.5, color:'var(--crimson)', lineHeight:1.5 }}>
            <strong>{totalDropped} plan{totalDropped!==1?'s':''} would extend past session end ({SESSION_END}).</strong> They will be dropped.
          </div>
        </div>
      )}

      <div style={{ padding:'18px 20px' }}>
        {preview.teacherResults.length === 0 ? (
          <div style={{ padding:'40px 20px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
            No teachers had plans on {format(parseISO(preview.holidayDate), 'EEE d MMM')}. Nothing to cascade.
          </div>
        ) : preview.teacherResults.map((tr, i) => (
          <div key={i} style={{ marginBottom:14, background:'var(--gray-50)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'12px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
              <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--green)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700 }}>
                {tr.teacherName.split(' ').map(s => s[0]).slice(0,2).join('')}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{tr.teacherName}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>{tr.plansOnHoliday.length} plan{tr.plansOnHoliday.length!==1?'s':''} on holiday → {tr.resolved.length} moved, {tr.dropped.length} dropped</div>
              </div>
              <Chip kind={tr.dropped.length > 0 ? 'crimson' : 'green'}>{tr.resolved.length}/{tr.plansOnHoliday.length}</Chip>
            </div>
            {tr.resolved.length > 0 && (
              <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.6, paddingLeft:40 }}>
                {tr.resolved.slice(0, 3).map((r, j) => (
                  <div key={j} style={{ display:'flex', gap:8 }}>
                    <span style={{ fontFamily:'var(--font-mono)', color:'var(--text-muted)' }}>P{r.slot.period}</span>
                    <span>{r.plan.className}</span>
                    <span>·</span>
                    <span>{r.plan.subject}</span>
                    <span style={{ color:'var(--green)', marginLeft:'auto' }}>→ {format(parseISO(r.newDate), 'EEE d MMM')}</span>
                  </div>
                ))}
                {tr.resolved.length > 3 && <div style={{ fontStyle:'italic', color:'var(--gray-400)', marginTop:3 }}>+{tr.resolved.length - 3} more</div>}
              </div>
            )}
            {tr.dropped.length > 0 && (
              <div style={{ marginTop:6, paddingLeft:40, fontSize:11, color:'var(--crimson)' }}>
                Dropped: {tr.dropped.map(d => `P${d.plan.period} ${d.plan.subject}`).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding:'14px 20px', background:'var(--gray-50)', borderTop:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontSize:12, color:'var(--text-muted)' }}>Sundays auto-skipped · cascade settles within timetable bounds</div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel} disabled={committing} style={{ padding:'10px 16px', background:'white', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer' }}>Cancel</button>
          <button onClick={onCommit} disabled={committing || totalResolved === 0} style={{ padding:'12px 22px', background:'linear-gradient(135deg, var(--gold), var(--gold-dark))', color:'var(--green-dark)', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:700, cursor:committing?'wait':'pointer', display:'flex', alignItems:'center', gap:8, boxShadow:'0 3px 12px rgba(201,162,39,0.3)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            {committing ? 'Inserting…' : 'Insert holiday'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label, color }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, color, lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:9, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:3, fontWeight:600 }}>{label}</div>
    </div>
  )
}

function EmptyState({ title, desc, icon }) {
  return (
    <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'48px 24px', textAlign:'center' }}>
      <div style={{ width:52, height:52, borderRadius:'50%', background:'var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', color:'var(--text-muted)' }}>{icon}</div>
      <p style={{ fontSize:14, fontWeight:500, color:'var(--text)', marginBottom:6 }}>{title}</p>
      <p style={{ fontSize:12, color:'var(--text-muted)' }}>{desc}</p>
    </div>
  )
}
