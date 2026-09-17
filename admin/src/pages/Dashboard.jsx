import React, { useState, useEffect, useMemo } from 'react'
import { collection, doc, getDoc, getDocs, query, where, limit } from 'firebase/firestore'
import { getApp } from 'firebase/app'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '../App'
import { fetchStudents } from '../lib/api'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { todayIST } from '../lib/attendanceDates'
import { format, subDays, startOfWeek } from 'date-fns'
import { useNavigate, Link } from 'react-router-dom'

// ============================================================================
// DASHBOARD — Direction A "Command centre" (Sep 2026)
//
//   1. Page head: date · greeting · quick actions
//   2. KPI strip: lessons logged today · attendance · teachers absent ·
//      plans due · not-logged-in-3-days
//   3. Today's coverage grid (teacher × period): logged / scheduled /
//      not logged (past) / arrangement / uncovered
//   4. Right rail: "Needs attention" queue → the page that fixes it,
//      then test absentees. Below the grid: latest lessons.
//
// Data loading is unchanged from the previous dashboard (Firestore +
// /api/students) plus one query: today's studentAttendance.
// ============================================================================

// School time is IST regardless of where the admin is sitting.
const IST_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long' })
const istNow = () => {
  const parts = Object.fromEntries(IST_PARTS.formatToParts(new Date()).map(p => [p.type, p.value]))
  return { minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute), weekday: parts.weekday }
}
const initials = (n) => (n || '?').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const shortName = (n) => (n || '').split(' ').slice(0, 2).join(' ')
const CARD = { background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
const CARD_HEAD = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--gray-100)' }

function Kpi({ label, value, unit, sub, tone, bar, onClick }) {
  const color = tone === 'red' ? 'var(--crimson)' : tone === 'gold' ? 'var(--gold-dark)' : tone === 'green' ? 'var(--green)' : 'var(--text)'
  return (
    <div className="fade-in" onClick={onClick} style={{ ...CARD, padding: '16px 18px', gap: 10, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {value === undefined || value === null
          ? <span style={{ width: 48, height: 28, background: 'var(--gray-100)', borderRadius: 4, display: 'inline-block', animation: 'pulse 1.5s ease infinite' }} />
          : <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color }}>{value}</span>}
        {unit && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
      {bar !== undefined
        ? <div style={{ height: 5, background: 'var(--gray-100)', borderRadius: 99, overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, bar))}%`, height: '100%', background: color === 'var(--text)' ? 'var(--green)' : color, borderRadius: 99, transition: 'width 0.4s' }} /></div>
        : <div style={{ fontSize: 11.5, color: 'var(--text-muted)', minHeight: 14 }}>{sub}</div>}
    </div>
  )
}

function Attention({ tone, title, sub, to, action }) {
  const dot = { red: 'var(--crimson)', gold: 'var(--gold)', muted: 'var(--gray-400)', green: 'var(--green)' }[tone] || 'var(--gray-400)'
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--gray-50)', alignItems: 'flex-start' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
      </div>
      {to && <Link to={to} style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', textDecoration: 'none', whiteSpace: 'nowrap' }}>{action || 'Open'}</Link>}
    </div>
  )
}

const Legend = ({ items }) => (
  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-muted)', alignItems: 'center' }}>
    {items.map(([label, style]) => <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, display: 'inline-block', ...style }} />{label}</span>)}
  </div>
)

export default function Dashboard() {
  const navigate = useNavigate()
  const { classNames: ALL_CLASSES_NAMES } = useClasses()
  const [stats, setStats] = useState({})
  const [recentLessons, setRecentLessons] = useState([])
  const [alerts, setAlerts] = useState([])
  const [missedAlerts, setMissedAlerts] = useState([])
  const [inactiveTeachers, setInactiveTeachers] = useState([])
  const [missingPlanTeachers, setMissingPlanTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [timetable, setTimetable] = useState([])
  const [timetableTeachers, setTimetableTeachers] = useState([])
  const [schedule, setSchedule] = useState([])
  const [todayArrangements, setTodayArrangements] = useState([])
  const [attendance, setAttendance] = useState(null)
  const [hrms, setHrms] = useState(null)   // getHrmsDayAttendance result; null = still loading
  const [todayLessonList, setTodayLessonList] = useState([])
  const [lastDay, setLastDay] = useState(null)          // { date, dayName, logged } — last school day before today
  const [teacherQuery, setTeacherQuery] = useState('')
  const [focusId, setFocusId] = useState(null)
  const [weekView, setWeekView] = useState(false)

  const today = format(new Date(), 'EEEE, d MMMM yyyy')
  const todayName = istNow().weekday
  const { user, effectiveBranches, currentBranch, allowedBranches } = useAuth()
  const [adminProfile, setAdminProfile] = useState(null)
  useEffect(() => {
    if (!user?.email) return
    const emailKey = user.email.toLowerCase().trim()
    getDoc(doc(db, 'admins', emailKey))
      .then(s => { if (s.exists()) setAdminProfile(s.data()) })
      .catch(() => {})
  }, [user])

  // Live HRMS staff attendance for today — the same callable the Lesson Log
  // heatmap uses (region asia-south2). Absence = NO biometric punch
  // (attendance_daily row) on a day with real staff activity; degrades to
  // "unavailable" on any failure (functions down / no access).
  useEffect(() => {
    let cancelled = false
    setHrms(null)
    const date = format(new Date(), 'yyyy-MM-dd')
    httpsCallable(getFunctions(getApp(), 'asia-south2'), 'getHrmsDayAttendance')({ date })
      .then(res => { if (!cancelled) setHrms(res.data || { failed: true }) })
      .catch(err => { console.warn('HRMS attendance unavailable:', err?.message || err); if (!cancelled) setHrms({ failed: true }) })
    return () => { cancelled = true }
  }, [effectiveBranches])
  const adminName = (adminProfile?.fullName || '').split(' ')[0]
                 || (user?.displayName || '').split(' ')[0]
                 || (user?.email || '').split('@')[0]
                 || 'Admin'
  const greeting = (() => { const h = Math.floor(istNow().minutes / 60); return h<12?'Good morning':h<17?'Good afternoon':'Good evening' })()
  const threeDaysAgo = format(subDays(new Date(), 3), 'yyyy-MM-dd')

  useEffect(() => {
    async function load() {
      try {
        const empty = { docs: [] }
        const todayDate = format(new Date(), 'yyyy-MM-dd')
        // Per-branch periods doc. On All Branches (super admin), pick the
        // first allowed branch — schedule rendering needs a single template.
        const periodsBranch = currentBranch || allowedBranches[0] || 'MAIN'
        const [teachersSnap, lessonsSnap, testsSnap, marksSnap, studentsList, missedSnap, ttSnap, periodsDoc, arrSnap] = await Promise.all([
          getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'lessons'), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'tests'), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'testMarks'), where('isAbsent', '==', true), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          // Students come from SMS Supabase via /api/students (no Firestore).
          fetchStudents({ branchCodes: effectiveBranches }).catch(() => []),
          getDocs(query(collection(db, 'missedLessonAlerts'), where('isResolved', '==', false), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          getDoc(doc(db, 'settings', `periods_${periodsBranch}`)).catch(() => null),
          getDocs(query(collection(db, 'arrangements'), where('date', '==', todayDate), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
        ])

        const todayStr = format(new Date(), 'yyyy-MM-dd')
        // Sort lessons client-side (no orderBy needed, avoids index requirement)
        const sortedLessons = lessonsSnap.docs
          .map(d => ({ id:d.id, ...d.data() }))
          .sort((a,b) => (b.date||'').localeCompare(a.date||''))
          .slice(0, 20)
        const todayLessons = sortedLessons.filter(l => l.date === todayStr)
        const activeNamesLower = new Set(
          studentsList.filter(s => s.isActive).map(s => (s.fullName || '').trim().toLowerCase())
        )
        // Build set of valid test IDs to filter out orphaned absentees from deleted tests
        const validTestIds = new Set(testsSnap.docs.map(d => d.id))
        const validAbsentees = marksSnap.docs.map(d => d.data()).filter(m => {
          const n = (m.studentName||'').trim().toLowerCase()
          return n && activeNamesLower.has(n) && validTestIds.has(m.testId)
        })

        setStats({ teachers: teachersSnap.size, todayLessons: todayLessons.length, tests: testsSnap.size, absentees: validAbsentees.length })
        setRecentLessons(sortedLessons.slice(0,8))
        setTodayLessonList(lessonsSnap.docs.map(d => d.data()).filter(l => l.date === todayStr))
        {
          // Last school day = walk back from yesterday, skipping Sundays and days with no timetable slots.
          const ttDays = new Set(ttSnap.docs.map(d => d.data().day))
          let d = subDays(new Date(), 1), tries = 0
          while (tries < 7 && (format(d, 'EEEE') === 'Sunday' || (ttDays.size && !ttDays.has(format(d, 'EEEE'))))) { d = subDays(d, 1); tries++ }
          const date = format(d, 'yyyy-MM-dd'), dayName = format(d, 'EEEE')
          setLastDay({ date, dayName, logged: lessonsSnap.docs.filter(x => x.data().date === date).length })
        }
        setAlerts(validAbsentees.slice(0,5))
        setMissedAlerts(missedSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        setTimetable(ttSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        setTodayArrangements(arrSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        // Today's student attendance (Firestore mirror) — present % of MARKED, never of roster.
        try {
          const attSnap = await getDocs(query(collection(db, 'studentAttendance'), where('date', '==', todayIST()), ...branchConstraints('branchCode', effectiveBranches)))
          const active = new Map(studentsList.filter(s => s.isActive).map(s => [s.id, s]))
          const classTotals = {}
          for (const s of active.values()) { const k = (s.className || '?') + '||' + (s.branchCode || '?'); classTotals[k] = (classTotals[k] || 0) + 1 }
          const markedByClass = {}
          let marked = 0, absent = 0
          attSnap.forEach(d => {
            const x = d.data(); if (!active.has(x.studentId)) return
            marked += 1; if (x.status === 'absent') absent += 1
            const k = (x.className || '?') + '||' + (x.branchCode || '?'); markedByClass[k] = (markedByClass[k] || 0) + 1
          })
          const unmarked = Object.keys(classTotals).filter(k => !markedByClass[k]).map(k => k.split('||')[0])
          setAttendance({ marked, present: marked - absent, absent, students: active.size, classes: Object.keys(classTotals).length, unmarked })
        } catch (e) { console.warn('attendance today:', e.code || e.message) }

        // Build schedule
        if (periodsDoc?.exists()) {
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
          setSchedule(Array.from({length:8},(_,i)=>({period:i+1,label:`P${i+1}`})))
        }

        const allTeachers = teachersSnap.docs.map(d => ({ id:d.id, ...d.data() })).filter(t => t.isActive !== false)
        setTimetableTeachers(allTeachers)

        // Use full lessons list (not the 20-item truncated sortedLessons) for accurate inactive teacher detection
        const allLessonsFull = lessonsSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        // Build a map: teacherId -> most recent lesson date
        const lastLessonByTeacher = {}
        allLessonsFull.forEach(l => {
          if (!l.teacherId || !l.date) return
          if (!lastLessonByTeacher[l.teacherId] || l.date > lastLessonByTeacher[l.teacherId]) {
            lastLessonByTeacher[l.teacherId] = l.date
          }
        })
        // Also build a fallback map by teacherName in case lessons were saved with uid instead of teacher doc id
        const lastLessonByName = {}
        allLessonsFull.forEach(l => {
          if (!l.teacherName || !l.date) return
          const key = l.teacherName.toLowerCase().trim()
          if (!lastLessonByName[key] || l.date > lastLessonByName[key]) {
            lastLessonByName[key] = l.date
          }
        })
        setInactiveTeachers(allTeachers.filter(t => {
          const byId = lastLessonByTeacher[t.id]
          const byName = lastLessonByName[(t.fullName||'').toLowerCase().trim()]
          const mostRecent = [byId, byName].filter(Boolean).sort().reverse()[0]
          return !mostRecent || mostRecent < threeDaysAgo
        }))

        const weekStart = format(startOfWeek(new Date(),{weekStartsOn:1}),'yyyy-MM-dd')
        // Consider a teacher as "having submitted" if they have plans for the current week OR any upcoming week
        // Teachers often plan ahead (Monday of next week, etc.) — shouldn't be flagged as missing
        let plansSnap = { docs: [] }
        try {
          plansSnap = await getDocs(query(collection(db,'lessonPlans'),where('weekStart','>=',weekStart),...branchConstraints('branchCode', effectiveBranches)))
        } catch(e) {
          // Single-field range query should not require index, but fall back if anything fails
          try {
            const recentPlans = await getDocs(query(collection(db,'lessonPlans'),...branchConstraints('branchCode', effectiveBranches),limit(500)))
            plansSnap = { docs: recentPlans.docs.filter(d => (d.data().weekStart || '') >= weekStart) }
          } catch(e2) { console.warn('Could not load lesson plans:', e2.code) }
        }
        const withPlans = new Set(plansSnap.docs.map(d => d.data().teacherId))
        // Only flag teachers who actually have timetable slots (have something to plan)
        const ttData = ttSnap.docs.map(d => d.data())
        const teachersWithSlots = new Set(ttData.map(s => s.teacherId).filter(Boolean))
        const missing = allTeachers.filter(t => teachersWithSlots.has(t.id) && !withPlans.has(t.id))
        setMissingPlanTeachers(missing)
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [effectiveBranches, currentBranch])

  // ---------------------------------------------------------------- coverage
  const minutesNow = () => istNow().minutes
  const [nowMin, setNowMin] = useState(minutesNow)
  useEffect(() => { const id = setInterval(() => setNowMin(minutesNow()), 30 * 1000); return () => clearInterval(id) }, [])
  const periodEnd = (s) => { const m = /–(\d{2}):(\d{2})$/.exec(s.label || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
  const periodStart = (s) => { const m = /^(\d{2}):(\d{2})–/.exec(s.label || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
  const isNow = (s) => { const a = periodStart(s), b = periodEnd(s); return a !== null && b !== null && nowMin >= a && nowMin < b }
  const minsLeft = (s) => { const b = periodEnd(s); return b === null ? null : b - nowMin }

  const coverage = useMemo(() => {
    const sched = schedule.length ? schedule : Array.from({ length: 8 }, (_, i) => ({ period: i + 1, label: '' }))
    const slotsToday = timetable.filter(s => s.day === todayName)
    const lessonKey = (tid, name, p) => `${tid || ''}|${(name || '').toLowerCase().trim()}|${Number(p)}`
    const logged = new Set()
    for (const l of todayLessonList) { logged.add(lessonKey(l.teacherId, '', l.period)); logged.add(lessonKey('', l.teacherName, l.period)) }
    const absentIds = new Set(todayArrangements.map(a => a.absentTeacherId).filter(Boolean))
    const arrFor = (tid, p) => todayArrangements.find(a => a.absentTeacherId === tid && Number(a.period) === Number(p))
    const rows = timetableTeachers
      .filter(t => slotsToday.some(s => s.teacherId === t.id))
      .map(t => {
        const cells = sched.map(s => {
          const slot = slotsToday.find(sl => sl.teacherId === t.id && Number(sl.period) === Number(s.period))
          if (!slot) return { kind: 'none' }
          const cls = (slot.classNames?.length ? slot.classNames.join('+') : slot.className || '').replace(/Class /g, '')
          const arr = arrFor(t.id, s.period)
          if (arr) return { kind: 'arranged', cls, who: arr.arrangementTeacherName, slot }
          if (absentIds.has(t.id)) return { kind: 'uncovered', cls, slot }
          const isLogged = logged.has(lessonKey(t.id, '', s.period)) || logged.has(lessonKey('', t.fullName, s.period))
          if (isLogged) return { kind: 'logged', cls, slot }
          const end = periodEnd(s)
          return { kind: end !== null && nowMin > end ? 'missed' : 'scheduled', cls, slot }
        })
        const score = cells.filter(c => c.kind === 'uncovered').length * 100 + cells.filter(c => c.kind === 'arranged').length * 10 + cells.filter(c => c.kind === 'missed').length
        return { t, cells, absent: absentIds.has(t.id), score }
      })
      .sort((a, b) => b.score - a.score || (a.t.fullName || '').localeCompare(b.t.fullName || ''))
    const totalSlots = slotsToday.length
    const uncovered = rows.reduce((n, r) => n + r.cells.filter(c => c.kind === 'uncovered').length, 0)
    const q = teacherQuery.trim().toLowerCase()
    const visible = q ? rows.filter(r => (r.t.fullName || '').toLowerCase().includes(q)) : rows
    return { sched, rows, visible, totalSlots, uncovered, absentTeachers: absentIds.size }
  }, [schedule, timetable, timetableTeachers, todayLessonList, todayArrangements, todayName, nowMin, teacherQuery])

  // HRMS absentees today — teachers who haven't punched in (no attendance_daily
  // row), joined via teachers.hrmsEmployeeId. Only trusted when the day shows
  // real staff activity (staffDayActive); on-leave + attendance-exempt aren't
  // "absent". Before 11 AM a missing punch is still ambiguous (may yet arrive).
  const hrmsAbsence = useMemo(() => {
    const todayYMD = format(new Date(), 'yyyy-MM-dd')
    const map = (hrms && !hrms.failed && hrms.date === todayYMD && hrms.staffDayActive) ? hrms.byEmployee : null
    const out = { available: !!map, loading: hrms === null, absent: 0, present: 0, leave: 0, tracked: 0, softMorning: new Date().getHours() < 11 }
    if (!map) return out
    for (const t of timetableTeachers) {
      if (!t.hrmsEmployeeId) continue
      const st = map[t.hrmsEmployeeId]
      if (!st) continue
      // Count only real attendance statuses toward the tracked denominator —
      // attendance-exempt / unknown staff are neither present nor absent.
      if (st.status === 'no_punch') { out.absent++; out.tracked++ }
      else if (st.status === 'leave') { out.leave++; out.tracked++ }
      else if (st.status === 'present') { out.present++; out.tracked++ }
    }
    return out
  }, [hrms, timetableTeachers])

  const lastDaySlots = lastDay ? timetable.filter(s => s.day === lastDay.dayName).length : 0
  const focusTeacher = focusId ? timetableTeachers.find(t => t.id === focusId) : null
  const focus = focusId ? (coverage.rows.find(r => r.t.id === focusId) || (focusTeacher ? { t: focusTeacher, cells: coverage.sched.map(() => ({ kind: 'none' })), absent: false, offToday: true } : null)) : null
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const weekFor = (tid) => DAYS.map(day => ({ day, cells: coverage.sched.map(s => { const sl = timetable.find(x => x.teacherId === tid && x.day === day && Number(x.period) === Number(s.period)); return sl ? { cls: (sl.classNames?.length ? sl.classNames.join('+') : sl.className || '').replace(/Class /g, ''), subject: sl.subject } : null }) }))
  const kindLabel = { logged: 'Logged', scheduled: 'Scheduled', missed: 'Not logged', arranged: 'Arrangement', uncovered: 'Uncovered', none: 'Free' }
  const kindTone = { logged: 'green', scheduled: 'muted', missed: 'gold', arranged: 'orange', uncovered: 'red', none: 'muted' }
  const pillStyle = (tone) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 600, ...( { green: { background: 'var(--green-light)', color: 'var(--green-dark)' }, gold: { background: 'var(--gold-light)', color: 'var(--gold-dark)' }, red: { background: 'var(--crimson-light)', color: 'var(--crimson)' }, orange: { background: '#E07B00', color: '#fff' }, muted: { background: 'var(--gray-50)', color: 'var(--text-muted)' } }[tone] ) })

  const isSunday = todayName === 'Sunday'
  const currentPeriod = !isSunday ? coverage.sched.find(isNow) : null
  const presentPct = attendance && attendance.marked > 0 ? Math.round((attendance.present / attendance.marked) * 1000) / 10 : null
  const plansTotal = missingPlanTeachers.length + (timetableTeachers.filter(t => timetable.some(s => s.teacherId === t.id)).length - missingPlanTeachers.length)

  const attention = []
  if (coverage.uncovered > 0) attention.push({ tone: 'red', title: `${coverage.uncovered} period${coverage.uncovered > 1 ? 's' : ''} uncovered today`, sub: coverage.rows.filter(r => r.cells.some(c => c.kind === 'uncovered')).map(r => `${shortName(r.t.fullName)} · P${r.cells.map((c, i) => c.kind === 'uncovered' ? coverage.sched[i].period : null).filter(Boolean).join(', P')}`).join(' · '), to: '/arrangement', action: 'Assign' })
  if (attendance && attendance.unmarked.length > 0 && !isSunday) attention.push({ tone: 'gold', title: `${attendance.unmarked.length} class${attendance.unmarked.length > 1 ? 'es' : ''} not marked for attendance yet`, sub: attendance.unmarked.slice(0, 8).join(', ') + (attendance.unmarked.length > 8 ? ` +${attendance.unmarked.length - 8} more` : ''), to: '/attendance', action: 'View' })
  if (missedAlerts.length > 0) attention.push({ tone: 'red', title: `${missedAlerts.length} lesson${missedAlerts.length > 1 ? 's' : ''} not logged today`, sub: missedAlerts.slice(0, 8).map(a => a.className).join(', '), to: '/lessons', action: 'Open' })
  if (inactiveTeachers.length > 0) attention.push({ tone: 'gold', title: `${inactiveTeachers.length} teacher${inactiveTeachers.length > 1 ? 's have' : ' has'} not logged a lesson in 3+ days`, sub: inactiveTeachers.map(t => shortName(t.fullName)).join(', '), to: '/lessons', action: 'Review' })
  if (missingPlanTeachers.length > 0) attention.push({ tone: 'gold', title: `${missingPlanTeachers.length} lesson plan${missingPlanTeachers.length > 1 ? 's' : ''} not submitted this week`, sub: missingPlanTeachers.map(t => shortName(t.fullName)).join(', '), to: '/lesson-plans', action: 'Remind' })
  if (stats.absentees > 0) attention.push({ tone: 'muted', title: `${stats.absentees} test absence${stats.absentees > 1 ? 's' : ''} recorded this session`, sub: alerts.slice(0, 3).map(a => `${a.studentName} · ${a.testName || 'Test'}`).join(' · '), to: '/absentees', action: 'View' })

  const cellStyle = (c) => {
    const base = { height: 30, borderRadius: 6, fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 4px', cursor: 'default' }
    switch (c.kind) {
      case 'logged': return { ...base, background: 'var(--green)', color: '#fff' }
      case 'scheduled': return { ...base, background: 'var(--green-light)', color: 'var(--green-dark)' }
      case 'missed': return { ...base, background: 'var(--gold-light)', color: 'var(--gold-dark)' }
      case 'arranged': return { ...base, background: '#E07B00', color: '#fff' }
      case 'uncovered': return { ...base, background: 'transparent', border: '1.5px dashed var(--crimson)', color: 'var(--crimson)' }
      default: return { ...base, background: 'var(--gray-50)' }
    }
  }
  const cellText = (c) => c.kind === 'arranged' ? `→ ${initials(c.who)}` : c.kind === 'uncovered' ? 'Uncovered' : c.kind === 'none' ? '' : c.cls
  const cellTitle = (c, s, t) => c.kind === 'none' ? '' : `${t.fullName} · P${s.period}${s.label ? ' (' + s.label + ')' : ''} · ${c.slot?.subject || ''} · ${c.slot?.className || c.cls}${c.kind === 'arranged' ? ` · covered by ${c.who}` : c.kind === 'uncovered' ? ' · teacher absent, nobody assigned' : c.kind === 'logged' ? ' · lesson logged' : c.kind === 'missed' ? ' · period over, no lesson logged' : ' · scheduled'}`

  const btn = (label, to, primary) => (
    <button key={label} onClick={() => navigate(to)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: primary ? '1px solid var(--text)' : '1px solid var(--gray-200)', background: primary ? 'var(--text)' : 'var(--white)', color: primary ? 'var(--white)' : 'var(--text)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1600 }}>
      {/* Page head */}
      <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>{today}{currentBranch ? ` · ${currentBranch === 'MAIN' ? 'Main campus' : 'City branch'}` : allowedBranches.length > 1 ? ' · Both branches' : ''}</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{greeting}, {adminName}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {btn('Mark arrangement', '/arrangement')}
          {btn('Open timetable', '/timetable')}
          {btn('Lesson log', '/lessons', true)}
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Kpi label={lastDay ? `Lessons logged ${lastDay.date === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'yesterday' : 'on ' + lastDay.dayName}` : 'Lessons logged yesterday'} value={loading || !lastDay ? undefined : lastDay.logged} unit={lastDaySlots ? `/ ${lastDaySlots}` : ''} sub={isSunday ? 'No school today' : <span>Today so far: <b style={{ fontWeight: 600, color: 'var(--text)' }}>{stats.todayLessons ?? 0}</b>{coverage.totalSlots ? ` of ${coverage.totalSlots}` : ''}</span>} tone={lastDay && lastDaySlots && lastDay.logged / lastDaySlots < 0.6 ? 'gold' : undefined} onClick={() => navigate('/lessons')} />
        <Kpi label="Student attendance today" value={loading ? undefined : (presentPct === null ? '—' : `${presentPct}%`)} sub={attendance ? (attendance.marked ? `${attendance.present} present of ${attendance.marked} marked` : 'Nothing marked yet') : ''} tone={presentPct !== null && presentPct < 85 ? 'red' : undefined} onClick={() => navigate('/attendance')} />
        <Kpi label="Teachers absent today"
          value={hrms === null ? undefined : (hrmsAbsence.available ? hrmsAbsence.absent : '—')}
          unit={hrmsAbsence.available ? `of ${hrmsAbsence.tracked} on HRMS` : ''}
          sub={
            hrms === null ? 'Checking HRMS…'
              : !hrmsAbsence.available ? 'HRMS attendance unavailable today'
                : hrmsAbsence.softMorning ? `Not punched in yet · ${hrmsAbsence.present} present so far`
                  : `Haven’t punched in per HRMS${hrmsAbsence.leave ? ` · ${hrmsAbsence.leave} on leave` : ''}`
          }
          tone={hrmsAbsence.available && !hrmsAbsence.softMorning && hrmsAbsence.absent > 0 ? 'red' : undefined}
          onClick={() => navigate('/arrangement')} />
        <Kpi label="Plans due this week" value={loading ? undefined : missingPlanTeachers.length} unit="missing" sub={plansTotal ? `${plansTotal - missingPlanTeachers.length} of ${plansTotal} teachers submitted` : ''} tone={missingPlanTeachers.length ? 'gold' : undefined} onClick={() => navigate('/lesson-plans')} />
        <Kpi label="No lesson in 3+ days" value={loading ? undefined : inactiveTeachers.length} unit="teachers" sub={inactiveTeachers.length ? inactiveTeachers.slice(0, 3).map(t => shortName(t.fullName)).join(', ') + (inactiveTeachers.length > 3 ? '…' : '') : 'Everyone is logging'} tone={inactiveTeachers.length ? 'gold' : undefined} onClick={() => navigate('/lessons')} />
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16, alignItems: 'start' }} className="dash-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Today's coverage */}
          <section className="fade-in" style={CARD}>
            <div style={CARD_HEAD}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Today's coverage</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{isSunday ? 'No school today' : `${todayName} · ${coverage.rows.length} teachers timetabled${currentPeriod ? ` · P${currentPeriod.period} running (${currentPeriod.label})` : nowMin < (periodStart(coverage.sched[0]) ?? 0) ? ' · school not started yet' : ' · school day over'} · hover a cell for details`}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, width: 240, background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 9, padding: '0 10px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input value={teacherQuery} onChange={e => { setTeacherQuery(e.target.value); const q = e.target.value.trim().toLowerCase(); const hits = q ? coverage.rows.filter(r => (r.t.fullName || '').toLowerCase().includes(q)) : []; setFocusId(hits.length === 1 ? hits[0].t.id : null) }} placeholder="Search a teacher…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, fontFamily: 'inherit', color: 'var(--text)', minWidth: 0 }} />
                  {teacherQuery && <button onClick={() => { setTeacherQuery(''); setFocusId(null); setWeekView(false) }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>}
                </div>
                <Link to="/timetable" style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Full timetable →</Link>
              </div>
            </div>

            {focus && (
              <div style={{ borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ width: 32, height: 32, borderRadius: '50%', background: focus.absent ? 'var(--crimson-light)' : 'var(--green-light)', color: focus.absent ? 'var(--crimson)' : 'var(--green-dark)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(focus.t.fullName)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{focus.t.fullName} {focus.absent && <span style={pillStyle('red')}>Absent today</span>}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{weekView ? 'Weekly timetable' : focus.offToday ? `No periods on ${todayName}` : `${todayName} · ${focus.cells.filter(c => c.kind !== 'none').length} periods · ${focus.cells.filter(c => c.kind === 'logged').length} logged`}</div>
                  </div>
                  <div style={{ display: 'flex', background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 9, padding: 3, gap: 2 }}>
                    {[[false, 'Today'], [true, 'This week']].map(([v, l]) => <button key={l} onClick={() => setWeekView(v)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: weekView === v ? 600 : 500, fontFamily: 'inherit', border: 'none', borderRadius: 7, cursor: 'pointer', background: weekView === v ? 'var(--gray-50)' : 'transparent', color: weekView === v ? 'var(--text)' : 'var(--text-muted)', boxShadow: weekView === v ? 'var(--shadow-sm)' : 'none' }}>{l}</button>)}
                  </div>
                  <Link to={`/teacher-management/${focus.t.id}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', textDecoration: 'none' }}>Profile →</Link>
                  <button onClick={() => { setFocusId(null); setWeekView(false) }} title="Close" style={{ border: '1px solid var(--gray-100)', background: 'var(--white)', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                </div>
                {!weekView ? (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${coverage.sched.length}, minmax(0, 1fr))`, gap: 8 }}>
                    {focus.cells.map((c, i) => {
                      const s = coverage.sched[i]
                      const free = c.kind === 'none'
                      const live = isNow(s)
                      const over = !live && periodEnd(s) !== null && nowMin >= periodEnd(s)
                      return (
                        <div key={i} title={cellTitle(c, s, focus.t)} style={{ background: live ? 'var(--white)' : over ? 'var(--gray-50)' : 'var(--white)', border: live ? '2px solid var(--text)' : `1px solid ${c.kind === 'uncovered' ? 'var(--crimson)' : 'var(--gray-100)'}`, boxShadow: live ? 'var(--shadow-md)' : 'none', borderRadius: 10, padding: live ? '9px 11px' : '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 92, opacity: free && !live ? 0.6 : 1, position: 'relative' }}>
                          {live && <span style={{ position: 'absolute', top: -9, left: 10, background: 'var(--text)', color: 'var(--white)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green-mid)', display: 'inline-block', animation: 'pulse 1.5s ease infinite' }} />Now · {minsLeft(s)} min left</span>}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ fontSize: 12, fontWeight: 700 }}>P{s.period}</span><span style={{ fontSize: 10.5, color: live ? 'var(--text)' : 'var(--text-muted)', fontWeight: live ? 600 : 400 }}>{s.label || ''}</span></div>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{free ? 'Free' : (c.slot?.className || c.cls)}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{free ? '' : (c.slot?.subject || '')}</div>
                          <div style={{ marginTop: 'auto' }}>{!free && <span style={pillStyle(kindTone[c.kind])}>{c.kind === 'arranged' ? `→ ${shortName(c.who)}` : kindLabel[c.kind]}</span>}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'separate', borderSpacing: '6px 4px', width: '100%', minWidth: 640 }}>
                      <thead><tr><th style={{ textAlign: 'left', fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', width: 90 }}>Day</th>{coverage.sched.map(s => <th key={s.period} title={s.label} style={{ fontSize: 10.5, color: isNow(s) ? 'var(--text)' : 'var(--text-muted)', fontWeight: isNow(s) ? 700 : 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>P{s.period}{isNow(s) ? ' · now' : ''}</th>)}</tr></thead>
                      <tbody>
                        {weekFor(focus.t.id).map(({ day, cells }) => (
                          <tr key={day}>
                            <td style={{ padding: 0, fontSize: 12.5, fontWeight: day === todayName ? 700 : 500, color: day === todayName ? 'var(--text)' : 'var(--text-muted)' }}>{day.slice(0, 3)}{day === todayName && <span style={{ marginLeft: 6, ...pillStyle('green') }}>Today</span>}</td>
                            {cells.map((c, i) => { const live = day === todayName && isNow(coverage.sched[i]); return <td key={i} style={{ padding: 0 }}>{c ? <div title={`${day} · P${coverage.sched[i].period} · ${c.subject || ''} · ${c.cls}${live ? ' · running now' : ''}`} style={{ background: day === todayName ? 'var(--green-light)' : 'var(--white)', border: live ? '2px solid var(--text)' : '1px solid var(--gray-100)', boxShadow: live ? 'var(--shadow-sm)' : 'none', borderRadius: 8, padding: live ? '5px 7px' : '6px 8px', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 44 }}><span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cls}</span><span style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.subject}</span></div> : <div style={{ height: 44, borderRadius: 8, background: 'var(--gray-100)', opacity: 0.6, border: live ? '2px solid var(--text)' : 'none' }} />}</td> })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {loading ? (
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>{Array(5).fill(0).map((_, i) => <div key={i} style={{ height: 30, background: 'var(--gray-50)', borderRadius: 6, animation: 'pulse 1.5s ease infinite' }} />)}</div>
            ) : !isSunday && coverage.rows.length > 0 && coverage.visible.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <span>No teacher matching “{teacherQuery}” is timetabled today.</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {timetableTeachers.filter(t => (t.fullName || '').toLowerCase().includes(teacherQuery.trim().toLowerCase())).slice(0, 8).map(t => (
                    <button key={t.id} onClick={() => { setFocusId(t.id); setWeekView(true) }} style={{ padding: '6px 12px', borderRadius: 99, border: '1px solid var(--gray-200)', background: 'var(--white)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: 'var(--text)' }}>{t.fullName} · week</button>
                  ))}
                </div>
              </div>
            ) : isSunday || coverage.rows.length === 0 ? (
              <div style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{isSunday ? 'Sunday — enjoy the day off.' : <>No timetable for {todayName}. Assign periods in <Link to="/timetable">Timetable</Link>.</>}</div>
            ) : (
              <div style={{ padding: '10px 18px 14px', overflowX: 'auto' }}>
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'separate', borderSpacing: '6px 4px', width: '100%', minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0 2px', position: 'sticky', top: 0, background: 'var(--white)', minWidth: 170 }}>Teacher</th>
                        {coverage.sched.map(s => <th key={s.period} title={s.label} style={{ fontSize: 10.5, color: isNow(s) ? 'var(--text)' : 'var(--text-muted)', fontWeight: isNow(s) ? 700 : 600, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0 2px', textAlign: 'center', position: 'sticky', top: 0, background: 'var(--white)', borderBottom: isNow(s) ? '2px solid var(--text)' : '2px solid transparent' }}>P{s.period}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {coverage.visible.map(({ t, cells, absent }) => (
                        <tr key={t.id} style={{ background: focusId === t.id ? 'var(--green-light)' : 'transparent' }}>
                          <td style={{ padding: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap' }}>
                              <span style={{ width: 24, height: 24, borderRadius: '50%', background: absent ? 'var(--crimson-light)' : 'var(--green-light)', color: absent ? 'var(--crimson)' : 'var(--green-dark)', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(t.fullName)}</span>
                              <button onClick={() => { setFocusId(focusId === t.id ? null : t.id); setWeekView(false) }} title="Show this teacher's day" style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--text)', cursor: 'pointer', textDecoration: focusId === t.id ? 'underline' : 'none' }}>{shortName(t.fullName)}</button>
                              {absent && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--crimson)', background: 'var(--crimson-light)', padding: '1px 6px', borderRadius: 99 }}>Absent</span>}
                            </div>
                          </td>
                          {cells.map((c, i) => <td key={i} style={{ padding: 0, minWidth: 54 }}><div title={cellTitle(c, coverage.sched[i], t)} style={cellStyle(c)}>{cellText(c)}</div></td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ paddingTop: 10 }}>
                  <Legend items={[['Logged', { background: 'var(--green)' }], ['Scheduled', { background: 'var(--green-light)' }], ['Period over, not logged', { background: 'var(--gold-light)' }], ['Arrangement', { background: '#E07B00' }], ['Uncovered', { border: '1.5px dashed var(--crimson)' }]]} />
                </div>
              </div>
            )}
          </section>

          {/* Recent lessons */}
          <section className="fade-in" style={CARD}>
            <div style={CARD_HEAD}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Latest from teachers</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Most recent lesson log entries</div>
              </div>
              <Link to="/lessons" style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', textDecoration: 'none' }}>Lesson log →</Link>
            </div>
            <div style={{ padding: '0 18px' }}>
              {loading ? Array(4).fill(0).map((_, i) => <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid var(--gray-50)', display: 'flex', gap: 12 }}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--gray-100)', animation: 'pulse 1.5s ease infinite' }} /><div style={{ flex: 1 }}><div style={{ height: 12, background: 'var(--gray-100)', borderRadius: 4, marginBottom: 6, width: '60%' }} /><div style={{ height: 10, background: 'var(--gray-100)', borderRadius: 4, width: '40%' }} /></div></div>)
              : recentLessons.length === 0 ? <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No lessons logged yet.</div>
              : recentLessons.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--gray-50)' }}>
                  <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--green-light)', color: 'var(--green-dark)', fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(l.teacherName)}</span>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b style={{ fontWeight: 600 }}>{l.teacherName || 'Teacher'}</b> <span style={{ color: 'var(--text-muted)' }}>· {l.className} · {l.subject}{l.topicNames ? ` · ${l.topicNames}` : ''}</span></div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0 }}>{l.date === format(new Date(), 'yyyy-MM-dd') ? 'Today' : l.date}{l.period ? ` · P${l.period}` : ''}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section className="fade-in" style={CARD}>
            <div style={CARD_HEAD}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Needs attention</div>
              <span style={{ fontSize: 11, fontWeight: 700, background: attention.length ? 'var(--text)' : 'var(--gray-100)', color: attention.length ? 'var(--white)' : 'var(--text-muted)', padding: '2px 8px', borderRadius: 99 }}>{loading ? '…' : attention.length}</span>
            </div>
            {loading ? <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>{Array(4).fill(0).map((_, i) => <div key={i} style={{ height: 36, background: 'var(--gray-50)', borderRadius: 8, animation: 'pulse 1.5s ease infinite' }} />)}</div>
            : attention.length === 0 ? <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}><div style={{ fontSize: 24, color: 'var(--green)', marginBottom: 6 }}>✓</div>Nothing needs you right now.</div>
            : attention.map((a, i) => <Attention key={i} {...a} />)}
          </section>

          <section className="fade-in" style={CARD}>
            <div style={CARD_HEAD}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Test absentees</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Students who missed a test</div>
              </div>
              {alerts.length > 0 && <Link to="/absentees" style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', textDecoration: 'none' }}>All →</Link>}
            </div>
            <div style={{ padding: '0 18px' }}>
              {loading ? null : alerts.length === 0 ? <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No absentees recorded.</div>
              : alerts.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--gray-50)' }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--crimson-light)', color: 'var(--crimson)', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials(a.studentName)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.studentName || 'Student'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.testName || 'Test'} · {a.className || ''}{a.subject ? ` · ${a.subject}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{a.testDate || ''}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <style>{`@media (max-width: 1100px) { .dash-body { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}
