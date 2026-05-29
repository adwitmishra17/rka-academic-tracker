// ============================================================================
// admin/src/lib/api.js
//
// Thin wrapper around fetch that:
//   1. Reads the current Firebase Auth user's ID token (refreshing if stale)
//   2. Attaches it as `Authorization: Bearer <token>` on every request
//   3. Returns parsed JSON or throws with the server's error message
//
// Used by pages that read from the SMS Supabase via admin/server.js.
// Same-origin in prod; Vite proxies /api/* to localhost:3000 in dev.
// ============================================================================

import { auth } from '../firebase/config'

async function authHeader() {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  // forceRefresh = false; firebase-js auto-refreshes when the token is within
  // 5 minutes of expiry. Pass true if you ever see persistent 401s.
  const token = await user.getIdToken(false)
  return { Authorization: `Bearer ${token}` }
}

async function parseOrThrow(res) {
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = body?.error || `HTTP ${res.status} ${res.statusText}`
    const err = new Error(msg)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

export async function apiGet(path, params) {
  const url = params
    ? `${path}?${new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
      )}`
    : path
  const res = await fetch(url, { headers: { ...(await authHeader()) } })
  return parseOrThrow(res)
}

export async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body || {}),
  })
  return parseOrThrow(res)
}

/**
 * fetchStudents — multi-branch fan-out helper.
 *
 * Mirrors what `branchConstraints('branchCode', effectiveBranches)` did against
 * Firestore: callers pass the array of branches the current admin can see and
 * get back one merged list of students. Server-side, /api/students takes a
 * single branchCode at a time, so multi-branch queries fan out in parallel.
 *
 * Usage:
 *   const students = await fetchStudents({ branchCodes: effectiveBranches })
 *   const class5   = await fetchStudents({ branchCodes: ['MAIN'], className: 'Class 5' })
 */
export async function fetchStudents({ branchCodes, className, isActive } = {}) {
  if (!branchCodes || branchCodes.length === 0) return []
  const params = { className, isActive: isActive === undefined ? undefined : String(isActive) }
  if (branchCodes.length === 1) {
    const { students } = await apiGet('/api/students', { branchCode: branchCodes[0], ...params })
    return students
  }
  const results = await Promise.all(
    branchCodes.map(b => apiGet('/api/students', { branchCode: b, ...params }))
  )
  return results.flatMap(r => r.students)
}

// ── Exam / report-card helpers (read SMS Supabase via the server) ──
export const examApi = {
  sessions:           ()                                  => apiGet('/api/exam/sessions'),
  terms:              (branchCode, sessionCode)           => apiGet('/api/exam/terms', { branchCode, sessionCode }),
  reportCardStudents: (branchCode, className, section)    => apiGet('/api/exam/report-card-students', { branchCode, className, section }),
  reportCard:         (studentId, sessionCode)            => apiGet('/api/exam/report-card', { studentId, sessionCode }),
}
