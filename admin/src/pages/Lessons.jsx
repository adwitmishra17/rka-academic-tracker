import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, query, where, orderBy, doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { format, parseISO, endOfMonth, getDay } from 'date-fns'

// CLASSES loaded via useClasses({ includeAll: true })
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8]

export default function Lessons() {
  const { classNames: CLASSES } = useClasses({ includeAll: true })
  const { effectiveBranches } = useAuth()
  // Shared state
  const [view, setView] = useState('list') // 'list' | 'heatmap'
  const [teachers, setTeachers] = useState([])
  const [editLesson, setEditLesson] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)

  // List view state
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterClass, setFilterClass] = useState('All')
  const [filterTeacher, setFilterTeacher] = useState('')
  const [availableMonths, setAvailableMonths] = useState([])
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [collapsedDates, setCollapsedDates] = useState({})

  // Heatmap view state
  const [hmDate, setHmDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [hmShowOnlyMissing, setHmShowOnlyMissing] = useState(false)
  const [hmTimetable, setHmTimetable] = useState([])
  const [hmDayLessons, setHmDayLessons] = useState([])
  const [hmArrangements, setHmArrangements] = useState([])
  const [hmLoading, setHmLoading] = useState(false)
  const [hmDetail, setHmDetail] = useState(null)

  // Load teachers once (filtered by branch)
  useEffect(() => {
    const q = query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))
    getDocs(q).then(s => setTeachers(s.docs.map(d => ({ id:d.id, ...d.data() }))))
  }, [effectiveBranches])

  // Discover available months (those with at least one lesson doc)
  useEffect(() => {
    if (view !== 'list') return
    async function loadMonths() {
      try {
        const q = query(collection(db, 'lessons'), ...branchConstraints('branchCode', effectiveBranches))
        const snap = await getDocs(q)
        const monthSet = new Set()
        snap.docs.forEach(d => {
          const date = d.data().date
          if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) monthSet.add(date.slice(0, 7))
        })
        monthSet.add(format(new Date(), 'yyyy-MM'))
        const sorted = [...monthSet].sort().reverse()
        setAvailableMonths(sorted.map(k => ({
          key: k,
          label: format(parseISO(k + '-01'), 'MMM yyyy'),
        })))
      } catch(e) { console.error('Months load error:', e) }
    }
    loadMonths()
  }, [view, effectiveBranches])

  // Load lessons for the selected month
  useEffect(() => {
    if (view !== 'list') return
    async function load() {
      setLoading(true)
      try {
        const monthStart = `${selectedMonth}-01`
        const monthEnd = format(endOfMonth(parseISO(monthStart)), 'yyyy-MM-dd')
        let data = []
        try {
          const snap = await getDocs(query(
            collection(db, 'lessons'),
            where('date', '>=', monthStart),
            where('date', '<=', monthEnd),
            ...branchConstraints('branchCode', effectiveBranches),
            orderBy('date', 'desc'),
          ))
          data = snap.docs.map(d => ({ id:d.id, ...d.data() }))
        } catch(e) {
          // Fallback: fetch all and filter client-side
          const snap = await getDocs(query(collection(db, 'lessons'), ...branchConstraints('branchCode', effectiveBranches)))
          data = snap.docs.map(d => ({ id:d.id, ...d.data() }))
            .filter(l => (l.date || '') >= monthStart && (l.date || '') <= monthEnd)
            .sort((a,b) => (b.date || '').localeCompare(a.date || ''))
        }
        if (filterClass !== 'All') data = data.filter(l => l.className === filterClass)
        if (filterTeacher) data = data.filter(l => l.teacherId === filterTeacher)
        setLessons(data)
      } catch(e) { console.error('Lessons load error:', e); setLessons([]) }
      setLoading(false)
    }
    load()
  }, [view, selectedMonth, filterClass, filterTeacher, effectiveBranches])

  // Load heatmap data for selected day
  useEffect(() => {
    if (view !== 'heatmap') return
    async function loadHm() {
      setHmLoading(true)
      try {
        let lessonsForDay = []
        try {
          const snap = await getDocs(query(
            collection(db, 'lessons'),
            where('date', '==', hmDate),
            ...branchConstraints('branchCode', effectiveBranches),
          ))
          lessonsForDay = snap.docs.map(d => ({ id:d.id, ...d.data() }))
        } catch(e) {
          const all = await getDocs(query(collection(db, 'lessons'), ...branchConstraints('branchCode', effectiveBranches)))
          lessonsForDay = all.docs.map(d => ({ id:d.id, ...d.data() })).filter(l => l.date === hmDate)
        }
        let arrangements = []
        try {
          const arrSnap = await getDocs(query(
            collection(db, 'arrangements'),
            where('date', '==', hmDate),
            ...branchConstraints('branchCode', effectiveBranches),
          ))
          arrangements = arrSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        } catch(e) { /* arrangements may not exist */ }
        const ttSnap = await getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches)))
        setHmTimetable(ttSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        setHmDayLessons(lessonsForDay)
        setHmArrangements(arrangements)
      } catch(e) { console.error('Heatmap load error:', e) }
      setHmLoading(false)
    }
    loadHm()
  }, [view, hmDate, effectiveBranches])

  function openEdit(l) {
    setEditLesson(l)
    setEditForm({ date: l.date||'', notes: l.notes||'', topicNames: l.topicNames||'', period: String(l.period||1), actualPeriods: String(l.actualPeriods||1) })
  }

  async function handleEditSave() {
    if (!editLesson) return
    setEditSaving(true)
    try {
      await updateDoc(doc(db, 'lessons', editLesson.id), {
        date: editForm.date,
        notes: editForm.notes,
        topicNames: editForm.topicNames,
        period: Number(editForm.period),
        actualPeriods: Number(editForm.actualPeriods),
        adminEdited: true,
        adminEditedAt: Timestamp.now(),
      })
      setLessons(prev => prev.map(l => l.id === editLesson.id ? { ...l, ...editForm, period:Number(editForm.period), actualPeriods:Number(editForm.actualPeriods), adminEdited:true } : l))
      setEditLesson(null)
    } catch(e) { alert('Save failed: ' + e.message) }
    setEditSaving(false)
  }

  async function handleDeleteLesson(id) {
    if (!confirm('Delete this lesson record?')) return
    await deleteDoc(doc(db, 'lessons', id))
    setLessons(prev => prev.filter(l => l.id !== id))
  }

  // Group lessons by date
  const byDate = lessons.reduce((acc, l) => {
    const d = l.date || 'Unknown'
    if (!acc[d]) acc[d] = []
    acc[d].push(l)
    return acc
  }, {})
  const sortedDates = Object.keys(byDate).sort().reverse()

  function toggleDate(date) { setCollapsedDates(prev => ({ ...prev, [date]: !prev[date] })) }
  function expandAll() { setCollapsedDates({}) }
  function collapseAll() {
    const all = {}
    sortedDates.forEach((d, i) => { if (i > 0) all[d] = true })
    setCollapsedDates(all)
  }

  // Auto-collapse on month change: most recent expanded, rest collapsed
  useEffect(() => {
    if (sortedDates.length === 0) return
    const init = {}
    sortedDates.forEach((d, i) => { if (i > 0) init[d] = true })
    setCollapsedDates(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth])

  const activityByTeacher = teachers.map(t => {
    const tLessons = lessons.filter(l => l.teacherId === t.id)
    const lastLesson = tLessons[0]
    const daysAgo = lastLesson ? Math.floor((new Date() - new Date(lastLesson.date)) / 86400000) : 999
    return { ...t, count: tLessons.length, daysAgo }
  }).sort((a,b) => a.daysAgo - b.daysAgo)

  // ============ HEATMAP COMPUTATION ============
  const heatmap = useMemo(() => {
    if (view !== 'heatmap') return null
    const dayName = DAYS_OF_WEEK[getDay(parseISO(hmDate))]
    const dayLower = dayName.toLowerCase()
    const todaySlots = hmTimetable.filter(s => (s.day || '').toLowerCase() === dayLower)

    const teacherIdsWithSlots = new Set(todaySlots.map(s => s.teacherId).filter(Boolean))
    const allRelevantTeachers = teachers.filter(t => teacherIdsWithSlots.has(t.id))

    // Build slot map: teacherId -> period -> slot
    const slotMap = {}
    todaySlots.forEach(s => {
      if (!s.teacherId || !s.period) return
      if (!slotMap[s.teacherId]) slotMap[s.teacherId] = {}
      slotMap[s.teacherId][s.period] = s
    })

    // Apply arrangements
    hmArrangements.forEach(arr => {
      if (!arr.coveringTeacherId || !arr.absentTeacherId || !arr.period) return
      const original = slotMap[arr.absentTeacherId]?.[arr.period]
      if (!original) return
      slotMap[arr.absentTeacherId][arr.period] = { ...original, _absent: true }
      if (!slotMap[arr.coveringTeacherId]) slotMap[arr.coveringTeacherId] = {}
      slotMap[arr.coveringTeacherId][arr.period] = { ...original, _covering: true, _coveringFor: arr.absentTeacherName }
    })

    // Compute status for each (teacher, period)
    function computeStatus(teacherId, period) {
      const slot = slotMap[teacherId]?.[period]
      if (!slot) return { status: 'free', slot: null, lesson: null }
      if (slot._absent) return { status: 'absent', slot, lesson: null }

      const slotClassNames = Array.isArray(slot.classNames) && slot.classNames.length
        ? slot.classNames.map(c => (c || '').trim())
        : (slot.className || '').split('+').map(c => c.trim()).filter(Boolean)

      const matchingLesson = hmDayLessons.find(l => {
        if (l.teacherId !== teacherId) return false
        if ((l.subject || '').toLowerCase().trim() !== (slot.subject || '').toLowerCase().trim()) return false
        const lessonClass = (l.className || '').trim()
        return slotClassNames.some(c => c === lessonClass)
      })
      if (!matchingLesson) return { status: 'missing', slot, lesson: null }

      // Late detection: createdAt after 6 PM same day, OR on a later day
      const createdAt = matchingLesson.createdAt?.toDate?.()
      if (createdAt) {
        const sameDayDate = format(createdAt, 'yyyy-MM-dd')
        if (sameDayDate === hmDate && createdAt.getHours() >= 18) return { status: 'late', slot, lesson: matchingLesson }
        if (sameDayDate > hmDate) return { status: 'late', slot, lesson: matchingLesson }
      }
      return { status: 'logged', slot, lesson: matchingLesson }
    }

    const rows = allRelevantTeachers.map(t => {
      const cells = PERIODS.map(p => ({ period: p, ...computeStatus(t.id, p) }))
      const scheduledCount = cells.filter(c => c.status !== 'free' && c.status !== 'absent').length
      const loggedCount = cells.filter(c => c.status === 'logged' || c.status === 'late').length
      const missingCount = cells.filter(c => c.status === 'missing').length
      const lateCount = cells.filter(c => c.status === 'late').length
      return { teacher: t, cells, scheduledCount, loggedCount, missingCount, lateCount }
    }).sort((a, b) => {
      if (a.missingCount !== b.missingCount) return b.missingCount - a.missingCount
      return a.teacher.fullName.localeCompare(b.teacher.fullName)
    })

    let totalScheduled = 0, totalLogged = 0, totalLate = 0
    const periodMissing = { 1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0 }
    rows.forEach(r => {
      r.cells.forEach(c => {
        if (c.status === 'free' || c.status === 'absent') return
        totalScheduled++
        if (c.status === 'logged') totalLogged++
        if (c.status === 'late') { totalLogged++; totalLate++ }
        if (c.status === 'missing') periodMissing[c.period]++
      })
    })
    const compliance = totalScheduled > 0 ? Math.round((totalLogged / totalScheduled) * 100) : 0
    let mostMissedPeriod = null, mostMissedCount = 0
    Object.keys(periodMissing).forEach(p => {
      if (periodMissing[p] > mostMissedCount) { mostMissedCount = periodMissing[p]; mostMissedPeriod = p }
    })

    return { dayName, rows, totalScheduled, totalLogged, totalLate, compliance, mostMissedPeriod, mostMissedCount }
  }, [view, hmDate, hmTimetable, hmDayLessons, hmArrangements, teachers])

  const visibleRows = heatmap
    ? (hmShowOnlyMissing ? heatmap.rows.filter(r => r.missingCount > 0) : heatmap.rows)
    : []

  return (
    <div style={{ padding:'32px 36px', maxWidth: view === 'heatmap' ? 1400 : 1100 }}>
      <div className="fade-in" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Lesson Log</h1>
        <p style={{ fontSize:14, color:'var(--text-muted)' }}>{view === 'list' ? 'Every lesson logged by teachers, filterable by class and teacher' : 'Daily compliance heatmap — who logged lessons for each scheduled period'}</p>
        <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {/* View tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:24, borderBottom:'1px solid var(--gray-200)' }}>
        <button onClick={() => setView('list')} style={{ padding:'10px 20px', background:'none', border:'none', borderBottom: view === 'list' ? '2px solid var(--green)' : '2px solid transparent', color: view === 'list' ? 'var(--green-dark)' : 'var(--text-muted)', fontSize:13, fontWeight: view === 'list' ? 600 : 500, cursor:'pointer', fontFamily:'var(--font-body)', marginBottom:-1, display:'flex', alignItems:'center', gap:7 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          List view
        </button>
        <button onClick={() => setView('heatmap')} style={{ padding:'10px 20px', background:'none', border:'none', borderBottom: view === 'heatmap' ? '2px solid var(--green)' : '2px solid transparent', color: view === 'heatmap' ? 'var(--green-dark)' : 'var(--text-muted)', fontSize:13, fontWeight: view === 'heatmap' ? 600 : 500, cursor:'pointer', fontFamily:'var(--font-body)', marginBottom:-1, display:'flex', alignItems:'center', gap:7 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Heatmap
        </button>
      </div>

      {view === 'list' ? renderListView() : renderHeatmapView()}

      {/* Edit modal */}
      {editLesson && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
          <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:460, boxShadow:'var(--shadow-lg)' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <h2 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--green-dark)' }}>Edit Lesson</h2>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{editLesson.teacherName} · {editLesson.className} · {editLesson.subject}</div>
              </div>
              <button onClick={() => setEditLesson(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22 }}>×</button>
            </div>
            <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Date</label>
                <input type="date" value={editForm.date} onChange={e => setEditForm(p=>({...p,date:e.target.value}))} style={{ width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }} />
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Topics Covered</label>
                <textarea value={editForm.topicNames} onChange={e => setEditForm(p=>({...p,topicNames:e.target.value}))} rows={3} style={{ width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none', resize:'vertical' }} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Period Number</label>
                  <input type="number" min="1" max="10" value={editForm.period} onChange={e => setEditForm(p=>({...p,period:e.target.value}))} style={{ width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Periods Used</label>
                  <input type="number" min="1" max="5" value={editForm.actualPeriods} onChange={e => setEditForm(p=>({...p,actualPeriods:e.target.value}))} style={{ width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Notes</label>
                <textarea value={editForm.notes} onChange={e => setEditForm(p=>({...p,notes:e.target.value}))} rows={2} style={{ width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none', resize:'vertical' }} />
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={handleEditSave} disabled={editSaving} style={{ flex:1, padding:'11px', background: editSaving?'var(--gray-200)':'var(--green)', color: editSaving?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: editSaving?'not-allowed':'pointer' }}>
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
                <button onClick={() => setEditLesson(null)} style={{ padding:'11px 16px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, cursor:'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap detail panel */}
      {hmDetail && (
        <div onClick={() => setHmDetail(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', zIndex:200, display:'flex', alignItems:'flex-start', justifyContent:'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width:'min(420px, 90vw)', height:'100%', background:'var(--white)', boxShadow:'var(--shadow-lg)', overflow:'auto', padding:'24px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
              <div>
                <h3 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--green-dark)' }}>Period {hmDetail.period} · {hmDetail.teacher.fullName}</h3>
                <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{format(parseISO(hmDate), 'EEEE, d MMMM yyyy')}</p>
              </div>
              <button onClick={() => setHmDetail(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22 }}>×</button>
            </div>

            {hmDetail.status === 'logged' && (
              <div style={{ background:'var(--green-light)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-md)', padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:11, color:'var(--green)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>✓ Logged on time</div>
                <div style={{ fontSize:13, color:'var(--green-dark)', fontWeight:500 }}>{hmDetail.slot.className} · {hmDetail.slot.subject}</div>
              </div>
            )}
            {hmDetail.status === 'late' && (
              <div style={{ background:'var(--gold-light)', border:'1px solid rgba(201,162,39,0.3)', borderRadius:'var(--radius-md)', padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:11, color:'var(--gold-dark)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>⏱ Logged after 6 PM</div>
                <div style={{ fontSize:13, color:'var(--gold-dark)', fontWeight:500 }}>{hmDetail.slot.className} · {hmDetail.slot.subject}</div>
                {hmDetail.lesson?.createdAt?.toDate && (
                  <div style={{ fontSize:11, color:'var(--gold-dark)', marginTop:4 }}>Logged at {format(hmDetail.lesson.createdAt.toDate(), 'h:mm a, d MMM')}</div>
                )}
              </div>
            )}
            {hmDetail.status === 'missing' && (
              <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-md)', padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:11, color:'var(--crimson)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>✕ No log found</div>
                <div style={{ fontSize:13, color:'var(--crimson)', fontWeight:500 }}>{hmDetail.slot.className} · {hmDetail.slot.subject}</div>
                <div style={{ fontSize:12, color:'var(--crimson)', marginTop:6, opacity:0.85 }}>The teacher has a scheduled period for this slot but no matching lesson record exists.</div>
              </div>
            )}

            {hmDetail.lesson && (
              <>
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>Topics</div>
                  <div style={{ fontSize:13, color:'var(--text)' }}>{hmDetail.lesson.topicNames || '—'}</div>
                </div>
                {hmDetail.lesson.notes && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:5 }}>Notes</div>
                    <div style={{ fontSize:13, color:'var(--text)', fontStyle:'italic' }}>"{hmDetail.lesson.notes}"</div>
                  </div>
                )}
                <button onClick={() => { openEdit(hmDetail.lesson); setHmDetail(null) }} style={{ marginTop:8, padding:'9px 16px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500, cursor:'pointer' }}>Edit lesson</button>
              </>
            )}

            {hmDetail.slot?._covering && (
              <div style={{ marginTop:14, padding:'10px 14px', background:'var(--gold-light)', borderRadius:'var(--radius-sm)', fontSize:11, color:'var(--gold-dark)' }}>
                ℹ {hmDetail.teacher.fullName} is covering for {hmDetail.slot._coveringFor || 'an absent teacher'} for this period.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // ===================== LIST VIEW =====================
  function renderListView() {
    return (
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:24, alignItems:'start' }}>
        <div>
          {/* Month chips */}
          {availableMonths.length > 0 && (
            <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', overflowX:'auto', paddingBottom:4 }}>
              {availableMonths.map(m => (
                <button
                  key={m.key}
                  onClick={() => setSelectedMonth(m.key)}
                  style={{
                    padding:'7px 14px',
                    border: selectedMonth === m.key ? '1px solid var(--green)' : '1px solid var(--gray-200)',
                    background: selectedMonth === m.key ? 'var(--green)' : 'var(--white)',
                    color: selectedMonth === m.key ? 'white' : 'var(--text)',
                    borderRadius:20,
                    fontSize:12,
                    fontWeight: selectedMonth === m.key ? 600 : 500,
                    cursor:'pointer',
                    fontFamily:'var(--font-body)',
                    whiteSpace:'nowrap',
                    transition:'all 0.15s',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* Filters */}
          <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
            <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
              {CLASSES.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
              <option value="">All teachers</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
            <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:12, color:'var(--text-muted)' }}>{lessons.length} lessons</span>
              {sortedDates.length > 1 && (
                <>
                  <button onClick={expandAll} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', padding:'4px 8px', fontWeight:500 }}>Expand all</button>
                  <button onClick={collapseAll} style={{ fontSize:11, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer', padding:'4px 8px', fontWeight:500 }}>Collapse all</button>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
          ) : lessons.length === 0 ? (
            <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
              <p style={{ color:'var(--text-muted)', fontSize:14 }}>No lessons for {availableMonths.find(m => m.key === selectedMonth)?.label || selectedMonth}.</p>
              <p style={{ color:'var(--text-muted)', fontSize:13, marginTop:4 }}>Pick another month or wait for teachers to log lessons.</p>
            </div>
          ) : sortedDates.map(date => {
            const dateLessons = byDate[date]
            const collapsed = !!collapsedDates[date]
            const dateObj = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? parseISO(date) : null
            const dateLabel = dateObj ? format(dateObj, 'EEEE, d MMMM') : date
            return (
              <div key={date} style={{ marginBottom:14 }}>
                <button onClick={() => toggleDate(date)} style={{ width:'100%', padding:'11px 14px', background: collapsed ? 'var(--white)' : 'var(--green-light)', border: '1px solid ' + (collapsed ? 'var(--gray-200)' : 'var(--green-muted)'), borderRadius:'var(--radius-md)', cursor:'pointer', display:'flex', alignItems:'center', gap:10, fontFamily:'var(--font-body)', transition:'all 0.15s' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={collapsed ? 'var(--text-muted)' : 'var(--green)'} strokeWidth="2.5" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition:'transform 0.15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                  <span style={{ fontSize:13, fontWeight:600, color: collapsed ? 'var(--text)' : 'var(--green-dark)' }}>{dateLabel}</span>
                  <div style={{ flex:1 }} />
                  <span style={{ fontSize:11, padding:'2px 10px', borderRadius:12, background: collapsed ? 'var(--gray-100)' : 'var(--green)', color: collapsed ? 'var(--text-muted)' : 'white', fontWeight:600 }}>{dateLessons.length} lesson{dateLessons.length>1?'s':''}</span>
                </button>
                {!collapsed && (
                  <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:8, paddingLeft:12 }}>
                    {dateLessons.map(l => (
                      <div key={l.id} style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 18px', display:'flex', gap:14, alignItems:'flex-start' }}>
                        <div style={{ width:36, height:36, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'var(--green)' }}>{(l.teacherName||'?')[0]}</span>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:4 }}>
                            <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{l.teacherName || 'Teacher'}</span>
                            <span style={{ fontSize:11, background:'var(--green-light)', color:'var(--green)', padding:'2px 8px', borderRadius:10, fontWeight:500 }}>{l.className}</span>
                            <span style={{ fontSize:11, background:'var(--gold-light)', color:'var(--gold-dark)', padding:'2px 8px', borderRadius:10 }}>{l.subject}</span>
                            <span style={{ fontSize:11, color:'var(--text-muted)' }}>Period {l.period || '—'}</span>
                          </div>
                          <div style={{ fontSize:13, color:'var(--text)', marginBottom: l.notes ? 6 : 0 }}>{l.topicNames || 'Topics not specified'}</div>
                          {l.notes && <div style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>"{l.notes}"</div>}
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:5, flexShrink:0 }}>
                          <div style={{ fontWeight:500, color:'var(--green)', fontSize:11 }}>{l.actualPeriods || 1} period{(l.actualPeriods||1)>1?'s':''}</div>
                          <div style={{ display:'flex', gap:8 }}>
                            {l.adminEdited && <span style={{ fontSize:10, color:'var(--gold-dark)', fontWeight:500 }}>✎ Edited</span>}
                            <button onClick={() => openEdit(l)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500, padding:0 }}>Edit</button>
                            <button onClick={() => handleDeleteLesson(l.id)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer', padding:0 }}>Delete</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Teacher activity sidebar */}
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden', position:'sticky', top:24 }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--gray-100)', background:'var(--green-light)' }}>
            <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--green-dark)' }}>Teacher activity</h3>
            <p style={{ fontSize:11, color:'var(--green-mid)', marginTop:2 }}>Last lesson logged</p>
          </div>
          <div style={{ padding:'8px 0' }}>
            {activityByTeacher.length === 0 ? (
              <div style={{ padding:'24px 20px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No teacher data yet.</div>
            ) : activityByTeacher.map(t => (
              <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 20px', borderBottom:'1px solid var(--gray-50)' }}>
                <div style={{ width:32, height:32, borderRadius:'50%', background: t.daysAgo === 0 ? 'var(--green-light)' : t.daysAgo <= 3 ? 'var(--gold-light)' : 'var(--crimson-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <span style={{ fontSize:12, fontWeight:600, color: t.daysAgo === 0 ? 'var(--green)' : t.daysAgo <= 3 ? 'var(--gold-dark)' : 'var(--crimson)' }}>{(t.fullName||'?')[0]}</span>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.fullName}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>{t.count} lessons total</div>
                </div>
                <div style={{ fontSize:11, fontWeight:500, textAlign:'right', flexShrink:0, color: t.daysAgo === 0 ? 'var(--green)' : t.daysAgo <= 3 ? 'var(--gold-dark)' : 'var(--crimson)' }}>
                  {t.daysAgo === 999 ? 'No logs' : t.daysAgo === 0 ? 'Today' : `${t.daysAgo}d ago`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ===================== HEATMAP VIEW =====================
  function renderHeatmapView() {
    const today = format(new Date(), 'yyyy-MM-dd')
    return (
      <div>
        {/* Filters */}
        <div style={{ display:'flex', gap:12, marginBottom:18, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)' }}>Date</label>
            <input type="date" value={hmDate} onChange={e => setHmDate(e.target.value)} max={today} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)' }} />
            {hmDate !== today && (
              <button onClick={() => setHmDate(today)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Jump to today</button>
            )}
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text)', cursor:'pointer', padding:'8px 12px', background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)' }}>
            <input type="checkbox" checked={hmShowOnlyMissing} onChange={e => setHmShowOnlyMissing(e.target.checked)} />
            Show only teachers with missing logs
          </label>
        </div>

        {hmLoading ? (
          <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
        ) : !heatmap || heatmap.rows.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
            <p style={{ color:'var(--text-muted)', fontSize:14 }}>No timetable slots scheduled for {format(parseISO(hmDate), 'EEEE, d MMM yyyy')}.</p>
            <p style={{ color:'var(--text-muted)', fontSize:13, marginTop:4 }}>Add periods in the Timetable to see compliance data here.</p>
          </div>
        ) : (
          <>
            {/* Stats banner */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:18 }}>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 18px', borderTop:'3px solid var(--green)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', lineHeight:1 }}>{heatmap.compliance}%</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>Compliance · {heatmap.totalLogged} of {heatmap.totalScheduled} periods logged</div>
              </div>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 18px', borderTop:'3px solid var(--gold)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--gold-dark)', lineHeight:1 }}>{heatmap.totalLate}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>Logged after 6 PM (backfilled)</div>
              </div>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 18px', borderTop:'3px solid var(--crimson)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--crimson)', lineHeight:1 }}>{heatmap.mostMissedPeriod ? `P${heatmap.mostMissedPeriod}` : '—'}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>Most missed period{heatmap.mostMissedCount > 0 ? ` · ${heatmap.mostMissedCount} missed` : ''}</div>
              </div>
            </div>

            {/* Legend */}
            <div style={{ display:'flex', gap:18, marginBottom:14, fontSize:11, color:'var(--text-muted)', flexWrap:'wrap' }}>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--green)', borderRadius:3, display:'inline-block' }} /> Logged on time</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--gold)', borderRadius:3, display:'inline-block' }} /> Logged after 6 PM</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--crimson-light)', border:'1px dashed var(--crimson)', borderRadius:3, display:'inline-block' }} /> Missing</span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:12, height:12, background:'var(--gray-100)', borderRadius:3, display:'inline-block' }} /> No period scheduled</span>
            </div>

            {/* Heatmap grid */}
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', overflow:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:'4px 4px', padding:'12px' }}>
                <thead>
                  <tr>
                    <th style={{ padding:'6px 10px', textAlign:'left', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', minWidth:160 }}>Teacher</th>
                    {PERIODS.map(p => (
                      <th key={p} style={{ padding:'6px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', textAlign:'center', minWidth:48 }}>P{p}</th>
                    ))}
                    <th style={{ padding:'6px 10px', fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', textAlign:'right' }}>Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(row => (
                    <tr key={row.teacher.id}>
                      <td style={{ padding:'6px 10px', fontSize:12, color:'var(--text)', fontWeight:500 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:24, height:24, borderRadius:'50%', background: row.missingCount > 0 ? 'var(--crimson-light)' : 'var(--green-light)', color: row.missingCount > 0 ? 'var(--crimson)' : 'var(--green)', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{(row.teacher.fullName||'?')[0]}</div>
                          <span>{row.teacher.fullName}</span>
                        </div>
                      </td>
                      {row.cells.map(cell => {
                        let bg = 'var(--gray-100)', color = 'var(--gray-400)', label = '', border = 'none', cursor = 'default'
                        if (cell.status === 'logged') { bg = 'var(--green)'; color = 'white'; label = '✓'; cursor = 'pointer' }
                        else if (cell.status === 'late') { bg = 'var(--gold)'; color = 'white'; label = '⏱'; cursor = 'pointer' }
                        else if (cell.status === 'missing') { bg = 'var(--crimson-light)'; color = 'var(--crimson)'; label = '✕'; border = '1px dashed var(--crimson)'; cursor = 'pointer' }
                        else if (cell.status === 'absent') { bg = 'var(--gray-100)'; color = 'var(--text-muted)'; label = 'A' }
                        return (
                          <td key={cell.period} style={{ padding:0, textAlign:'center' }}>
                            <button
                              onClick={() => cell.status !== 'free' && cell.status !== 'absent' && setHmDetail({ teacher: row.teacher, period: cell.period, slot: cell.slot, lesson: cell.lesson, status: cell.status })}
                              disabled={cell.status === 'free' || cell.status === 'absent'}
                              title={cell.slot ? `${cell.slot.className || ''} · ${cell.slot.subject || ''}` : 'No period'}
                              style={{ width:'100%', height:32, background: bg, color, border, borderRadius:5, fontSize:12, fontWeight:700, cursor, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-body)' }}
                            >{label}</button>
                          </td>
                        )
                      })}
                      <td style={{ padding:'6px 10px', textAlign:'right', fontSize:11, color: row.missingCount > 0 ? 'var(--crimson)' : 'var(--green-mid)', fontWeight:600 }}>
                        {row.loggedCount}/{row.scheduledCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hmShowOnlyMissing && visibleRows.length === 0 && (
              <div style={{ textAlign:'center', padding:32, background:'var(--green-light)', borderRadius:'var(--radius-md)', marginTop:14 }}>
                <p style={{ color:'var(--green-dark)', fontSize:13, fontWeight:500 }}>✓ No missing logs! All teachers are on top of their entries.</p>
              </div>
            )}
          </>
        )}
      </div>
    )
  }
}
