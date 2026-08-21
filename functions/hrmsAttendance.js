'use strict'
// =============================================================================
// functions/hrmsAttendance.js — live HRMS staff attendance for the Tracker
//
// getHrmsDayAttendance (callable): given a date, returns each active HRMS
// employee's attendance state so Tracker screens (Lesson Log heatmap) can
// explain a missing lesson log with "Absent per HRMS" instead of an
// undifferentiated gap.
//
// WHY A CALLABLE AND NOT A SYNC
// -----------------------------
// "Absent" is NOT a stored status in HRMS — attendance_daily only has rows
// for people who punched (status 'present') or were marked on leave
// ('school_leave'). Absence is the ABSENCE of a row on a working day, so a
// row-level webhook can never announce it; and a cron mirror would go stale
// the moment a late teacher punches in. A live query is both simpler and
// always current. The HRMS service-role key stays server-side here (same
// reasoning as socialAccessSync.js — anything in a browser bundle is public).
//
// JOIN KEY: Firestore `teachers` docs carry `hrmsEmployeeId` = HRMS
// employees.id (kept in sync by HRMS's sync-employee-to-firestore webhook),
// so the client joins on that — no name/phone matching anywhere.
//
// STAFF-HOLIDAY GUARD: teachers attend on many STUDENT holidays (result
// days, PTMs), so no calendar is trusted. Instead the day self-calibrates:
// if almost nobody punched, it's a staff holiday and nobody is "absent".
// =============================================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { getFirestore } = require('firebase-admin/firestore')
const { createClient } = require('@supabase/supabase-js')

const HRMS_SUPABASE_URL = 'https://yegxwxutdalmdubrozrm.supabase.co'
const HRMS_SERVICE_ROLE_KEY = defineSecret('HRMS_SERVICE_ROLE_KEY')

// Mirror of the App.jsx auth model: hardcoded super admin, else an active
// admins/{email} (or admins/{uid} for phone-only admins) doc with the
// tracker module (legacy docs missing `modules` default to full access).
const SUPER_ADMIN_EMAIL = 'adwit@rkacademyballia.in'

async function assertTrackerAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
  const email = (request.auth.token?.email || '').toLowerCase()
  if (email === SUPER_ADMIN_EMAIL) return
  const db = getFirestore()
  let snap = email ? await db.collection('admins').doc(email).get() : null
  if (!snap?.exists && request.auth.uid) {
    snap = await db.collection('admins').doc(request.auth.uid).get()
  }
  if (!snap?.exists) throw new HttpsError('permission-denied', 'Not an admin.')
  const data = snap.data()
  if (data.isActive === false) throw new HttpsError('permission-denied', 'Access deactivated.')
  const modules = Array.isArray(data.modules) && data.modules.length > 0
    ? data.modules : ['tracker', 'hrms']
  if (!modules.includes('tracker')) throw new HttpsError('permission-denied', 'No tracker access.')
}

exports.getHrmsDayAttendance = onCall({ secrets: [HRMS_SERVICE_ROLE_KEY] }, async (request) => {
  await assertTrackerAdmin(request)

  const date = String(request.data?.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD')
  }

  const supabase = createClient(HRMS_SUPABASE_URL, HRMS_SERVICE_ROLE_KEY.value(), {
    auth: { persistSession: false },
  })
  const [emp, att] = await Promise.all([
    supabase.from('employees')
      .select('id, full_name, attendance_exempt')
      .eq('is_active', true),
    supabase.from('attendance_daily')
      .select('employee_id, status, in_time, late_minutes, is_holiday')
      .eq('date', date),
  ])
  if (emp.error) throw new HttpsError('internal', 'HRMS employees query failed: ' + emp.error.message)
  if (att.error) throw new HttpsError('internal', 'HRMS attendance query failed: ' + att.error.message)

  const rowByEmp = new Map((att.data ?? []).map((r) => [r.employee_id, r]))
  const countable = (emp.data ?? []).filter((e) => !e.attendance_exempt)
  const presentCount = countable.filter((e) => rowByEmp.get(e.id)?.status === 'present').length
  // Self-calibrating staff-holiday guard: a day where under a quarter of the
  // active staff punched (floor 10) is not a working day — flag nobody.
  const staffDayActive = presentCount >= Math.max(10, Math.round(countable.length * 0.25))

  // status: 'present' | 'leave' (any non-present attendance row, e.g.
  // school_leave) | 'no_punch' (no row at all) | 'exempt'
  const byEmployee = {}
  for (const e of emp.data ?? []) {
    const row = rowByEmp.get(e.id)
    byEmployee[e.id] = {
      status: e.attendance_exempt ? 'exempt'
        : row ? (row.status === 'present' ? 'present' : 'leave')
        : 'no_punch',
      rawStatus: row?.status ?? null,
      in: row?.in_time ?? null,
      late: Number(row?.late_minutes || 0),
    }
  }

  return { date, staffDayActive, activeStaff: countable.length, presentCount, byEmployee }
})
