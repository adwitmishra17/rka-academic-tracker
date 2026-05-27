import React, { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, signOut, signInWithCustomToken } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { auth, db } from './firebase/config'
import ImpersonationBanner, { setImpersonationState, clearImpersonationState } from './components/ImpersonationBanner'
import Login from './pages/Login'
import Home from './pages/Home'
import LogLesson from './pages/LogLesson'
import EnterMarks from './pages/EnterMarks'
import MySyllabus from './pages/MySyllabus'
import MyMarks from './pages/MyMarks'
import LessonPlan from './pages/LessonPlan'
import StudentAnalytics from './pages/StudentAnalytics'
import Hub from './pages/Hub'
import MyAttendance from './pages/MyAttendance'
import MyDocuments from './pages/MyDocuments'
import MyStudents from './pages/MyStudents'
import StudentAttendance from './pages/StudentAttendance'
import ExamMarksEntry from './pages/ExamMarksEntry'
import ExamGradesEntry from './pages/ExamGradesEntry'
import HpcEntry from './pages/HpcEntry'
import Layout from './components/Layout'
import { startVersionWatcher, reloadForUpdate } from './lib/versionCheck'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function App() {
  const [user, setUser] = useState(undefined)
  const [teacher, setTeacher] = useState(null)

  // ── Impersonation detection ────────────────────────────────────────────
  // The admin tracker's /impersonate page opens this PWA in a new tab with
  // ?impersonate=<customToken>&actor=<adminEmail>. We pick that up exactly
  // once on first load, sign in with the custom token, stash actor info in
  // sessionStorage (read by ImpersonationBanner), and clean the URL so the
  // token isn't sitting in browser history / Referer headers.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token  = params.get('impersonate')
    const actor  = params.get('actor')
    if (!token) return
    // Strip the params immediately so a page refresh doesn't try to re-sign-in
    // with an expired token.
    const url = new URL(window.location.href)
    url.searchParams.delete('impersonate')
    url.searchParams.delete('actor')
    window.history.replaceState({}, '', url.pathname + (url.search || ''))
    setImpersonationState(actor || 'admin')
    signInWithCustomToken(auth, token).catch(e => {
      console.error('Impersonation sign-in failed:', e)
      clearImpersonationState()
      alert('Impersonation failed: ' + (e.message || 'unknown error'))
    })
  }, [])

  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      if (u) {
        setUser(u)
        // Fetch teacher profile — match on school email or personal email (case-insensitive)
        try {
          // Sanitize: strip invisible Unicode chars (ZWSP, NBSP, BOM, LTR/RTL marks) + normal whitespace, lowercase
          const cleanEmail = (s) => (s || '').replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00A0]/g, '').trim().toLowerCase()
          const emailLower = cleanEmail(u.email)
          // Try school email
          let snap = await getDocs(query(collection(db, 'teachers'), where('email', '==', emailLower)))
          // Try original case (in case stored without lowercasing)
          if (snap.empty && u.email !== emailLower) {
            snap = await getDocs(query(collection(db, 'teachers'), where('email', '==', u.email)))
          }
          // Try personal email (lowercase)
          if (snap.empty) {
            snap = await getDocs(query(collection(db, 'teachers'), where('personalEmail', '==', emailLower)))
          }
          // Try personal email original case
          if (snap.empty && u.email !== emailLower) {
            snap = await getDocs(query(collection(db, 'teachers'), where('personalEmail', '==', u.email)))
          }
          // Last resort: load all teachers and match client-side (handles invisible chars and any casing)
          if (snap.empty) {
            const allSnap = await getDocs(collection(db, 'teachers'))
            const matched = allSnap.docs.find(d => {
              const data = d.data()
              return cleanEmail(data.email) === emailLower ||
                cleanEmail(data.personalEmail) === emailLower
            })
            if (matched) {
              setTeacher({ id: matched.id, ...matched.data() })
              return
            }
          }
          if (!snap.empty) {
            setTeacher({ id: snap.docs[0].id, ...snap.docs[0].data() })
          } else {
            // Not a registered teacher — sign out
            await auth.signOut()
            setUser(null)
            setTeacher(null)
            return
          }
        } catch (e) {
          console.error('Teacher lookup error:', e)
          // Rules error — let user in with basic info, pages will show permission errors
          setTeacher({ email: u.email, fullName: u.displayName, id: null })
        }
      } else {
        setUser(null); setTeacher(null)
      }
    })
  }, [])

  if (user === undefined) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
    </div>
  )

  return (
    <AuthContext.Provider value={{ user, teacher }}>
      <ImpersonationBanner />
      <VersionBanner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
            <Route index element={<Home />} />
            <Route path="log-lesson" element={<LogLesson />} />
            <Route path="enter-marks" element={<EnterMarks />} />
            <Route path="my-syllabus" element={<MySyllabus />} />
            <Route path="my-marks" element={<MyMarks />} />
            <Route path="lesson-plan" element={<LessonPlan />} />
            <Route path="student-analytics" element={<StudentAnalytics />} />
            <Route path="hrms" element={<Hub />} />
            <Route path="hrms/attendance" element={<MyAttendance />} />
            <Route path="hrms/documents" element={<MyDocuments />} />
            <Route path="my-students" element={<MyStudents />} />
            <Route path="student-attendance" element={<StudentAttendance />} />
            <Route path="exam-marks"  element={<ExamMarksEntry />} />
            <Route path="exam-grades" element={<ExamGradesEntry />} />
            <Route path="hpc"         element={<HpcEntry />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}

// VersionBanner — appears when a newer build is detected on the server.
// Non-intrusive (sticks to the top); user taps Refresh when they're ready.
// We deliberately do NOT auto-reload, since teachers might be mid-typing a
// lesson log.
function VersionBanner() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    startVersionWatcher(() => setShow(true))
  }, [])
  if (!show) return null
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#1a4a2e', color: 'white', padding: '10px 16px',
      fontSize: 13, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
    }}>
      <span>A new version is available.</span>
      <button onClick={reloadForUpdate} style={{
        background: 'white', color: '#1a4a2e', border: 'none', padding: '5px 14px',
        borderRadius: 4, fontWeight: 600, cursor: 'pointer', fontSize: 12,
      }}>Refresh</button>
    </div>
  )
}
