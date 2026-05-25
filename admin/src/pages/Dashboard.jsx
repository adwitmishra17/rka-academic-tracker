import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { collection, doc, getDoc, getDocs, query, where, limit } from 'firebase/firestore'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { format, subDays, startOfWeek } from 'date-fns'
import { useNavigate } from 'react-router-dom'

function StatCard({ label, value, sub, color, onClick, icon }) {
  return (
    <div className="fade-in gemini-border" onClick={onClick} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'24px', cursor:onClick?'pointer':'default', border:'1px solid var(--gray-100)', boxShadow:'var(--shadow-sm)', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color, borderRadius:'var(--radius-lg) var(--radius-lg) 0 0' }} />
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ width:40, height:40, borderRadius:10, background:`${color}22`, display:'flex', alignItems:'center', justifyContent:'center', color }}>{icon}</div>
        {sub && <span style={{ fontSize:11, color:'var(--text-muted)', background:'var(--gray-50)', padding:'3px 8px', borderRadius:20, border:'1px solid var(--gray-100)' }}>{sub}</span>}
      </div>
      <div style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:600, color:'var(--text)', lineHeight:1 }}>{value ?? <span style={{ width:48, height:28, background:'var(--gray-100)', borderRadius:4, display:'inline-block', animation:'pulse 1.5s ease infinite' }} />}</div>
      <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>{label}</div>
    </div>
  )
}

function ActivityRow({ name, action, time, status }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:'1px solid var(--gray-50)' }}>
      <div style={{ width:36, height:36, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <span style={{ fontSize:13, fontWeight:600, color:'var(--green)' }}>{name?.[0] || '?'}</span>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{action}</div>
      </div>
      <div style={{ textAlign:'right', flexShrink:0 }}>
        <div style={{ fontSize:11, color:'var(--text-muted)' }}>{time}</div>
        {status && <div style={{ fontSize:11, padding:'2px 7px', borderRadius:10, background:status==='absent'?'var(--crimson-light)':'var(--green-light)', color:status==='absent'?'var(--crimson)':'var(--green)', marginTop:3 }}>{status}</div>}
      </div>
    </div>
  )
}

// Tooltip rendered via portal — completely outside any overflow container
function HoverTooltip({ tooltip }) {
  if (!tooltip) return null
  const x = Math.min(tooltip.x + 16, window.innerWidth - 280)
  const y = Math.max(8, tooltip.y - 8)
  return createPortal(
    <div style={{
      position: 'fixed', left: x, top: y,
      zIndex: 999999,
      background: '#162518',
      color: 'white',
      borderRadius: 10,
      padding: '12px 16px',
      pointerEvents: 'none',
      maxWidth: 280,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.12)',
      lineHeight: 1.9,
      fontSize: 12,
    }}>
      {tooltip.lines.map((line, i) => (
        <div key={i} style={{
          color: line.color || (line.bold ? '#fff' : 'rgba(255,255,255,0.78)'),
          fontWeight: line.bold ? 700 : 400,
          fontSize: line.bold ? 13 : 12,
          borderBottom: line.divider ? '1px solid rgba(255,255,255,0.12)' : 'none',
          paddingBottom: line.divider ? 6 : 0,
          marginBottom: line.divider ? 6 : 0,
        }}>
          {line.icon ? `${line.icon} ${line.text}` : (line.bold || line.text)}
        </div>
      ))}
    </div>,
    document.body
  )
}

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
  const [timetableView, setTimetableView] = useState('teacher')
  const [schedule, setSchedule] = useState([])
  const [tooltip, setTooltip] = useState(null)
  const [todayArrangements, setTodayArrangements] = useState([])

  const today = format(new Date(), 'EEEE, d MMMM yyyy')
  const { user, effectiveBranches, currentBranch, allowedBranches } = useAuth()
  const [adminProfile, setAdminProfile] = useState(null)
  useEffect(() => {
    if (!user?.email) return
    const emailKey = user.email.toLowerCase().trim()
    getDoc(doc(db, 'admins', emailKey))
      .then(s => { if (s.exists()) setAdminProfile(s.data()) })
      .catch(() => {})
  }, [user])
  const adminName = (adminProfile?.fullName || '').split(' ')[0]
                 || (user?.displayName || '').split(' ')[0]
                 || (user?.email || '').split('@')[0]
                 || 'Admin'
  const greeting = (() => { const h = new Date().getHours(); return h<12?'Good morning':h<17?'Good afternoon':'Good evening' })()
  const threeDaysAgo = format(subDays(new Date(), 3), 'yyyy-MM-dd')

  useEffect(() => {
    async function load() {
      try {
        const empty = { docs: [] }
        const todayDate = format(new Date(), 'yyyy-MM-dd')
        // Per-branch periods doc. On All Branches (super admin), pick the
        // first allowed branch — schedule rendering needs a single template.
        const periodsBranch = currentBranch || allowedBranches[0] || 'MAIN'
        const [teachersSnap, lessonsSnap, testsSnap, marksSnap, studentsSnap, missedSnap, ttSnap, periodsDoc, arrSnap] = await Promise.all([
          getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'lessons'), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'tests'), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'testMarks'), where('isAbsent', '==', true), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
          getDocs(query(collection(db, 'students'), ...branchConstraints('branchCode', effectiveBranches))).catch(() => empty),
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
          studentsSnap.docs.map(d => d.data()).filter(s => s.isActive !== false).map(s => (s.fullName||'').trim().toLowerCase())
        )
        // Build set of valid test IDs to filter out orphaned absentees from deleted tests
        const validTestIds = new Set(testsSnap.docs.map(d => d.id))
        const validAbsentees = marksSnap.docs.map(d => d.data()).filter(m => {
          const n = (m.studentName||'').trim().toLowerCase()
          return n && activeNamesLower.has(n) && validTestIds.has(m.testId)
        })

        setStats({ teachers: teachersSnap.size, todayLessons: todayLessons.length, tests: testsSnap.size, absentees: validAbsentees.length })
        setRecentLessons(sortedLessons.slice(0,8))
        setAlerts(validAbsentees.slice(0,5))
        setMissedAlerts(missedSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        setTimetable(ttSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        setTodayArrangements(arrSnap.docs.map(d => ({ id:d.id, ...d.data() })))

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

  return (
    <div style={{ padding:'24px 28px' }}>
      <HoverTooltip tooltip={tooltip} />

      {/* Header */}
      <div className="fade-in" style={{ marginBottom:28 }}>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:4 }}>{today}</p>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, color:'var(--green-dark)' }}>{greeting}, {adminName}</h1>
        <div style={{ width:48, height:2, background:'linear-gradient(90deg,var(--gold),transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {/* Missed lessons alert */}
      {missedAlerts.length > 0 && (
        <div className="fade-in" style={{ background:'linear-gradient(135deg,#7a1818,var(--crimson))', borderRadius:'var(--radius-lg)', padding:'16px 20px', marginBottom:16, display:'flex', alignItems:'flex-start', gap:14, position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, right:0, bottom:0, width:120, background:'rgba(255,255,255,0.04)', borderLeft:'1px solid rgba(255,255,255,0.08)' }} />
          <div style={{ width:38,height:38,borderRadius:'50%',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13,fontWeight:600,color:'white',marginBottom:6 }}>{missedAlerts.length} lesson{missedAlerts.length>1?'s':''} not logged today</div>
            <div style={{ display:'flex',flexWrap:'wrap',gap:6 }}>
              {missedAlerts.slice(0,6).map(a => <span key={a.id} style={{ fontSize:12,padding:'2px 10px',borderRadius:16,background:'rgba(255,255,255,0.15)',color:'rgba(255,255,255,0.9)' }}>{a.className}</span>)}
              {missedAlerts.length>6 && <span style={{ fontSize:12,color:'rgba(255,255,255,0.7)' }}>+{missedAlerts.length-6} more</span>}
            </div>
          </div>
          <span style={{ fontSize:11,color:'rgba(255,255,255,0.5)',flexShrink:0 }}>After 5 PM</span>
        </div>
      )}

      {/* Inactive teachers alert */}
      {inactiveTeachers.length > 0 && (
        <div className="fade-in" style={{ background:'linear-gradient(135deg,#7a5a00,var(--gold-dark))',borderRadius:'var(--radius-lg)',padding:'14px 20px',marginBottom:16,display:'flex',alignItems:'flex-start',gap:14 }}>
          <div style={{ width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13,fontWeight:600,color:'white',marginBottom:5 }}>{inactiveTeachers.length} teacher{inactiveTeachers.length>1?'s have':' has'} not logged a lesson in 3+ days</div>
            <div style={{ display:'flex',flexWrap:'wrap',gap:5 }}>
              {inactiveTeachers.map(t => <span key={t.id} style={{ fontSize:12,padding:'2px 9px',borderRadius:16,background:'rgba(255,255,255,0.15)',color:'rgba(255,255,255,0.9)' }}>{t.fullName}</span>)}
            </div>
          </div>
        </div>
      )}

      {/* Missing lesson plan alert */}
      {missingPlanTeachers.length > 0 && (
        <div className="fade-in" style={{ background:'var(--white)',borderRadius:'var(--radius-lg)',border:'1px solid rgba(139,26,26,0.2)',padding:'14px 20px',marginBottom:16,display:'flex',alignItems:'flex-start',gap:14 }}>
          <div style={{ width:36,height:36,borderRadius:'50%',background:'var(--crimson-light)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--crimson)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13,fontWeight:600,color:'var(--crimson)',marginBottom:5 }}>{missingPlanTeachers.length} teacher{missingPlanTeachers.length>1?'s have':' has'} not submitted a lesson plan this week</div>
            <div style={{ display:'flex',flexWrap:'wrap',gap:5 }}>
              {missingPlanTeachers.map(t => <span key={t.id} style={{ fontSize:12,padding:'2px 9px',borderRadius:16,background:'var(--crimson-light)',color:'var(--crimson)',border:'1px solid rgba(139,26,26,0.15)' }}>{t.fullName}</span>)}
            </div>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:16, marginBottom:24 }}>
        <StatCard label="Total teachers" value={stats.teachers} color="var(--green)" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} onClick={() => navigate('/teacher-management')} />
        <StatCard label="Lessons logged today" value={stats.todayLessons} sub="today" color="var(--green)" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>} onClick={() => navigate('/lessons')} />
        <StatCard label="Tests conducted" value={stats.tests} color="var(--gold-dark)" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>} onClick={() => navigate('/tests')} />
        <StatCard label="Absentees in tests" value={stats.absentees} sub={stats.absentees>0?"needs attention":undefined} color="var(--crimson)" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>} onClick={() => navigate('/absentees')} />
      </div>

      {/* Two column panels */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:24 }}>
        {/* Recent lessons */}
        <div style={{ background:'var(--white)',borderRadius:'var(--radius-lg)',border:'1px solid var(--gray-100)',boxShadow:'var(--shadow-sm)',overflow:'hidden' }}>
          <div style={{ padding:'20px 24px',borderBottom:'1px solid var(--gray-100)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div><h2 style={{ fontFamily:'var(--font-display)',fontSize:16,fontWeight:600,color:'var(--text)' }}>Recent lessons</h2><p style={{ fontSize:12,color:'var(--text-muted)',marginTop:2 }}>Latest entries from teachers</p></div>
            <div style={{ width:8,height:8,borderRadius:'50%',background:recentLessons.length>0?'var(--green-mid)':'var(--gray-200)',boxShadow:recentLessons.length>0?'0 0 0 3px var(--green-light)':'none' }} />
          </div>
          <div style={{ padding:'0 24px' }}>
            {loading ? Array(5).fill(0).map((_,i)=><div key={i} style={{ padding:'14px 0',borderBottom:'1px solid var(--gray-50)',display:'flex',gap:12 }}><div style={{ width:36,height:36,borderRadius:'50%',background:'var(--gray-100)',animation:'pulse 1.5s ease infinite' }} /><div style={{ flex:1 }}><div style={{ height:12,background:'var(--gray-100)',borderRadius:4,marginBottom:6,width:'60%',animation:'pulse 1.5s ease infinite' }} /><div style={{ height:10,background:'var(--gray-100)',borderRadius:4,width:'40%',animation:'pulse 1.5s ease infinite' }} /></div></div>)
            : recentLessons.length===0 ? <div style={{ padding:'32px 0',textAlign:'center',color:'var(--text-muted)',fontSize:13 }}>No lessons logged yet.</div>
            : recentLessons.map(l => <ActivityRow key={l.id} name={l.teacherName||'Teacher'} action={`${l.className} · ${l.subject} · ${l.topicNames||'Topics covered'}`} time={l.date||''} />)}
          </div>
        </div>

        {/* Absentee alerts */}
        <div style={{ background:'var(--white)',borderRadius:'var(--radius-lg)',border:'1px solid var(--gray-100)',boxShadow:'var(--shadow-sm)',overflow:'hidden' }}>
          <div style={{ padding:'20px 24px',borderBottom:'1px solid var(--gray-100)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
            <div><h2 style={{ fontFamily:'var(--font-display)',fontSize:16,fontWeight:600,color:'var(--text)' }}>Absentee alerts</h2><p style={{ fontSize:12,color:'var(--text-muted)',marginTop:2 }}>Students who missed tests</p></div>
            {alerts.length>0 && <span style={{ fontSize:11,fontWeight:600,background:'var(--crimson)',color:'white',padding:'3px 9px',borderRadius:20 }}>{alerts.length}</span>}
          </div>
          <div style={{ padding:'0 24px' }}>
            {loading ? Array(4).fill(0).map((_,i)=><div key={i} style={{ padding:'14px 0',borderBottom:'1px solid var(--gray-50)',display:'flex',gap:12 }}><div style={{ width:36,height:36,borderRadius:'50%',background:'var(--gray-100)',animation:'pulse 1.5s ease infinite' }} /><div style={{ flex:1 }}><div style={{ height:12,background:'var(--gray-100)',borderRadius:4,marginBottom:6,width:'60%',animation:'pulse 1.5s ease infinite' }} /></div></div>)
            : alerts.length===0 ? <div style={{ padding:'32px 0',textAlign:'center',color:'var(--text-muted)',fontSize:13 }}><div style={{ fontSize:28,marginBottom:8 }}>✓</div>No absentees recorded yet.</div>
            : alerts.map((a,i) => <ActivityRow key={i} name={a.studentName||'Student'} action={`${a.testName||'Test'} · ${a.className||''} · ${a.subject||''}`} time={a.testDate||''} status="absent" />)}
          </div>
        </div>
      </div>

      {/* Timetable Heatmap */}
      <div className="fade-in gemini-border" style={{ marginBottom:24, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
        <div style={{ padding:'16px 24px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
          <div>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:600, color:'var(--text)' }}>Timetable</h2>
            <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{timetable.length} periods assigned · hover any cell for details</p>
          </div>
          <div style={{ display:'flex', background:'var(--gray-50)', borderRadius:'var(--radius-md)', padding:3, border:'1px solid var(--gray-100)' }}>
            {[['teacher','By Teacher'],['class','By Class']].map(([k,l]) => (
              <button key={k} onClick={() => setTimetableView(k)} style={{ padding:'6px 16px', borderRadius:'var(--radius-sm)', border:'none', fontSize:12, fontWeight:500, cursor:'pointer', background:timetableView===k?'var(--white)':'transparent', color:timetableView===k?'var(--green)':'var(--text-muted)', boxShadow:timetableView===k?'var(--shadow-sm)':'none', transition:'all 0.15s' }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ overflowX:'auto', padding:'16px 20px 20px' }}>
          {(() => {
            const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
            const sched = schedule.length > 0 ? schedule : Array.from({length:8},(_,i)=>({period:i+1,label:''}))

            function slotClasses(slot) {
              if (slot.classNames?.length) return slot.classNames
              if (slot.className) return slot.className.split('+').map(s=>s.trim()).filter(Boolean)
              return []
            }

            // Cell component — uses td directly, hover shows tooltip beside cursor
            function Cell({ color, abbr, lines, borderLeft }) {
              return (
                <td
                  style={{ padding:'3px 2px', textAlign:'center', borderLeft:borderLeft?'2px solid var(--gray-100)':'none', cursor:'pointer' }}
                  onMouseEnter={e => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    setTooltip({ x: rect.right, y: rect.top + rect.height/2, lines })
                    e.currentTarget.querySelector('div').style.filter = 'brightness(1.25)'
                  }}
                  onMouseLeave={e => {
                    setTooltip(null)
                    e.currentTarget.querySelector('div').style.filter = ''
                  }}
                >
                  <div style={{ width:32, height:32, borderRadius:6, background:color, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto', transition:'filter 0.12s', pointerEvents:'none' }}>
                    <span style={{ fontSize:8, fontWeight:700, color:'white', display:'block', textAlign:'center', overflow:'hidden', maxWidth:28, lineHeight:1 }}>{abbr}</span>
                  </div>
                </td>
              )
            }

            function EmptyCell({ borderLeft }) {
              return <td style={{ padding:'3px 2px', borderLeft:borderLeft?'2px solid var(--gray-100)':'none' }}><div style={{ width:32, height:32, borderRadius:6, background:'var(--gray-100)', margin:'0 auto' }} /></td>
            }

            const allTeachersWithSlots = timetableTeachers.filter(t => t.isActive!==false && timetable.some(s=>s.teacherId===t.id))
            const ALL_CLASSES = ALL_CLASSES_NAMES
            const classesWithSlots = ALL_CLASSES.filter(cls => timetable.some(t=>slotClasses(t).includes(cls)))

            if (timetableView==='teacher' && allTeachersWithSlots.length===0) return <div style={{ textAlign:'center', padding:48, color:'var(--text-muted)', fontSize:13 }}>No timetable assigned yet. Go to <strong>Timetable</strong> to assign periods.</div>
            if (timetableView==='class' && classesWithSlots.length===0) return <div style={{ textAlign:'center', padding:48, color:'var(--text-muted)', fontSize:13 }}>No timetable assigned yet. Go to <strong>Timetable</strong> to assign periods.</div>

            return (
              <table style={{ borderCollapse:'collapse', fontSize:12, width:'100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding:'5px 12px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', minWidth:130 }}>
                      {timetableView==='teacher' ? 'Teacher' : 'Class'}
                    </th>
                    {DAYS.map(day => (
                      <th key={day} colSpan={sched.length} style={{ padding:'5px 4px', textAlign:'center', fontSize:11, fontWeight:600, color:'var(--text-muted)', borderLeft:'2px solid var(--gray-100)' }}>
                        {day.slice(0,3)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th />
                    {DAYS.map(day => sched.map(s => (
                      <th key={`${day}-${s.period}`} style={{ padding:'2px 1px', fontSize:9, color:'var(--gray-300)', fontWeight:400, textAlign:'center', minWidth:36, borderLeft:s.period===1?'2px solid var(--gray-100)':'none' }}>
                        P{s.period}
                      </th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {timetableView==='teacher'
                    ? allTeachersWithSlots.map((t, ti) => (
                        <tr key={t.id} style={{ borderTop:'1px solid var(--gray-50)', background:ti%2===0?'var(--white)':'var(--gray-50)' }}>
                          <td style={{ padding:'5px 12px', whiteSpace:'nowrap' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                              <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <span style={{ fontSize:9, fontWeight:700, color:'var(--green)' }}>{t.fullName?.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                              </div>
                              <span style={{ fontSize:11, fontWeight:500, color:'var(--text)' }}>{t.fullName?.split(' ').slice(0,2).join(' ')}</span>
                            </div>
                          </td>
                          {DAYS.map(day => sched.map(s => {
                            const slot = timetable.find(sl => sl.teacherId===t.id && sl.day===day && sl.period===s.period)
                            const bl = s.period===1
                            if (!slot) return <EmptyCell key={`${day}-${s.period}`} borderLeft={bl} />
                            // Check today's arrangements for this teacher+period
                            const todayDayName = format(new Date(), 'EEEE')
                            const arr = day === todayDayName
                              ? todayArrangements.find(a => a.absentTeacherId === t.id && a.period === s.period)
                              : null
                            return (
                              <Cell key={`${day}-${s.period}`}
                                color={arr ? '#e07b00' : 'var(--green)'}
                                abbr={arr ? (arr.arrangementTeacherName?.split(' ').map(n=>n[0]).join('').slice(0,2)) : slot.subject?.slice(0,4)}
                                borderLeft={bl}
                                lines={arr ? [
                                  { bold:'🔄 Arrangement', color:'#ffcc88' },
                                  { divider:true },
                                  { icon:'❌', text:`${t.fullName} — Absent` },
                                  { icon:'✅', text:`${arr.arrangementTeacherName} — Covering` },
                                  { icon:'📅', text:`${day} · P${s.period}${s.label?' ('+s.label+')':''}` },
                                  { icon:'🏫', text: slot.className },
                                ] : [
                                  { bold: t.fullName },
                                  { divider: true },
                                  { icon:'📅', text:`${day} · P${s.period}${s.label?' ('+s.label+')':''}` },
                                  { icon:'📚', text: slot.subject },
                                  { icon:'🏫', text: slot.className },
                                ]}
                              />
                            )
                          }))}
                        </tr>
                      ))
                    : classesWithSlots.map((cls, ci) => (
                        <tr key={cls} style={{ borderTop:'1px solid var(--gray-50)', background:ci%2===0?'var(--white)':'var(--gray-50)' }}>
                          <td style={{ padding:'5px 12px', whiteSpace:'nowrap', fontSize:11, fontWeight:500, color:'var(--text)' }}>{cls.replace('Class ','')}</td>
                          {DAYS.map(day => sched.map(s => {
                            const slots = timetable.filter(sl => slotClasses(sl).includes(cls) && sl.day===day && sl.period===s.period)
                            const bl = s.period===1
                            if (slots.length===0) return <EmptyCell key={`${day}-${s.period}`} borderLeft={bl} />
                            const multi = slots.length > 1
                            return (
                              <Cell key={`${day}-${s.period}`}
                                color={multi?'var(--crimson)':'var(--green)'}
                                abbr={multi?'!!':slots[0].subject?.slice(0,4)}
                                borderLeft={bl}
                                lines={multi
                                  ? [
                                      { bold:'⚠ Conflict', color:'#ffcc55' },
                                      { text:`${slots.length} teachers assigned` },
                                      { divider:true },
                                      { icon:'📅', text:`${day} · P${s.period}${s.label?' ('+s.label+')':''}` },
                                      { icon:'🏫', text:cls },
                                      ...slots.map((sl,i)=>({ icon:`${i+1}.`, text:`${sl.teacherName} — ${sl.subject}` }))
                                    ]
                                  : [
                                      { bold: cls },
                                      { divider:true },
                                      { icon:'📅', text:`${day} · P${s.period}${s.label?' ('+s.label+')':''}` },
                                      { icon:'👤', text: slots[0].teacherName },
                                      { icon:'📚', text: slots[0].subject },
                                    ]
                                }
                              />
                            )
                          }))}
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            )
          })()}

          {/* Legend */}
          <div style={{ display:'flex', gap:16, marginTop:16, paddingTop:12, borderTop:'1px solid var(--gray-100)', flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}><div style={{ width:14, height:14, borderRadius:3, background:'var(--green)' }} /><span style={{ fontSize:11, color:'var(--text-muted)' }}>Assigned</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}><div style={{ width:14, height:14, borderRadius:3, background:'var(--gray-200)' }} /><span style={{ fontSize:11, color:'var(--text-muted)' }}>Free</span></div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}><div style={{ width:14, height:14, borderRadius:3, background:'#e07b00' }} /><span style={{ fontSize:11, color:'var(--text-muted)' }}>Arrangement (today)</span></div>
            {timetableView==='class' && <div style={{ display:'flex', alignItems:'center', gap:6 }}><div style={{ width:14, height:14, borderRadius:3, background:'var(--crimson)' }} /><span style={{ fontSize:11, color:'var(--text-muted)' }}>Conflict</span></div>}
            <span style={{ fontSize:11, color:'var(--gray-400)', marginLeft:'auto' }}>Hover any cell to see teacher & subject</span>
          </div>
        </div>
      </div>

      {/* Firebase Console footer */}
      <div className="fade-in" style={{ marginTop:24, padding:'20px 24px', background:'linear-gradient(135deg,var(--green-dark),var(--green))', borderRadius:'var(--radius-lg)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
        <div>
          <h3 style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:600, color:'white', marginBottom:4 }}>Firebase Console</h3>
          <p style={{ fontSize:12, color:'rgba(255,255,255,0.6)' }}>Manage your data, authentication, and settings</p>
        </div>
        <a href="https://console.firebase.google.com/project/rka-academic-tracker" target="_blank" rel="noopener noreferrer" style={{ padding:'10px 20px', background:'rgba(201,162,39,0.2)', border:'1px solid rgba(201,162,39,0.4)', borderRadius:'var(--radius-md)', color:'var(--gold)', fontSize:13, fontWeight:500, textDecoration:'none', whiteSpace:'nowrap' }}>
          Open Console →
        </a>
      </div>
    </div>
  )
}
