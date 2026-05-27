// =========================================================================
// AttendanceClass.jsx — admin's per-class attendance marking page
//
// Route: /attendance/:className/:branchCode
//
// Admin can mark attendance for any class, any date. The 7-day edit window
// does not apply to admins — they can edit any past date.
// =========================================================================

import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection, query, where, getDocs, doc, setDoc, deleteDoc, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { fetchStudents } from '../lib/api'
import { writeAttendanceAudit } from '../lib/attendanceAudit'
import { todayIST, lastSevenDays, friendlyDateLabel, isSunday } from '../lib/attendanceDates'

// We snapshot only one studentAttendance doc per (date, studentId).
function docIdFor(date, studentId) { return `${date}_${studentId}` }

export default function AttendanceClass() {
  const { className, branchCode } = useParams()
  const decodedClassName = decodeURIComponent(className)
  const navigate = useNavigate()
  const { user } = useAuth()

  const [selectedDate, setSelectedDate] = useState(todayIST())
  const [students, setStudents] = useState([])
  const [attendance, setAttendance] = useState({})   // studentId -> { status, isLate, docId }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Load both roster and existing attendance for the selected date
  async function load() {
    setLoading(true); setError('')
    try {
      // Roster — class + branch, both active and inactive (for withdrawn notation).
      // Sourced from SMS Supabase via /api/students.
      const roster = await fetchStudents({
        branchCodes: [branchCode],
        className:   decodedClassName,
      })
      const studentList = roster.sort((a, b) => {
        // Active first, then by roll number
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return Number(a.rollNumber || 0) - Number(b.rollNumber || 0)
      })
      setStudents(studentList)

      // Attendance for this date — could use a single query, but doc IDs are
      // deterministic so we fetch them directly. (Single query is more efficient
      // for the common case where most students have docs.)
      const attSnap = await getDocs(query(
        collection(db, 'studentAttendance'),
        where('className', '==', decodedClassName),
        where('branchCode', '==', branchCode),
        where('date', '==', selectedDate),
      ))
      const attMap = {}
      attSnap.forEach(d => {
        const x = d.data()
        attMap[x.studentId] = { status: x.status, isLate: x.isLate, docId: d.id }
      })
      setAttendance(attMap)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [decodedClassName, branchCode, selectedDate])

  function actor() {
    return {
      performedBy: user?.email || 'unknown',
      performedByName: user?.email === 'adwit@rkacademyballia.in' ? 'Adwit (Super Admin)' : (user?.email || 'admin'),
      performedByRole: 'admin',
    }
  }

  // Mark / edit / unmark a single student
  async function mark(student, target /* 'present' | 'late' | 'absent' | 'unmark' */) {
    const docId = docIdFor(selectedDate, student.id)
    const before = attendance[student.id] || null
    const ref = doc(db, 'studentAttendance', docId)

    if (target === 'unmark') {
      if (!before) return   // nothing to unmark
      // Optimistic UI
      setAttendance(prev => { const next = { ...prev }; delete next[student.id]; return next })
      try {
        await deleteDoc(ref)
        await writeAttendanceAudit({
          attendanceDocId: docId,
          student: { ...student, branchCode, className: decodedClassName },
          date: selectedDate,
          action: 'unmark',
          before: { status: before.status, isLate: before.isLate },
          after: null,
          ...actor(),
        })
      } catch (e) {
        console.error('Unmark failed:', e)
        load()   // revert via reload
      }
      return
    }

    // target is present | late | absent
    const newState = target === 'absent'
      ? { status: 'absent', isLate: false }
      : { status: 'present', isLate: target === 'late' }

    // Optimistic UI
    setAttendance(prev => ({ ...prev, [student.id]: { ...newState, docId } }))

    try {
      const action = before ? 'edit' : 'mark'
      const payload = {
        studentId: student.id,
        studentName: student.fullName || '',
        rollNumber: student.rollNumber || '',
        className: decodedClassName,
        branchCode,
        date: selectedDate,
        ...newState,
        markedBy: actor().performedBy,
        markedByName: actor().performedByName,
        markedByRole: 'admin',
        markedAt: before?.markedAt || Timestamp.now(),
        editedAt: before ? Timestamp.now() : null,
        editedBy: before ? actor().performedBy : null,
      }
      await setDoc(ref, payload)
      await writeAttendanceAudit({
        attendanceDocId: docId,
        student: { ...student, branchCode, className: decodedClassName },
        date: selectedDate,
        action,
        before: before ? { status: before.status, isLate: before.isLate } : null,
        after: newState,
        ...actor(),
      })
    } catch (e) {
      console.error('Mark failed:', e)
      load()
    }
  }

  // Stats
  const active = students.filter(s => s.isActive !== false)
  const presentCount = active.filter(s => attendance[s.id]?.status === 'present' && !attendance[s.id]?.isLate).length
  const lateCount    = active.filter(s => attendance[s.id]?.status === 'present' && attendance[s.id]?.isLate).length
  const absentCount  = active.filter(s => attendance[s.id]?.status === 'absent').length
  const unmarkedCount = active.length - presentCount - lateCount - absentCount

  return (
    <div style={{ padding: '32px 36px', maxWidth: 900 }}>
      <button onClick={() => navigate('/attendance')} style={backLinkStyle}>← Back to overview</button>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600,
          color: 'var(--green-dark)', margin: '0 0 4px',
        }}>
          {decodedClassName} <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>({branchCode})</span>
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{friendlyDateLabel(selectedDate)}</p>
      </div>

      {/* Date picker */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Date</label>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--white)' }}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          As admin you can mark any date.
        </div>
      </div>

      {isSunday(selectedDate) && (
        <div style={infoBoxStyle}>
          Sunday — no school. You can still mark exceptional working Sundays if needed.
        </div>
      )}

      {/* Stats bar */}
      {!loading && active.length > 0 && (
        <div style={statsBarStyle}>
          <StatChip label="Present" count={presentCount} color="var(--green)" />
          <StatChip label="Late"    count={lateCount}    color="#c9a227" />
          <StatChip label="Absent"  count={absentCount}  color="var(--crimson)" />
          <StatChip label="Unmarked" count={unmarkedCount} color="var(--text-muted)" />
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{active.length} active students</div>
        </div>
      )}

      {loading && <div style={loadingStyle}>Loading roster…</div>}
      {error && <div style={errorStyle}>{error}</div>}

      {!loading && students.length === 0 && (
        <div style={emptyStyle}>No students in {decodedClassName} {branchCode}.</div>
      )}

      {!loading && students.length > 0 && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {students.map((s, i) => {
            const a = attendance[s.id]
            const isWithdrawn = s.isActive === false
            const currentBtn =
              !a ? 'none' :
              a.status === 'absent' ? 'absent' :
              a.isLate ? 'late' : 'present'
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                borderBottom: i < students.length - 1 ? '1px solid var(--gray-100)' : 'none',
                opacity: isWithdrawn ? 0.5 : 1,
                background: isWithdrawn ? 'var(--gray-50)' : 'transparent',
              }}>
                <div style={{
                  minWidth: 32, height: 32, borderRadius: '50%', background: 'var(--green-dark)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 600, fontSize: 12, flexShrink: 0,
                }}>{s.rollNumber}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.fullName}
                    {isWithdrawn && <span style={{ fontSize: 10, marginLeft: 8, color: 'var(--crimson)', fontWeight: 600 }}>(withdrawn)</span>}
                  </div>
                </div>
                {!isWithdrawn && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <BtnLabel label="P" color="var(--green)"   active={currentBtn === 'present'} onClick={() => mark(s, 'present')} />
                    <BtnLabel label="L" color="#c9a227"        active={currentBtn === 'late'}    onClick={() => mark(s, 'late')} />
                    <BtnLabel label="A" color="var(--crimson)" active={currentBtn === 'absent'}  onClick={() => mark(s, 'absent')} />
                    <BtnLabel label="✕" color="var(--text-muted)" active={false} faded={currentBtn === 'none'} onClick={() => mark(s, 'unmark')} title="Clear" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BtnLabel({ label, color, active, faded, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={faded}
      style={{
        width: 34, height: 34, borderRadius: 'var(--radius-sm)',
        border: '1.5px solid',
        borderColor: active ? color : 'var(--gray-200)',
        background: active ? color : 'var(--white)',
        color: active ? '#fff' : color,
        fontSize: 14, fontWeight: 700,
        cursor: faded ? 'default' : 'pointer',
        opacity: faded ? 0.3 : 1,
        transition: 'all 0.12s',
      }}
    >{label}</button>
  )
}

function StatChip({ label, count, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 14 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <strong style={{ fontSize: 13, color: 'var(--text)' }}>{count}</strong>
    </div>
  )
}

const backLinkStyle = { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, marginBottom: 12, padding: 0 }
const statsBarStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', marginBottom: 14, flexWrap: 'wrap' }
const loadingStyle = { padding: 32, textAlign: 'center', color: 'var(--text-muted)' }
const errorStyle = { padding: 12, background: 'var(--crimson-light)', color: 'var(--crimson)', borderRadius: 'var(--radius-sm)' }
const emptyStyle = { padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)' }
const infoBoxStyle = { padding: '10px 14px', background: '#fff8e6', border: '1px solid #f0d895', color: '#8a6d18', borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 14 }
