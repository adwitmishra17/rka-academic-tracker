// =========================================================================
// seniorSubjects.js — resolve each Class 11/12 student's real subject list.
//
// There is no stored per-student subject list: exam_subjects (Examinations →
// Setup) lists a class's WHOLE offering as one flat set — core + every
// elective + activity rows (CUET/ECA/…). So a student's subjects are derived:
//
//   core  = class catalogue − activity rows − the stream's elective pool
//   + the student's chosen optional subject
//   − science-path drop (Science: PCM drops Biology, PCB drops Maths)
//
// The elective pool is stream-aware: Mathematics is CORE for Science but an
// ELECTIVE for Commerce/Humanities. This mirrors the SMS report exactly (same
// SMS data behind /api/students and /api/exam/subjects), so both agree.
// =========================================================================

export const SENIOR_CLASSES = [
  'Class 11 Science', 'Class 11 Commerce', 'Class 11 Humanities',
  'Class 12 Science', 'Class 12 Commerce', 'Class 12 Humanities',
]

export const isSeniorClass = (c) => /^Class (11|12)\b/.test(String(c || ''))
const norm = (s) => String(s || '').trim().toLowerCase()

// Non-subject rows the Setup catalogue mixes in — never a board subject.
const ACTIVITY = new Set([
  'cuet', 'eca', 'reading/writing', 'reading / writing', 'reading writing',
  'discipline', 'work education',
])

// Subjects that are a personal ELECTIVE for seniors (not compulsory core).
// Stream-aware: Mathematics is core for Science, elective for Commerce/Humanities.
function electivePool(className) {
  const base = new Set([
    'hindi', 'physical education', 'physical & health education',
    'computer science', 'computers', 'artificial intelligence',
  ])
  if (/Commerce|Humanities/.test(className)) { base.add('mathematics'); base.add('maths') }
  return base
}

// catalogue rows [{ subject_name, kind, sort_order }] → ordered core subjects.
function coreFromCatalogue(className, rows) {
  const pool = electivePool(className)
  const seen = new Set()
  return (rows || [])
    .filter((r) => (r.kind || 'scholastic') === 'scholastic')
    .filter((r) => !ACTIVITY.has(norm(r.subject_name)))
    .filter((r) => !pool.has(norm(r.subject_name)))
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map((r) => r.subject_name)
    .filter((n) => { const k = norm(n); if (seen.has(k)) return false; seen.add(k); return true })
}

// student = { className, sciencePath, optionalSubject }; rows = that class's catalogue.
export function resolveSubjects(student, rows) {
  const cls = student.className
  let subs = coreFromCatalogue(cls, rows)

  const path = norm(student.sciencePath)
  if (/Science/.test(cls)) {
    if (path === 'pcm') subs = subs.filter((s) => !/^bio/i.test(s))
    else if (path === 'pcb') subs = subs.filter((s) => !/^math|^maths/i.test(s))
  }

  const opt = student.optionalSubject
  if (opt && !subs.some((s) => norm(s) === norm(opt))) subs.push(opt)

  return subs
}
