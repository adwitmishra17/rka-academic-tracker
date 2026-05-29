#!/usr/bin/env node
/*
 * backfill-exam-papers
 * --------------------
 * Ensures every SCHOLASTIC exam_subject has a placeholder exam_paper for each
 * exam_term in its (branch, session) — so the subject shows up in SMS
 * (Examinations / Report Cards / Admit Cards) without a manual date sheet.
 *
 * Mirrors the auto-create logic baked into the syncExamSubjects Cloud Function.
 *
 * SAFETY:
 *   - INSERT-ONLY. If a paper already exists for a (subject_id, term_id) it is
 *     left untouched — never overwrites a teacher/SMS-edited paper.
 *   - co_scholastic subjects are skipped (they use grades, not papers).
 *   - No exam date/time/venue is set (admin builds the real date sheet later).
 *
 * USAGE:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node backfill.js [--dry-run]
 *   Optional: DEFAULT_MAX_MARKS=100 DEFAULT_PASSING=33
 */

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('ERROR: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars')
  process.exit(1)
}
const DRY = process.argv.includes('--dry-run')
const MAX_MARKS = Number(process.env.DEFAULT_MAX_MARKS ?? 100)
const PASSING   = Number(process.env.DEFAULT_PASSING ?? 33)

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function getAll(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const [terms, subjects, papers] = await Promise.all([
    getAll('exam_terms?select=id,branch_id,session_code'),
    getAll('exam_subjects?select=id,branch_id,session_code,class_name,subject_name&kind=eq.scholastic'),
    getAll('exam_papers?select=subject_id,term_id'),
  ])

  const have = new Set(papers.map((p) => `${p.subject_id}|${p.term_id}`))
  const termsByScope = {}
  for (const t of terms) {
    const k = `${t.branch_id}|${t.session_code}`
    ;(termsByScope[k] ||= []).push(t.id)
  }

  const toInsert = []
  for (const s of subjects) {
    const scopeTerms = termsByScope[`${s.branch_id}|${s.session_code}`] || []
    for (const termId of scopeTerms) {
      if (!have.has(`${s.id}|${termId}`)) {
        toInsert.push({
          tracker_doc_id: `auto_${s.id}_${termId}`,
          subject_id:     s.id,
          term_id:        termId,
          paper_name:     'Main',
          max_marks:      MAX_MARKS,
          passing_marks:  PASSING,
          exam_date:      null,
          has_practical:  false,
          theory_max:     null,
          practical_max:  0,
        })
      }
    }
  }

  console.log(`scholastic subjects = ${subjects.length}`)
  console.log(`terms               = ${terms.length}`)
  console.log(`existing papers     = ${papers.length}`)
  console.log(`papers to insert    = ${toInsert.length}  (max_marks=${MAX_MARKS}, passing=${PASSING}, no date)`)

  if (DRY) { console.log('\n--dry-run: nothing written.'); return }
  if (!toInsert.length) { console.log('\nNothing to insert — all subjects already have papers.'); return }

  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200)
    const res = await fetch(`${URL}/rest/v1/exam_papers`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    })
    if (!res.ok) throw new Error(`INSERT batch @${i} -> ${res.status} ${await res.text()}`)
    console.log(`inserted ${Math.min(i + 200, toInsert.length)}/${toInsert.length}`)
  }
  console.log('\n✅ backfill complete.')
}

main().catch((e) => { console.error(e.message); process.exit(1) })
