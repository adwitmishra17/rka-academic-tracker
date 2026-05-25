// =========================================================================
// attendanceAudit.js — writes append-only audit entries for attendance changes
//
// Schema per doc:
//   attendanceDocId   — '{date}_{studentId}' (the studentAttendance doc this concerns)
//   studentId, studentName, rollNumber, className, branchCode, date  (snapshot)
//   action            — 'mark' | 'edit' | 'unmark'
//   before            — { status, isLate } | null  (null on first mark)
//   after             — { status, isLate } | null  (null on unmark)
//   performedBy       — user id (teacher doc id or admin email)
//   performedByName   — display name
//   performedByRole   — 'admin' | 'class_teacher'
//   performedAt       — server timestamp
// =========================================================================

import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

export async function writeAttendanceAudit({
  attendanceDocId,
  student,              // { id, fullName, rollNumber, className, branchCode } snapshot
  date,
  action,               // 'mark' | 'edit' | 'unmark'
  before = null,        // { status, isLate } | null
  after = null,         // { status, isLate } | null
  performedBy,
  performedByName,
  performedByRole,
}) {
  try {
    await addDoc(collection(db, 'attendanceAudit'), {
      attendanceDocId,
      studentId: student.id,
      studentName: student.fullName || '(unknown)',
      rollNumber: student.rollNumber || null,
      className: student.className || '(unknown)',
      branchCode: student.branchCode || '(unknown)',
      date,
      action,
      before: before || null,
      after: after || null,
      performedBy, performedByName, performedByRole,
      performedAt: serverTimestamp(),
    })
  } catch (e) {
    // Don't block primary action on audit failure
    console.error('attendanceAudit write failed:', e)
  }
}
