// =========================================================================
// studentAudit.js — helpers to write entries to the studentAudit collection
//
// Schema per audit doc:
//   studentId         — Firestore doc ID
//   studentName       — captured at time of action (in case student renamed later)
//   className         — at time of action
//   branchCode        — at time of action
//   action            — 'add' | 'edit' | 'withdraw' | 'reactivate' | 'transfer' |
//                       'delete' | 'csv_import'
//   changedFields     — only for edits/transfers, { field: { from, to } }
//   notes             — free-form context (e.g. CSV batch ID)
//   performedBy       — teacher doc ID (or email if admin)
//   performedByName   — display name
//   performedByRole   — 'admin' | 'class_teacher'
//   performedAt       — server timestamp
// =========================================================================

import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

// performedBy is the auth user object (admin email) or a teacher object
// role is the string 'admin' | 'class_teacher'
export async function writeStudentAudit({
  student,                 // { id, fullName, className, branchCode } at time of action
  action,                  // string
  changedFields = null,    // object or null
  notes = null,            // string or null
  performedBy,             // string (email or teacher id)
  performedByName,         // string
  performedByRole,         // 'admin' | 'class_teacher'
}) {
  try {
    await addDoc(collection(db, 'studentAudit'), {
      studentId: student.id,
      studentName: student.fullName || '(unknown)',
      className: student.className || '(unknown)',
      branchCode: student.branchCode || '(unknown)',
      action,
      changedFields: changedFields || null,
      notes: notes || null,
      performedBy,
      performedByName,
      performedByRole,
      performedAt: serverTimestamp(),
    })
  } catch (e) {
    // Auditing should never block the user's primary action — log and move on.
    console.error('studentAudit write failed:', e)
  }
}

// Diff two flat objects, return { changedFields, hasChanges }
export function diffStudent(before, after, fieldsToTrack) {
  const changedFields = {}
  let hasChanges = false
  for (const f of fieldsToTrack) {
    const a = before?.[f]
    const b = after?.[f]
    // Treat null/undefined/'' as equivalent so we don't log noise
    const eq = (x, y) => (x === y) || ((x === null || x === undefined || x === '') && (y === null || y === undefined || y === ''))
    if (!eq(a, b)) {
      changedFields[f] = { from: a ?? null, to: b ?? null }
      hasChanges = true
    }
  }
  return { changedFields, hasChanges }
}
