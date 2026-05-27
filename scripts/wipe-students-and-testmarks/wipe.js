#!/usr/bin/env node
/**
 * RKA Academic Tracker — Wipe Firestore students + testMarks
 *
 * One-off cleanup script run AFTER the Tracker pivots to reading students
 * from the SMS Supabase database (see admin/server.js → /api/students).
 *
 * Drops every document from:
 *   • students    — superseded by SMS Supabase public.students
 *   • testMarks   — old marks pipeline (the new exam_marks lives in Supabase too)
 *
 * Does NOT touch:
 *   • tests, lessons, lessonPlans, studentAttendance, attendanceAudit,
 *     studentAudit, studentProfiles, examMarks, examCoschGrades,
 *     hpcAssessments, examSubjects, examTerms, examSessions, examPapers,
 *     teachers, classes, timetable, settings, syllabus, syllabusDocuments,
 *     missedLessonAlerts, studentAlerts, arrangements, attendance_events,
 *     classTeacherByEmail, admins
 *
 * Usage:
 *   npm install                              (first run only)
 *   npm run dry                              (count rows, no writes)
 *   npm run wipe                             (actually delete)
 *
 * Or directly:
 *   node wipe.js --dry-run                   (no writes, just counts)
 *   node wipe.js --confirm                   (actually delete — required)
 *   node wipe.js --confirm --only=students   (wipe one collection only)
 *
 * Service account: defaults to
 *   ~/.config/rka-academic-tracker/service-account.json
 * Override with env:
 *   SERVICE_ACCOUNT=/path/to/key.json node wipe.js --confirm
 */

const admin = require('firebase-admin')
const path  = require('path')
const fs    = require('fs')
const os    = require('os')

// ── Config ────────────────────────────────────────────────────────────────
const DEFAULT_SA_PATH = path.join(
  os.homedir(),
  '.config', 'rka-academic-tracker', 'service-account.json',
)
const SA_PATH    = process.env.SERVICE_ACCOUNT || DEFAULT_SA_PATH
const BATCH_SIZE = 400   // Firestore batch limit is 500; leave room for safety
const COLLECTIONS = ['students', 'testMarks']

// ── CLI args ──────────────────────────────────────────────────────────────
const args        = process.argv.slice(2)
const isDryRun    = args.includes('--dry-run') || args.includes('-n')
const isConfirmed = args.includes('--confirm') || args.includes('-y')
const onlyArg     = args.find(a => a.startsWith('--only='))
const targets     = onlyArg
  ? [onlyArg.split('=')[1]].filter(c => COLLECTIONS.includes(c))
  : COLLECTIONS

if (!isDryRun && !isConfirmed) {
  console.error('❌ Refusing to run without --confirm. Use --dry-run to preview, or --confirm to actually delete.')
  process.exit(1)
}
if (targets.length === 0) {
  console.error(`❌ --only must be one of: ${COLLECTIONS.join(', ')}`)
  process.exit(1)
}

// ── Service account check ─────────────────────────────────────────────────
if (!fs.existsSync(SA_PATH)) {
  console.error(`❌ Service account file not found at ${SA_PATH}`)
  console.error('   Either place it there or set SERVICE_ACCOUNT=/path/to/key.json')
  process.exit(1)
}
const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()
console.log(`✔  Connected to project: ${serviceAccount.project_id}`)
console.log(`   Mode:        ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE — deletions WILL happen'}`)
console.log(`   Collections: ${targets.join(', ')}`)
console.log('')

// ── Delete a single collection in batches ─────────────────────────────────
async function processCollection(name) {
  const collRef = db.collection(name)
  let totalDeleted = 0
  let batchNum    = 0

  // First pass: count (so we know what we're about to do)
  if (isDryRun) {
    let counted = 0
    let snap = await collRef.limit(BATCH_SIZE).get()
    while (!snap.empty) {
      counted += snap.size
      const last = snap.docs[snap.docs.length - 1]
      snap = await collRef.startAfter(last).limit(BATCH_SIZE).get()
    }
    console.log(`📊 ${name}: ${counted} document(s) would be deleted`)
    return counted
  }

  // Live mode: delete in batches until empty
  console.log(`🗑  ${name}: deleting…`)
  while (true) {
    const snap = await collRef.limit(BATCH_SIZE).get()
    if (snap.empty) break
    const batch = db.batch()
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    batchNum     += 1
    totalDeleted += snap.size
    console.log(`   batch ${batchNum.toString().padStart(3)}: -${snap.size}  (running total: ${totalDeleted})`)
  }
  console.log(`✅ ${name}: deleted ${totalDeleted} document(s)`)
  return totalDeleted
}

// ── Run ───────────────────────────────────────────────────────────────────
;(async () => {
  if (!isDryRun) {
    // Grace period — last chance to ctrl-C
    console.log('⚠️  Starting in 5 seconds. Press Ctrl+C to abort.')
    await new Promise(r => setTimeout(r, 5000))
    console.log('')
  }
  const start = Date.now()
  let grand = 0
  for (const c of targets) {
    grand += await processCollection(c)
    console.log('')
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`────────────────────────────────────────────────────`)
  console.log(`${isDryRun ? 'Would delete' : 'Deleted'} ${grand} document(s) total in ${secs}s.`)
  process.exit(0)
})().catch(e => {
  console.error('❌ Wipe failed:', e)
  process.exit(1)
})
