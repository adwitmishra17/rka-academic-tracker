#!/usr/bin/env node
/**
 * RKA Academic Tracker — Re-sync examSubjects
 *
 * One-off backfill. Touches every Firestore `examSubjects` document (writes a
 * `_resyncedAt` timestamp) so the deployed `syncExamSubjects` Cloud Function
 * re-fires for each one. The updated function resolves the assigned teacher's
 * email and writes it to Supabase `exam_subjects.assigned_teacher_email`,
 * which the teacher PWA filters on.
 *
 * Run this AFTER:
 *   1. ALTER TABLE exam_subjects ADD COLUMN IF NOT EXISTS assigned_teacher_email TEXT;
 *   2. firebase deploy --only functions (with the updated syncExamSubjects)
 *
 * This script only needs Firebase access — the Cloud Function does the actual
 * Supabase write, so no Supabase credentials are needed here.
 *
 * Usage:
 *   npm install
 *   npm run dry        # count docs, no writes
 *   npm run resync     # touch every doc (triggers re-sync)
 *
 * Service account: defaults to
 *   ~/.config/rka-academic-tracker/service-account.json
 * Override with env: SERVICE_ACCOUNT=/path/to/key.json node resync.js --confirm
 */

const admin = require('firebase-admin')
const path  = require('path')
const fs    = require('fs')
const os    = require('os')

const DEFAULT_SA_PATH = path.join(os.homedir(), '.config', 'rka-academic-tracker', 'service-account.json')
const SA_PATH    = process.env.SERVICE_ACCOUNT || DEFAULT_SA_PATH
const BATCH_SIZE = 400

const args        = process.argv.slice(2)
const isDryRun    = args.includes('--dry-run') || args.includes('-n')
const isConfirmed = args.includes('--confirm') || args.includes('-y')

if (!isDryRun && !isConfirmed) {
  console.error('❌ Refusing to run without --confirm. Use --dry-run to preview, or --confirm to touch docs.')
  process.exit(1)
}
if (!fs.existsSync(SA_PATH)) {
  console.error(`❌ Service account file not found at ${SA_PATH}`)
  console.error('   Set SERVICE_ACCOUNT=/path/to/key.json or place the file there.')
  process.exit(1)
}

const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

;(async () => {
  console.log(`✔  Connected to project: ${serviceAccount.project_id}`)
  console.log(`   Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE — will touch every examSubjects doc'}`)
  console.log('')

  const snap = await db.collection('examSubjects').get()
  console.log(`Found ${snap.size} examSubjects document(s).`)

  // Quick visibility into how many have a teacher assigned at all — subjects
  // with no assignedTeacherId will sync with assigned_teacher_email = null and
  // therefore still won't appear for any teacher (expected).
  let withTeacher = 0, withoutTeacher = 0
  snap.forEach(d => { (d.data().assignedTeacherId ? withTeacher++ : withoutTeacher++) })
  console.log(`   ${withTeacher} have an assigned teacher · ${withoutTeacher} have none`)
  console.log('')

  if (isDryRun) {
    console.log('Dry run — no docs touched. Re-run with --confirm to backfill.')
    process.exit(0)
  }

  console.log('⚠️  Touching docs in 5 seconds. Press Ctrl+C to abort.')
  await new Promise(r => setTimeout(r, 5000))

  let touched = 0
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    const slice = docs.slice(i, i + BATCH_SIZE)
    slice.forEach(d => batch.update(d.ref, { _resyncedAt: admin.firestore.FieldValue.serverTimestamp() }))
    await batch.commit()
    touched += slice.length
    console.log(`   touched ${touched}/${docs.length}`)
  }

  console.log('')
  console.log(`✅ Touched ${touched} doc(s). The syncExamSubjects Cloud Function is now`)
  console.log('   re-firing for each — check its logs:')
  console.log('     firebase functions:log --only syncExamSubjects --lines 50')
  console.log('   Look for "teacher=<email>" on each line.')
  process.exit(0)
})().catch(e => {
  console.error('❌ Re-sync failed:', e)
  process.exit(1)
})
