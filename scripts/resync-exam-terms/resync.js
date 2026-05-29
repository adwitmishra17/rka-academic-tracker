#!/usr/bin/env node
/**
 * RKA Academic Tracker — Re-sync examTerms
 *
 * One-off backfill. Touches every Firestore `examTerms` document (writes a
 * `_resyncedAt` timestamp) so the deployed `syncExamTerms` Cloud Function
 * fires for each one and upserts the term into Supabase `exam_terms`.
 *
 * WHY THIS MATTERS: `exam_papers.term_id` is a UUID FK to `exam_terms`. Until a
 * term exists in Supabase, the teacher PWA term picker is empty and no paper or
 * mark can be created for that term. examTerms docs written BEFORE syncExamTerms
 * was deployed never reached Supabase — this script backfills them.
 *
 * Run this AFTER:
 *   firebase deploy --only functions:tracker-sync   (with the new syncExamTerms)
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
  console.log(`   Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE — will touch every examTerms doc'}`)
  console.log('')

  const snap = await db.collection('examTerms').get()
  console.log(`Found ${snap.size} examTerms document(s).`)

  // The Cloud Function needs branchCode, sessionCode and shortCode to build the
  // Supabase row (branchCode resolves to branch_id; the others are columns).
  // A doc missing any of these will be SKIPPED by syncExamTerms — surface that.
  const bySession = {}
  let incomplete = 0
  snap.forEach(d => {
    const t = d.data()
    if (!t.branchCode || !t.sessionCode || !t.shortCode) incomplete++
    const key = `${t.branchCode || '?'} / ${t.sessionCode || '?'}`
    bySession[key] = (bySession[key] || 0) + 1
  })
  console.log('   Terms per (branch / session):')
  Object.entries(bySession)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([k, n]) => console.log(`     ${k}: ${n}`))
  if (incomplete > 0) {
    console.log(`   ⚠️  ${incomplete} doc(s) missing branchCode/sessionCode/shortCode — these will be skipped by syncExamTerms.`)
  }
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
  console.log(`✅ Touched ${touched} doc(s). The syncExamTerms Cloud Function is now`)
  console.log('   firing for each — check its logs:')
  console.log('     firebase functions:log --only syncExamTerms --lines 50')
  console.log('   Look for "syncExamTerms ok: <branch>_<session>_<shortCode>" on each line.')
  process.exit(0)
})().catch(e => {
  console.error('❌ Re-sync failed:', e)
  process.exit(1)
})
