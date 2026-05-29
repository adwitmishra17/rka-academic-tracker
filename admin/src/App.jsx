import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { getDoc, doc } from 'firebase/firestore'
import { auth, db } from './firebase/config'
import {
  BRANCH_CODES,
  readStoredBranch,
  writeStoredBranch,
  resolveBranch,
  effectiveBranches as computeEffectiveBranches,
} from './lib/branch'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Syllabus from './pages/Syllabus'
import Lessons from './pages/Lessons'
import Tests from './pages/Tests'
import Alerts from './pages/Alerts'
import Absentees from './pages/Absentees'
import Teachers from './pages/Teachers'
import TeacherManagement from './pages/TeacherManagement'
import Setup from './pages/Setup'
import AdminUsers from './pages/AdminUsers'
import Students from './pages/Students'
import StudentAuditLog from './pages/StudentAuditLog'
import AttendanceOverview from './pages/AttendanceOverview'
import AttendanceClass from './pages/AttendanceClass'
import StudentPerformance from './pages/StudentPerformance'
import Timetable from './pages/Timetable'
import PeriodSettings from './pages/PeriodSettings'
import StudentProfile from './pages/StudentProfile'
import TeacherProfile from './pages/TeacherProfile'
import LessonPlanFields from './pages/LessonPlanFields'
import LessonPlans from './pages/LessonPlans'
import ClassesAndSubjectsAssignment from './pages/ClassesAndSubjectsAssignment'
import LessonPlanReschedule from './pages/LessonPlanReschedule'
import TeacherArrangement from './pages/TeacherArrangement'
import TestDetail from './pages/TestDetail'
import SyllabusUpload from './pages/SyllabusUpload'
import ReportCardSetup from './pages/ReportCardSetup'
import ReportCards from './pages/ReportCards'
import Impersonate from './pages/Impersonate'
import Layout from './components/Layout'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// Hardcoded super admin — cannot be removed or demoted from the UI.
export const SUPER_ADMIN_EMAIL = 'adwit@rkacademyballia.in'

/**
 * Read the modules array off an admin doc with backwards-compat. Legacy
 * docs missing the field are treated as having both modules — preserves
 * existing access for admins added before module support was introduced.
 * (Mirror of HRMS's adminModules helper.)
 */
function readModules(adminData) {
  const valid = ['tracker', 'hrms']
  if (Array.isArray(adminData?.modules) && adminData.modules.length > 0) {
    return adminData.modules.filter(m => valid.includes(m))
  }
  return ['tracker', 'hrms']
}

export default function App() {
  const [user, setUser] = useState(undefined)
  const [adminRole, setAdminRole] = useState(null)
  const [allowedBranches, setAllowedBranches] = useState([])
  const [currentBranch, setCurrentBranchState] = useState(null)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      setAuthError('')
      if (!u) {
        setUser(null)
        setAdminRole(null)
        setAllowedBranches([])
        setCurrentBranchState(null)
        return
      }

      const email = u.email?.toLowerCase() || ''

      // Hardcoded super admin — sees both branches, bypasses Firestore lookup.
      if (email === SUPER_ADMIN_EMAIL) {
        const allowed = ['MAIN', 'CITY']
        setUser(u)
        setAdminRole('super_admin')
        setAllowedBranches(allowed)
        setCurrentBranchState(resolveBranch(readStoredBranch(), allowed))
        return
      }

      // Branch admin / front-desk — look up admin doc.
      try {
        const adminDoc = await getDoc(doc(db, 'admins', email))
        if (!adminDoc.exists()) {
          setAuthError('Not authorised. Contact Adwit Mishra.')
          await auth.signOut()
          setUser(null)
          setAdminRole(null)
          return
        }
        const data = adminDoc.data()
        if (data.isActive === false) {
          setAuthError('Your access has been deactivated. Contact Adwit Mishra.')
          await auth.signOut()
          setUser(null)
          setAdminRole(null)
          return
        }

        // Module gate: this is the tracker, so 'tracker' must be in the
        // admin's allowed modules. Legacy docs missing the field default
        // to both modules.
        const mods = readModules(data)
        if (!mods.includes('tracker')) {
          setAuthError("You don't have access to the Academic Tracker. Contact Adwit Mishra.")
          await auth.signOut()
          setUser(null)
          setAdminRole(null)
          return
        }

        // Resolve branch from admin doc. Legacy docs without branchCode
        // default to MAIN (consistent with the data backfill convention).
        let allowed
        if (BRANCH_CODES.includes(data.branchCode)) {
          allowed = [data.branchCode]
        } else {
          console.warn(`Admin ${email} has missing/invalid branchCode (${data.branchCode}); defaulting to MAIN`)
          allowed = ['MAIN']
        }

        setUser(u)
        setAdminRole(data.role || 'admin')
        setAllowedBranches(allowed)
        setCurrentBranchState(resolveBranch(readStoredBranch(), allowed))
      } catch (e) {
        console.error('Admin lookup error:', e)
        setAuthError('Could not verify admin access. Please try again.')
        await auth.signOut()
        setUser(null)
        setAdminRole(null)
      }
    })
  }, [])

  /**
   * Branch switcher. Validates against allowedBranches before applying so
   * a stale call can't put the user into an unauthorised branch.
   */
  const setCurrentBranch = useCallback((next) => {
    if (next === null) {
      if (allowedBranches.length > 1) {
        setCurrentBranchState(null)
        writeStoredBranch(null)
      }
      return
    }
    if (allowedBranches.includes(next)) {
      setCurrentBranchState(next)
      writeStoredBranch(next)
    }
  }, [allowedBranches])

  // Memoise effectiveBranches so its identity is stable across renders —
  // pages use it as a useEffect dep; without useMemo, every parent render
  // would create a new array and trigger spurious refetches.
  const effectiveBranches = useMemo(
    () => computeEffectiveBranches(currentBranch, allowedBranches),
    [currentBranch, allowedBranches]
  )

  if (user === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 40, height: 40, border: '3px solid #c8dfd0', borderTopColor: '#1a4a2e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontFamily: 'var(--font-body)', color: 'var(--text-muted)', fontSize: 14 }}>Loading RKA Tracker…</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{
      user,
      adminRole,
      isSuperAdmin: adminRole === 'super_admin' || user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL,
      // Branch awareness
      allowedBranches,
      currentBranch,
      setCurrentBranch,
      effectiveBranches,
      canSwitchBranches: allowedBranches.length > 1,
      authError,
    }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!user ? <Login authError={authError} /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
            <Route index element={<Dashboard />} />
            <Route path="syllabus" element={<Syllabus />} />
            <Route path="lessons" element={<Lessons />} />
            <Route path="tests" element={<Tests />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="absentees" element={<Absentees />} />
            <Route path="performance" element={<StudentPerformance />} />
            <Route path="teachers" element={<Teachers />} />
            <Route path="teacher-management" element={<TeacherManagement />} />
            <Route path="setup" element={<Setup />} />
            <Route path="admin-users" element={<AdminUsers />} />
            <Route path="students" element={<Students />} />
            <Route path="students-audit" element={<StudentAuditLog />} />
            <Route path="attendance" element={<AttendanceOverview />} />
            <Route path="attendance/:className/:branchCode" element={<AttendanceClass />} />
            <Route path="timetable" element={<Timetable />} />
            <Route path="period-settings" element={<PeriodSettings />} />
            <Route path="students/:studentId" element={<StudentProfile />} />
            <Route path="teacher-management/:teacherId" element={<TeacherProfile />} />
            <Route path="lesson-plan-fields" element={<LessonPlanFields />} />
            <Route path="lesson-plans" element={<LessonPlans />} />
            <Route path="classes-subjects-assignment" element={<ClassesAndSubjectsAssignment />} />
            {/* Legacy paths → merged page */}
            <Route path="subject-settings" element={<Navigate to="/classes-subjects-assignment" replace />} />
            <Route path="class-subjects" element={<Navigate to="/classes-subjects-assignment" replace />} />
            <Route path="lesson-plan-reschedule" element={<LessonPlanReschedule />} />
            <Route path="arrangement" element={<TeacherArrangement />} />
            <Route path="tests/:testId" element={<TestDetail />} />
            <Route path="syllabus-upload" element={<SyllabusUpload />} />
            <Route path="report-card-setup" element={<ReportCardSetup />} />
            <Route path="report-cards" element={<ReportCards />} />
            <Route path="impersonate" element={<Impersonate />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
