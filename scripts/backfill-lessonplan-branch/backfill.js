#!/usr/bin/env node
/*
 * backfill-lessonplan-branch
 * --------------------------
 * Stamps branchCode on any lessonPlans doc that lacks it, resolving each
 * doc's own teacher (teachers/{teacherId}.branchCodes[0]) — the same rule
 * the teacher app and the stampLessonPlanBranch trigger use.
 *
 * WHY: branch-scoped admins query lessonPlans with where('branchCode','==',…);
 * Firestore cannot match a missing field, so unstamped plans are invisible to
 * them (while the super admin's unfiltered view still shows them). Plans
 * written by pre-v91 teacher-app builds lack the field.
 *
 * Idempotent and read-only for stamped docs. Run with --dry-run first.
 *
 * USAGE:
 *   NODE_PATH=../../functions/node_modules node backfill.js [--dry-run]
 *   (service account: ~/.config/rka-academic-tracker/service-account.json)
 */

const admin = require('firebase-admin')
const os = require('os')
const path = require('path')

const DRY = process.argv.includes('--dry-run')
const SA = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(os.homedir(), '.config/rka-academic-tracker/service-account.json')

admin.initializeApp({ credential: admin.credential.cert(require(SA)) })
const db = admin.firestore()

async function main() {
  const snap = await db.collection('lessonPlans').get()
  const missing = snap.docs.filter(d => d.data().branchCode == null)
  console.log(`lessonPlans total=${snap.size}  missing-branchCode=${missing.length}`)

  const teacherCache = new Map()
  async function branchForTeacher(teacherId) {
    if (!teacherId) return null
    if (teacherCache.has(teacherId)) return teacherCache.get(teacherId)
    const t = await db.doc(`teachers/${teacherId}`).get()
    const b = t.exists ? (t.data().branchCodes?.[0] || t.data().branchCode || null) : null
    teacherCache.set(teacherId, b)
    return b
  }

  let fixed = 0
  for (const d of missing) {
    const x = d.data()
    const branchCode = (await branchForTeacher(x.teacherId)) || 'MAIN'
    console.log(`${DRY ? '[dry] ' : ''}${d.id}  ${x.teacherName || x.teacherId} · ${x.className}/${x.subject} · ${x.dateStr}  → ${branchCode}`)
    if (!DRY) {
      await d.ref.update({ branchCode, branchCodeStampedBy: 'backfill' })
      fixed++
    }
  }
  console.log(DRY ? '\n--dry-run: nothing written.' : `\n✅ stamped ${fixed} doc(s).`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1) })
