#!/usr/bin/env node
/**
 * RKA Academic Tracker — Lesson slotId backfill
 *
 * One-off script. Stamps slotId, offSchedule, and coveringFor on existing
 * lesson docs that pre-date the LogLesson v2 rewrite (RKA_Teacher v41+).
 *
 * Match logic for each lesson without slotId:
 *   slot.day === weekday(lesson.date)
 *   slot.teacherId === lesson.teacherId    (fallback: teacherName match)
 *   lesson.className === slot.className OR slot.classNames.includes(...)
 *   Number(slot.period) === Number(lesson.period)
 *
 * Matched   → slotId: <slot.id>, offSchedule: false, coveringFor: null
 * Unmatched → slotId: null,      offSchedule: false, coveringFor: null
 *
 * The presence of all three fields = "processed by backfill" so the new
 * LogLesson rule (offSchedule: true ↔ intentional) stays unambiguous:
 *   slotId set        → matched lesson
 *   slotId null + offSchedule false → unmatched legacy
 *   slotId null + offSchedule true  → intentional off-schedule
 *
 * Idempotent: lessons that already have slotId set get skipped (only their
 * missing offSchedule/coveringFor are filled in if absent).
 *
 * Usage:
 *   node backfill_slot_id.js --dry-run        (no writes, just stats)
 *   node backfill_slot_id.js                  (writes, with 5s grace period)
 *   node backfill_slot_id.js --limit=100      (cap how many to process)
 *
 * Service account: defaults to
 *   /Users/adwitsdocs/Downloads/rka-academic-tracker-firebase-adminsdk-fbsvc-6996f7ee66.json
 * Override with env: SERVICE_ACCOUNT=/path/to/key.json node backfill_slot_id.js
 */

const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

// ---- config ---------------------------------------------------------------
const SERVICE_ACCOUNT = path.resolve(
  process.env.SERVICE_ACCOUNT ||
  '/Users/adwitsdocs/Downloads/rka-academic-tracker-firebase-adminsdk-fbsvc-6996f7ee66.json'
)
const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = (() => {
  const arg = process.argv.find(a => a.startsWith('--limit='))
  return arg ? parseInt(arg.split('=')[1], 10) : Infinity
})()
const BATCH_SIZE = 400

if (!fs.existsSync(SERVICE_ACCOUNT)) {
  console.error(`\n❌ Service account file not found:\n   ${SERVICE_ACCOUNT}\n`)
  console.error(`Set env SERVICE_ACCOUNT=/path/to/key.json or update the default.`)
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
})
const db = admin.firestore()

// ---- helpers --------------------------------------------------------------
const DAYS_OF_WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function weekdayFromDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr + 'T00:00:00')
    if (Number.isNaN(d.getTime())) return ''
    return DAYS_OF_WEEK[d.getDay()]
  } catch { return '' }
}

function norm(str) {
  return (str || '').toString().toLowerCase().trim()
}

// ---- main -----------------------------------------------------------------
async function main() {
  const banner = DRY_RUN ? '(DRY RUN — no writes)' : ''
  console.log(`\n=== Lesson slotId backfill ${banner} ===\n`)

  // Load timetable
  console.log('Loading timetable...')
  const ttSnap = await db.collection('timetable').get()
  const allSlots = ttSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`  ${allSlots.length} timetable slots`)

  // Index slots by (day | period | className) for fast lookup. Combined
  // slots are indexed under each of their classNames.
  const slotIndex = new Map()
  function add(key, slot) {
    if (!slotIndex.has(key)) slotIndex.set(key, [])
    slotIndex.get(key).push(slot)
  }
  allSlots.forEach(s => {
    if (!s.day || !s.period) return
    const period = Number(s.period)
    const classes = Array.isArray(s.classNames) && s.classNames.length
      ? s.classNames.filter(Boolean)
      : (s.className ? [s.className] : [])
    classes.forEach(cls => {
      const c = (cls || '').trim()
      if (!c) return
      add(`${s.day}|${period}|${c}`, s)
    })
  })
  console.log(`  ${slotIndex.size} (day|period|class) keys indexed`)

  // Load lessons
  console.log('\nLoading lessons...')
  const lessonsSnap = await db.collection('lessons').get()
  const allLessons = lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`  ${allLessons.length} lessons`)

  // Process
  let alreadyMatched = 0
  let newlyMatched = 0
  let unmatched = 0
  let skippedNoData = 0
  let processed = 0

  const updates = [] // { docId, fields }
  const unmatchedSamples = []

  for (const lesson of allLessons) {
    if (processed >= LIMIT) break

    // Already has slotId — only fill in missing offSchedule/coveringFor
    if (lesson.slotId !== undefined && lesson.slotId !== null) {
      alreadyMatched++
      const need = {}
      if (lesson.offSchedule === undefined) need.offSchedule = false
      if (lesson.coveringFor === undefined) need.coveringFor = null
      if (Object.keys(need).length > 0) {
        updates.push({ docId: lesson.id, fields: need })
      }
      continue
    }

    processed++

    const day = weekdayFromDate(lesson.date)
    const period = Number(lesson.period)
    const className = (lesson.className || '').trim()
    const teacherId = lesson.teacherId || ''
    const teacherNameNorm = norm(lesson.teacherName)

    if (!day || !period || !className) {
      skippedNoData++
      unmatched++
      updates.push({
        docId: lesson.id,
        fields: { slotId: null, offSchedule: false, coveringFor: null },
      })
      if (unmatchedSamples.length < 12) {
        unmatchedSamples.push({
          id: lesson.id,
          reason: 'missing date/period/class field',
          date: lesson.date, period: lesson.period, className,
        })
      }
      continue
    }

    // Look up by (day | period | className)
    const candidates = slotIndex.get(`${day}|${period}|${className}`) || []

    // Filter by teacher: id first, then name fallback
    let matches = candidates.filter(s => teacherId && s.teacherId === teacherId)
    if (matches.length === 0 && teacherNameNorm) {
      matches = candidates.filter(s => norm(s.teacherName) === teacherNameNorm)
    }

    if (matches.length > 0) {
      newlyMatched++
      updates.push({
        docId: lesson.id,
        fields: {
          slotId: matches[0].id,
          offSchedule: false,
          coveringFor: null,
        },
      })
    } else {
      unmatched++
      updates.push({
        docId: lesson.id,
        fields: { slotId: null, offSchedule: false, coveringFor: null },
      })
      if (unmatchedSamples.length < 12) {
        unmatchedSamples.push({
          id: lesson.id,
          reason: candidates.length === 0 ? 'no slot exists for day/period/class' : 'teacher mismatch',
          date: lesson.date, day, period, className,
          teacher: lesson.teacherName,
        })
      }
    }
  }

  // Summary
  console.log(`\n--- Summary ---`)
  console.log(`Already had slotId:      ${alreadyMatched}`)
  console.log(`Newly matched:           ${newlyMatched}`)
  console.log(`Unmatched (legacy):      ${unmatched}`)
  if (skippedNoData > 0) {
    console.log(`  └─ missing fields:    ${skippedNoData}`)
  }
  console.log(`Updates queued:          ${updates.length}`)
  console.log(`Match rate:              ${processed > 0 ? ((newlyMatched / processed) * 100).toFixed(1) : '0'}%`)

  if (unmatchedSamples.length > 0) {
    console.log(`\nUnmatched samples (first ${unmatchedSamples.length}):`)
    unmatchedSamples.forEach((s, i) => {
      const detail = s.day
        ? `${s.date} ${s.day} P${s.period} · ${s.className} · ${s.teacher}`
        : `${s.date} P${s.period} · ${s.className}`
      console.log(`  ${i + 1}. ${detail}  [${s.reason}]`)
    })
  }

  if (DRY_RUN) {
    console.log(`\n(DRY RUN — no writes performed.)\n`)
    return
  }

  if (updates.length === 0) {
    console.log(`\nNothing to write.\n`)
    return
  }

  // 5s grace period before writing
  console.log(`\n⚠ About to write ${updates.length} updates. Ctrl+C in the next 5s to abort...`)
  await new Promise(r => setTimeout(r, 5000))

  // Batched writes
  let written = 0
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch()
    const chunk = updates.slice(i, i + BATCH_SIZE)
    chunk.forEach(u => {
      batch.update(db.collection('lessons').doc(u.docId), u.fields)
    })
    await batch.commit()
    written += chunk.length
    process.stdout.write(`\r  Wrote ${written}/${updates.length}`)
  }
  console.log(`\n\n✓ Backfill complete. ${written} lessons updated.\n`)
}

main().catch(e => {
  console.error('\n❌ Backfill failed:', e.message || e)
  console.error(e.stack)
  process.exit(1)
})
