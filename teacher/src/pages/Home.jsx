import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where, limit } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { getTeacherClasses } from '../utils/teacherClasses'
import { format, subDays } from 'date-fns'

export default function Home() {
  const { teacher, user } = useAuth()
  const [recentLessons, setRecentLessons] = useState([])
  const [pendingTests, setPendingTests] = useState([])
  const [missedToday, setMissedToday] = useState([])
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'EEEE, d MMM')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const [myClasses, setMyClasses] = useState([])
  useEffect(() => {
    if (teacher || user) getTeacherClasses(teacher, user).then(setMyClasses)
  }, [teacher, user])

  const teacherId = teacher?.id || user?.uid || ''

  const load = useCallback(async () => {
    if (!teacherId && !user?.email) { setLoading(false); return }
    try {
      // Load recent lessons — no orderBy to avoid requiring composite index
      // Sort client-side instead. Load more than we display to ensure we have the truly most-recent ones.
      let lessonsData = []
      try {
        const snap = await getDocs(query(collection(db, 'lessons'), where('teacherId', '==', teacherId), limit(200)))
        lessonsData = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      } catch (e) { console.log('lessons by id failed:', e.code) }

      // Fallback: by teacher name
      if (lessonsData.length === 0 && teacher?.fullName) {
        try {
          const snap = await getDocs(query(collection(db, 'lessons'), where('teacherName', '==', teacher.fullName), limit(200)))
          lessonsData = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        } catch (e) { console.log('lessons by name failed:', e.code) }
      }

      // Sort client-side, take 5 most recent for the home tile
      lessonsData = lessonsData.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5)
      setRecentLessons(lessonsData)

      // Load pending tests — scoped to teacher's branches (supports dual-branch)
      const teacherBranches = (teacher?.branchCodes && teacher.branchCodes.length > 0)
        ? teacher.branchCodes
        : ['MAIN']
      const testsSnap = await getDocs(query(
        collection(db, 'tests'),
        where('branchCode', 'in', teacherBranches)
      ))
      const allTests = testsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setPendingTests(allTests.filter(t =>
        myClasses.includes(t.className) && !t.marksEntered
      ))

      // Check if teacher has logged any lesson today
      const todayLessons = lessonsData.filter(l => l.date === todayStr)
      // Determine which classes have no lesson today
      if (myClasses.length > 0 && todayLessons.length < myClasses.length) {
        const coveredClasses = new Set(todayLessons.map(l => l.className))
        const uncovered = myClasses.filter(c => !coveredClasses.has(c))
        setMissedToday(uncovered)
      } else {
        setMissedToday([])
      }
    } catch (e) {
      console.error('Home load error:', e)
    }
    setLoading(false)
  }, [teacherId, user?.email, todayStr])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const isWeekend = new Date().getDay() === 0 // Sunday
  const showAlert = !isWeekend && missedToday.length > 0 && hour >= 10

  return (
    <div style={{ padding: '24px 20px' }}>
      {/* Greeting */}
      <div className="fade-up" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 2 }}>{today}</p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', lineHeight: 1.3 }}>
          {greeting},<br />{teacher?.fullName?.split(' ')[0] || user?.displayName?.split(' ')[0] || 'Teacher'} ✦
        </h1>
        {myClasses.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
            {myClasses.join(' · ')}
          </p>
        )}
      </div>

      {/* Missed class alert */}
      {showAlert && (
        <div className="fade-up" style={{ background: 'linear-gradient(135deg, #7a1a1a, var(--crimson))', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'white', marginBottom: 4 }}>
              No lesson logged today for {missedToday.length === 1 ? missedToday[0] : `${missedToday.length} classes`}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>
              {missedToday.join(', ')}
            </div>
            <Link to="/log-lesson" style={{ fontSize: 12, color: 'white', fontWeight: 700, textDecoration: 'none', background: 'rgba(255,255,255,0.2)', padding: '5px 12px', borderRadius: 20, display: 'inline-block' }}>
              Log lesson now →
            </Link>
          </div>
        </div>
      )}

      {/* HRMS hub entry — leads to /hrms */}
      <Link to="/hrms" style={{ textDecoration: 'none', display: 'block', marginBottom: 16 }}>
        <div className="fade-up" style={{
          background: 'linear-gradient(90deg, rgba(201,162,39,0.13), rgba(201,162,39,0.05))',
          border: '1.5px solid rgba(201,162,39,0.5)',
          borderRadius: 'var(--radius-lg)',
          padding: '13px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: 'var(--gold)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--gold-dark)', marginBottom: 2 }}>My HRMS data</div>
            <div style={{ fontSize: 11, color: 'var(--gold-dark)', opacity: 0.8 }}>Attendance, documents and more</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </Link>

      {/* Quick action cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <Link to="/log-lesson" style={{ textDecoration: 'none' }}>
          <div className="fade-up" style={{ background: 'var(--green)', borderRadius: 'var(--radius-lg)', padding: '20px 16px', color: 'white', position: 'relative', overflow: 'hidden', minHeight: 100 }}>
            <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.8" style={{ marginBottom: 12 }}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>Log Today's<br />Lesson</div>
          </div>
        </Link>
        <Link to="/lesson-plan" style={{ textDecoration: 'none' }}>
          <div className="fade-up" style={{ background: 'var(--green-dark)', borderRadius: 'var(--radius-lg)', padding: '20px 16px', color: 'white', position: 'relative', overflow: 'hidden', minHeight: 100 }}>
            <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.8" style={{ marginBottom: 12 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="14" x2="16" y2="14" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>Weekly<br />Lesson Plan</div>
          </div>
        </Link>
        <Link to="/enter-marks" style={{ textDecoration: 'none' }}>
          <div className="fade-up" style={{ background: 'var(--gold)', borderRadius: 'var(--radius-lg)', padding: '20px 16px', color: 'var(--green-dark)', position: 'relative', overflow: 'hidden', minHeight: 100 }}>
            <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green-dark)" strokeWidth="1.8" style={{ marginBottom: 12, opacity: 0.8 }}>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: 'var(--green-dark)' }}>Enter Test<br />Marks</div>
            {pendingTests.length > 0 && <div style={{ position: 'absolute', top: 12, right: 12, width: 20, height: 20, borderRadius: '50%', background: 'var(--crimson)', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{pendingTests.length}</div>}
          </div>
        </Link>
        <Link to="/student-analytics" style={{ textDecoration: 'none' }}>
          <div className="fade-up" style={{ background: '#e6f1fb', borderRadius: 'var(--radius-lg)', padding: '20px 16px', position: 'relative', overflow: 'hidden', minHeight: 100 }}>
            <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(24,95,165,0.08)' }} />
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#185fa5" strokeWidth="1.8" style={{ marginBottom: 12, opacity: 0.8 }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: '#185fa5' }}>Student<br />Analytics</div>
          </div>
        </Link>
      </div>

      {/* My Class Students tile — class teachers only */}
      {teacher?.classTeacherOf ? (
        <Link to="/my-students" style={{ textDecoration: 'none', display: 'block', marginBottom: 24 }}>
          <div className="fade-up" style={{ background: 'var(--green)', borderRadius: 'var(--radius-lg)', padding: '20px', color: 'white', display: 'flex', alignItems: 'center', gap: 16, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, marginBottom: 4 }}>My Class Students</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>Manage roster for {teacher.classTeacherOf}</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </Link>
      ) : (
        <div style={{ marginBottom: 24, padding: '16px 20px', background: '#f5f5f0', border: '1px dashed #d9d6cb', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: 14, opacity: 0.7 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.8">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#6b6b6b', marginBottom: 2 }}>My Class Students</div>
            <div style={{ fontSize: 11, color: '#999' }}>Available once you're assigned as a class teacher.</div>
          </div>
        </div>
      )}

      {/* Daily Attendance tile — class teachers only */}
      {teacher?.classTeacherOf && (
        <Link to="/student-attendance" style={{ textDecoration: 'none', display: 'block', marginBottom: 24 }}>
          <div className="fade-up" style={{ background: '#c9a227', borderRadius: 'var(--radius-lg)', padding: '20px', color: 'white', display: 'flex', alignItems: 'center', gap: 16, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.10)' }} />
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, marginBottom: 4 }}>Daily Attendance</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>Mark today's attendance for {teacher.classTeacherOf}</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </Link>
      )}

      {/* Pending tests alert */}
      {pendingTests.length > 0 && (
        <div className="fade-up" style={{ background: 'var(--crimson-light)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(139,26,26,0.15)', padding: '14px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--crimson)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--crimson)', marginBottom: 2 }}>Marks pending for {pendingTests.length} test{pendingTests.length > 1 ? 's' : ''}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pendingTests.map(t => t.testName).join(', ')}</div>
          </div>
          <Link to="/enter-marks" style={{ fontSize: 12, color: 'var(--crimson)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Enter →</Link>
        </div>
      )}

      {/* Recent lessons */}
      <div className="fade-up">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Recent lessons</h2>
          <Link to="/log-lesson" style={{ fontSize: 12, color: 'var(--green)', textDecoration: 'none', fontWeight: 500 }}>+ New</Link>
        </div>
        {loading ? (
          Array(3).fill(0).map((_, i) => (
            <div key={i} style={{ height: 68, background: 'var(--white)', borderRadius: 'var(--radius-md)', marginBottom: 8, border: '1px solid var(--gray-100)', animation: 'pulse 1.5s ease infinite' }} />
          ))
        ) : recentLessons.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 20px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)' }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>No lessons logged yet.</p>
            <Link to="/log-lesson" style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, textDecoration: 'none' }}>Log your first lesson →</Link>
          </div>
        ) : recentLessons.map(l => (
          <div key={l.id} style={{ background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-100)', padding: '12px 16px', marginBottom: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                <span style={{ fontSize: 11, background: 'var(--green-light)', color: 'var(--green)', padding: '2px 7px', borderRadius: 8, fontWeight: 500 }}>{l.className}</span>
                <span style={{ fontSize: 11, background: 'var(--gold-light)', color: 'var(--gold-dark)', padding: '2px 7px', borderRadius: 8 }}>{l.subject}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.topicNames || 'Topics logged'}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }}>{l.date}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
