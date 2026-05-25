// =========================================================================
// StudentAttendance.jsx — class teacher's daily attendance marking page
// Route: /student-attendance
//
// Mirrors admin AttendanceClass but:
//   - Forced to teacher's classTeacherOf + branchCodes[0]
//   - Date picker limited to today + last 7 days (the edit window)
//   - Cannot edit beyond 7 days (admin path only)
// =========================================================================

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { writeAttendanceAudit } from '../lib/attendanceAudit'
import { todayIST, lastSevenDays, friendlyDateLabel, isSunday, isWithinTeacherEditWindow } from '../lib/attendanceDates'

function docIdFor(date, studentId) { return `${date}_${studentId}` }

export default function StudentAttendance() {
  const { user, teacher } = useAuth()

  // Source class teacher assignment from classTeacherByEmail/<email>, which is
  // also what Firestore rules check. This avoids a class of bugs where the
  // teacher doc and the lookup doc disagree (e.g. branchCodes reordered after
  // assignment, or stale teacher.classTeacherOf from a deleted assignment).
  const myEmail = (teacher?.personalEmail || teacher?.email || user?.email || '').toLowerCase().trim()
  const [assignment, setAssignment] = useState(null)   // { className, branchCode } | null
  const [assignmentLoading, setAssignmentLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!myEmail) { setAssignmentLoading(false); return }
    ;(async () => {
      try {
        const s = await getDoc(doc(db, 'classTeacherByEmail', myEmail))
        if (cancelled) return
        if (s.exists()) {
          const d = s.data()
          setAssignment({ className: d.className, branchCode: d.branchCode })
        } else {
          setAssignment(null)
        }
      } catch (e) {
        console.error('classTeacherByEmail lookup failed:', e)
        if (!cancelled) setAssignment(null)
      } finally {
        if (!cancelled) setAssignmentLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [myEmail])

  const classTeacherOf = assignment?.className || null
  const branchCode = assignment?.branchCode || null

  const [selectedDate, setSelectedDate] = useState(todayIST())
  const [students, setStudents] = useState([])
  const [attendance, setAttendance] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    if (!classTeacherOf || !branchCode) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const studentsSnap = await getDocs(query(
        collection(db, 'students'),
        where('className', '==', classTeacherOf),
        where('branchCode', '==', branchCode),
      ))
      // Withdrawn students are never shown in the teacher PWA — admin only.
      const list = studentsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.isActive !== false)
        .sort((a, b) => Number(a.rollNumber || 0) - Number(b.rollNumber || 0))
      setStudents(list)

      const attSnap = await getDocs(query(
        collection(db, 'studentAttendance'),
        where('className', '==', classTeacherOf),
        where('branchCode', '==', branchCode),
        where('date', '==', selectedDate),
      ))
      const map = {}
      attSnap.forEach(d => {
        const x = d.data()
        map[x.studentId] = { status: x.status, isLate: x.isLate, docId: d.id, markedAt: x.markedAt }
      })
      setAttendance(map)
    } catch (e) {
      console.error(e); setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [classTeacherOf, branchCode, selectedDate])

  function actor() {
    return {
      performedBy: teacher?.id || user?.uid || 'unknown',
      performedByName: teacher?.fullName || user?.email || 'unknown',
      performedByRole: 'class_teacher',
    }
  }

  async function mark(student, target) {
    if (!isWithinTeacherEditWindow(selectedDate)) {
      alert('This date is outside your 7-day edit window. Contact admin to make changes.')
      return
    }
    const docId = docIdFor(selectedDate, student.id)
    const before = attendance[student.id] || null
    const ref = doc(db, 'studentAttendance', docId)

    if (target === 'unmark') {
      if (!before) return
      setAttendance(prev => { const next = { ...prev }; delete next[student.id]; return next })
      try {
        await deleteDoc(ref)
        await writeAttendanceAudit({
          attendanceDocId: docId,
          student: { ...student, branchCode, className: classTeacherOf },
          date: selectedDate, action: 'unmark',
          before: { status: before.status, isLate: before.isLate }, after: null,
          ...actor(),
        })
      } catch (e) {
        alert('Failed: ' + (e.message || e)); load()
      }
      return
    }

    const newState = target === 'absent'
      ? { status: 'absent', isLate: false }
      : { status: 'present', isLate: target === 'late' }

    setAttendance(prev => ({ ...prev, [student.id]: { ...newState, docId } }))
    try {
      const action = before ? 'edit' : 'mark'
      const a = actor()
      const payload = {
        studentId: student.id, studentName: student.fullName || '',
        rollNumber: student.rollNumber || '',
        className: classTeacherOf, branchCode, date: selectedDate,
        ...newState,
        markedBy: a.performedBy, markedByName: a.performedByName, markedByRole: 'class_teacher',
        markedAt: before?.markedAt || Timestamp.now(),
        editedAt: before ? Timestamp.now() : null,
        editedBy: before ? a.performedBy : null,
      }
      await setDoc(ref, payload)
      await writeAttendanceAudit({
        attendanceDocId: docId,
        student: { ...student, branchCode, className: classTeacherOf },
        date: selectedDate, action,
        before: before ? { status: before.status, isLate: before.isLate } : null,
        after: newState,
        ...a,
      })
    } catch (e) {
      alert('Failed: ' + (e.message || e)); load()
    }
  }

  // Guards
  if (!teacher || assignmentLoading) return <div style={loadingStyle}>Loading your profile…</div>
  if (!classTeacherOf || !branchCode) {
    return (
      <div style={containerStyle}>
        <Link to="/" style={backLinkStyle}>&larr; Back to home</Link>
        <h1 style={titleStyle}>Student Attendance</h1>
        <div style={emptyBoxStyle}>
          <p style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 8 }}>You are not assigned as a class teacher.</p>
          <p style={{ fontSize: 13, color: '#999' }}>Ask the admin to assign you a class through the admin portal.</p>
        </div>
      </div>
    )
  }

  // `students` is already filtered to active-only at load time.
  const presentCount = students.filter(s => attendance[s.id]?.status === 'present' && !attendance[s.id]?.isLate).length
  const lateCount = students.filter(s => attendance[s.id]?.status === 'present' && attendance[s.id]?.isLate).length
  const absentCount = students.filter(s => attendance[s.id]?.status === 'absent').length
  const unmarkedCount = students.length - presentCount - lateCount - absentCount

  return (
    <div style={containerStyle}>
      <Link to="/" style={backLinkStyle}>&larr; Back to home</Link>
      <h1 style={titleStyle}>
        {classTeacherOf} <span style={{ fontSize: 14, color: '#6b6b6b', fontWeight: 400 }}>({branchCode})</span>
      </h1>
      <p style={{ fontSize: 13, color: '#6b6b6b', margin: '0 0 16px' }}>{friendlyDateLabel(selectedDate)}</p>

      <div style={dateBarStyle}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1 }}>
          {lastSevenDays().map(d => {
            const isActiveDate = d === selectedDate
            const sunday = isSunday(d)
            return (
              <button key={d} onClick={() => setSelectedDate(d)} style={{
                padding: '7px 11px', borderRadius: 6,
                border: '1px solid', borderColor: isActiveDate ? '#1a4a2e' : '#d9d6cb',
                background: isActiveDate ? '#1a4a2e' : '#fff',
                color: isActiveDate ? '#fff' : sunday ? '#999' : '#1a4a2e',
                fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                {friendlyDateLabel(d).replace(/\s*\(.*\)/, '')}
              </button>
            )
          })}
        </div>
      </div>

      {isSunday(selectedDate) && (
        <div style={infoBoxStyle}>
          {selectedDate === todayIST()
            ? 'Today is Sunday — no attendance to mark.'
            : 'This was a Sunday — typically no attendance.'}
        </div>
      )}

      {!loading && active.length > 0 && (
        <div style={statsBarStyle}>
          <Chip label="P" count={presentCount} color="#1a4a2e" />
          <Chip label="L" count={lateCount} color="#c9a227" />
          <Chip label="A" count={absentCount} color="#8b1a1a" />
          <Chip label="—" count={unmarkedCount} color="#999" />
        </div>
      )}

      {loading && <div style={loadingStyle}>Loading roster…</div>}
      {error && <div style={errorStyle}>{error}</div>}
      {!loading && students.length === 0 && (
        <div style={emptyBoxStyle}>No students in {classTeacherOf}. Add students via "My Class Students" first.</div>
      )}

      {!loading && students.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {students.map(s => {
            const a = attendance[s.id]
            const currentBtn =
              !a ? 'none' :
              a.status === 'absent' ? 'absent' :
              a.isLate ? 'late' : 'present'
            return (
              <li key={s.id} style={{
                background: '#fff', border: '1px solid #e8e6dc', borderRadius: 7,
                padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  minWidth: 30, height: 30, borderRadius: '50%', background: '#1a4a2e',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 600, fontSize: 12,
                }}>{s.rollNumber}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.fullName}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <BtnLabel label="P" color="#1a4a2e" active={currentBtn === 'present'} onClick={() => mark(s, 'present')} />
                  <BtnLabel label="L" color="#c9a227" active={currentBtn === 'late'}    onClick={() => mark(s, 'late')} />
                  <BtnLabel label="A" color="#8b1a1a" active={currentBtn === 'absent'}  onClick={() => mark(s, 'absent')} />
                  <BtnLabel label="✕" color="#999"    active={false} faded={currentBtn === 'none'} onClick={() => mark(s, 'unmark')} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function BtnLabel({ label, color, active, faded, onClick }) {
  return (
    <button onClick={onClick} disabled={faded} style={{
      width: 30, height: 30, borderRadius: 5, border: '1.5px solid',
      borderColor: active ? color : '#d9d6cb',
      background: active ? color : '#fff',
      color: active ? '#fff' : color,
      fontSize: 13, fontWeight: 700,
      cursor: faded ? 'default' : 'pointer',
      opacity: faded ? 0.25 : 1,
      transition: 'all 0.12s',
    }}>{label}</button>
  )
}

function Chip({ label, count, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', background: '#fff', border: '1px solid #e8e6dc', borderRadius: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 11, color: '#6b6b6b' }}>{label}</span>
      <strong style={{ fontSize: 12 }}>{count}</strong>
    </div>
  )
}

const containerStyle = { maxWidth: 600, margin: '0 auto', padding: '16px 16px 80px' }
const backLinkStyle = { display: 'inline-block', fontSize: 13, color: '#1a4a2e', textDecoration: 'none', marginBottom: 12 }
const titleStyle = { fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 600, color: '#1a4a2e', margin: '0 0 4px' }
const dateBarStyle = { display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto' }
const statsBarStyle = { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }
const loadingStyle = { padding: '32px 16px', textAlign: 'center', color: '#6b6b6b', fontSize: 14 }
const errorStyle = { padding: 10, background: '#fdecec', border: '1px solid #f5c7c7', borderRadius: 6, color: '#8b1a1a', fontSize: 13 }
const infoBoxStyle = { padding: '8px 12px', background: '#fff8e6', border: '1px solid #f0d895', color: '#8a6d18', borderRadius: 6, fontSize: 13, marginBottom: 12 }
const emptyBoxStyle = { background: '#fff', border: '1px solid #e8e6dc', borderRadius: 8, padding: 20, marginTop: 12, textAlign: 'center' }
