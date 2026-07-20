'use strict'
// =============================================================================
// functions/index.js — Firestore → Supabase one-way sync
//
// Fires on every write to six Firestore collections and upserts the data into
// the SMS Supabase database so the print engine can produce report cards and
// HPC cards without touching Firestore directly.
//
// ─── CRITICAL RULES — DO NOT RELAX ─────────────────────────────────────────
//   1. NEVER overwrite a Supabase row where source = 'manual'.
//      Those are deliberate school-office corrections made in the SMS portal.
//      The source guard (`isManualRow`) enforces this for exam_marks,
//      exam_coscholastic_grades, and hpc_assessments.
//
//   2. All Supabase writes use the SERVICE-ROLE key (bypasses RLS).
//      Store the key in Secret Manager or Firebase Function environment config.
//      NEVER commit it to the repository.
//      Deploy with:
//        firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
//        firebase functions:config:set supabase.url="https://xxx.supabase.co"
//      Or use .env.local locally (already in .gitignore).
//
//   3. Student / branch UUIDs are always resolved via join columns.
//      branches  → look up by   public.branches.code
//      students  → look up by   public.students.admission_no  (primary)
//                               public.students.legacy_comp_id (fallback)
//      NEVER generate UUIDs in this file and assume they match Supabase.
//
// ─── SUPABASE SCHEMA EXPECTATIONS ───────────────────────────────────────────
// The SMS team owns the schema for the 5 target tables; this function adapts
// to it. As of 2026-05 those tables look like:
//
//   exam_subjects            (branch_id UUID, session_code, class_name,
//                             subject_name, kind, sort_order, tracker_doc_id UNIQUE, …)
//   exam_terms               (branch_id UUID, session_code, name, short_code,
//                             weight, sort_order, starts_on, ends_on,
//                             result_date, is_finalized, tracker_doc_id UNIQUE)
//   exam_papers              (subject_id, term_id, paper_name, max_marks,
//                             passing_marks, exam_date, tracker_doc_id UNIQUE, …)
//   exam_marks               (paper_id, student_id UUID, marks_obtained,
//                             is_absent, remarks, source, entered_by,
//                             entered_at, tracker_doc_id UNIQUE)
//   exam_coscholastic_grades (term_id, subject_id, student_id UUID, grade,
//                             remarks, source, entered_by, entered_at,
//                             tracker_doc_id UNIQUE)
//   hpc_assessments          (branch_id UUID, session_code, term_id,
//                             student_id UUID, full student snapshot,
//                             domains JSONB, source, …, tracker_doc_id UNIQUE)
//
// SMS uses a denormalized model — only exam_subjects and hpc_assessments
// store branch_id directly. The detail tables (papers/marks/grades) reach
// the branch via subject_id → exam_subjects.branch_id.
//
// tracker_doc_id is the Firestore document ID (deterministic, collision-free).
// All upserts conflict on tracker_doc_id — retries and re-deployments are safe.
// If the SMS schema changes, update the row objects below to match.
// =============================================================================

const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { setGlobalOptions }  = require('firebase-functions/v2')
const admin                 = require('firebase-admin')
const { createClient }      = require('@supabase/supabase-js')

admin.initializeApp()

// Deploy all functions to asia-south2 (Delhi) — MUST match the Firestore
// database location (see firebase.json → firestore.location). Cloud Functions
// v2 Firestore triggers use Eventarc, which requires the function to run in
// the same region as the Firestore database.
//
// Secrets are bound here so every trigger inherits them. At runtime they
// arrive as plain env vars (process.env.SUPABASE_*), populated by Google
// Cloud Secret Manager during function invocation. Set them with:
//   firebase functions:secrets:set SUPABASE_URL
//   firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
setGlobalOptions({
  region: 'asia-south2',
  maxInstances: 10,
  secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
})


// ── Supabase client ──────────────────────────────────────────────────────────
// Lazy singleton. Credentials are read from environment at first use (not at
// module load time) so that cold-start failures are limited to actual trigger
// invocations, not every module import.

let _sb = null
function supabase() {
  if (!_sb) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        'Missing Supabase credentials. ' +
        'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in function env.'
      )
    }
    _sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _sb
}


// ── ID resolution helpers ────────────────────────────────────────────────────
// Module-level caches persist across warm invocations of the same instance.
// These IDs are stable (branch codes and student admission numbers don't change)
// so stale-cache risk is negligible. The caches reduce Supabase round-trips
// when many marks for the same class are written in a single session.

const _branchCache  = {}  // branchCode  → Supabase branch UUID
const _studentCache = {}  // Firestore student docId → Supabase student UUID

/**
 * Resolve a Tracker branchCode → Supabase branch UUID.
 * Queries public.branches.code. Throws if no matching row.
 */
async function getBranchId(branchCode) {
  if (_branchCache[branchCode]) return _branchCache[branchCode]
  const { data, error } = await supabase()
    .from('branches')
    .select('id')
    .eq('code', branchCode)
    .single()
  if (error || !data) {
    throw new Error(`Branch not found for code="${branchCode}": ${error?.message ?? 'no row'}`)
  }
  _branchCache[branchCode] = data.id
  return data.id
}

/**
 * Resolve admission_no / legacy_comp_id → Supabase student UUID.
 * Tries admission_no first; falls back to legacy_comp_id.
 * Returns null (does not throw) when no match — callers decide whether to skip.
 */
async function getStudentIdByKeys(admissionNo, legacyCompId) {
  if (admissionNo) {
    const { data } = await supabase()
      .from('students')
      .select('id')
      .eq('admission_no', String(admissionNo))
      .maybeSingle()
    if (data?.id) return data.id
  }
  if (legacyCompId) {
    const { data } = await supabase()
      .from('students')
      .select('id')
      .eq('legacy_comp_id', String(legacyCompId))
      .maybeSingle()
    if (data?.id) return data.id
  }
  return null
}

/**
 * Resolve a Firestore student document ID → Supabase student UUID.
 *
 * examMarks and examCoschGrades store only the Firestore student ID (not
 * admissionNo). This helper loads the student doc from Firestore and extracts
 * admissionNo / legacyCompId, then delegates to getStudentIdByKeys.
 *
 * Result is cached by Firestore ID for the lifetime of the function instance.
 */
async function getStudentIdByFirestoreId(firestoreStudentId) {
  if (!firestoreStudentId) return null
  if (_studentCache[firestoreStudentId]) return _studentCache[firestoreStudentId]

  const snap = await admin.firestore().doc(`students/${firestoreStudentId}`).get()
  if (!snap.exists) return null

  const d  = snap.data()
  const id = await getStudentIdByKeys(d.admissionNo, d.legacyCompId)
  if (id) _studentCache[firestoreStudentId] = id
  return id
}


// ── Source guard ─────────────────────────────────────────────────────────────

/**
 * Returns true when the Supabase row for this tracker_doc_id has source='manual'.
 * A manual row is a deliberate school-office correction — it must never be
 * overwritten by an automated sync. Callers MUST return early when this is true.
 */
async function isManualRow(table, trackerDocId) {
  const { data } = await supabase()
    .from(table)
    .select('source')
    .eq('tracker_doc_id', trackerDocId)
    .maybeSingle()
  return data?.source === 'manual'
}


// ── Timestamp conversion ─────────────────────────────────────────────────────

/** Convert a Firestore Timestamp, JS Date, or null → ISO-8601 string. */
function tsToIso(ts) {
  if (!ts) return new Date().toISOString()
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString()
  if (ts instanceof Date) return ts.toISOString()
  return new Date(ts).toISOString()
}


// ── Auto date sheet ──────────────────────────────────────────────────────────
/**
 * Ensure a placeholder exam_paper exists for a scholastic subject in EVERY term
 * of its (branch, session). This is what makes a subject appear in SMS
 * (Examinations / Report Cards / Admit Cards) the moment it's saved in the
 * Tracker — no manual date sheet step needed.
 *
 * INSERT-ONLY: if a paper already exists for a (subject_id, term_id) it is left
 * untouched, so max-marks / date / marks edits made later in SMS or the teacher
 * PWA are never clobbered. SMS holds edit authority.
 *
 * Defaults are placeholders (max 100, passing 33, NO exam date); the real date
 * sheet (dates / times / max marks) is filled in afterwards.
 */
async function ensurePapersForSubject(subjectId, branchId, sessionCode) {
  const sb = supabase()

  const { data: terms, error: tErr } = await sb
    .from('exam_terms').select('id')
    .eq('branch_id', branchId).eq('session_code', sessionCode)
  if (tErr) { console.error('ensurePapers: terms query failed:', tErr.message); return }
  if (!terms?.length) return  // no terms yet — papers appear once terms are set up

  const { data: existing, error: pErr } = await sb
    .from('exam_papers').select('term_id').eq('subject_id', subjectId)
  if (pErr) { console.error('ensurePapers: papers query failed:', pErr.message); return }
  const have = new Set((existing ?? []).map((p) => p.term_id))

  const rows = terms.filter((t) => !have.has(t.id)).map((t) => ({
    tracker_doc_id: `auto_${subjectId}_${t.id}`,
    subject_id:     subjectId,
    term_id:        t.id,
    paper_name:     'Main',
    max_marks:      100,
    passing_marks:  33,
    exam_date:      null,
    has_practical:  false,
    theory_max:     null,
    practical_max:  0,
  }))
  if (!rows.length) return

  const { error: insErr } = await sb.from('exam_papers').insert(rows)
  if (insErr) console.error('ensurePapers: insert failed:', insErr.message)
  else        console.log(`ensurePapers: +${rows.length} paper(s) for subject ${subjectId}`)
}


// =============================================================================
// TRIGGER 1 — examSubjects → exam_subjects
//
// Admin portal writes one doc per (branch, session, class, subject).
// These are reference data rows — no source guard needed since the SMS office
// never manually edits the subject catalogue.
//
// Firestore doc ID format: auto-generated (addDoc in ReportCardSetup.jsx)
// Upsert conflict: (branch_id, session_code, class_name, subject_name)  ← natural key
//   NOT tracker_doc_id: every "Build from Timetable" run in the admin portal
//   creates BRAND-NEW auto-ID examSubjects docs, so the same logical subject
//   gets a fresh tracker_doc_id each time. Conflicting on tracker_doc_id would
//   never match the existing Supabase row → INSERT → violates the FULL unique
//   index exam_subjects_uniq (migration 070) → the row keeps its stale/NULL
//   assigned_teacher_email and the teacher never sees the subject. Conflicting
//   on the natural key updates the existing row in place (incl. the new teacher
//   email). tracker_doc_id is also a PARTIAL unique index (migration 075), which
//   PostgREST can't use as an arbiter anyway — same reason as syncExamTerms.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────
// TRIGGER — studentAttendance → attendance_records (the SMS mirror).
//
// The teacher PWA writes one Firestore doc per student per day:
//   studentAttendance/{YYYY-MM-DD}_{smsStudentId}
//   { studentId, status: 'present'|'absent', isLate, className,
//     branchCode, date, markedBy, markedAt, … }
// This trigger mirrors each write into public.attendance_records in
// the SMS Supabase (migration 071) so the SMS Attendance screen and
// dashboard read live data. Rules:
//   · absent → 'absent'; present+isLate → 'late'; else 'present'
//   · SMS rows with source='manual' are office corrections — never
//     overwritten or deleted by the mirror
//   · docs keyed to unknown SMS student ids (pre-remigration history)
//     are skipped silently
//   · doc deletion (unmark) deletes the mirror row
// ─────────────────────────────────────────────────────────────────────
exports.syncStudentAttendance = onDocumentWritten('studentAttendance/{docId}', async (event) => {
  const docId = event.params.docId
  const m = docId.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/)
  if (!m) return
  const [, date, studentId] = m

  const after = event.data?.after?.exists ? event.data.after.data() : null

  try {
    if (!after) {
      const { error } = await supabase().from('attendance_records')
        .delete().eq('student_id', studentId).eq('date', date).neq('source', 'manual')
      if (error) console.error(`syncStudentAttendance delete (${docId}):`, error.message)
      return
    }

    const status = after.status === 'absent' ? 'absent' : (after.isLate ? 'late' : 'present')

    // Snapshot class/branch from the live SMS student row — also
    // validates the id (old-id docs skip).
    const { data: student, error: sErr } = await supabase().from('students')
      .select('id, branch_id, class_name, section').eq('id', studentId).maybeSingle()
    if (sErr) { console.error(`syncStudentAttendance student (${docId}):`, sErr.message); return }
    if (!student) { console.log(`syncStudentAttendance: unknown SMS student ${studentId} — skipped`); return }

    const { data: existing, error: eErr } = await supabase().from('attendance_records')
      .select('id, source').eq('student_id', studentId).eq('date', date).maybeSingle()
    if (eErr) { console.error(`syncStudentAttendance existing (${docId}):`, eErr.message); return }
    if (existing?.source === 'manual') return   // office correction wins

    const row = {
      branch_id:   student.branch_id,
      student_id:  studentId,
      date,
      class_name:  after.className || student.class_name,
      section:     student.section ?? null,
      status,
      source:      'teacher_pwa',
      recorded_at: after.markedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
      recorded_by: after.markedBy || null,
    }
    const { error } = existing
      ? await supabase().from('attendance_records').update(row).eq('id', existing.id)
      : await supabase().from('attendance_records').insert(row)
    if (error) console.error(`syncStudentAttendance write (${docId}):`, error.message)
  } catch (e) {
    console.error(`syncStudentAttendance (${docId}):`, e.message)
  }
})

exports.syncExamSubjects = onDocumentWritten('examSubjects/{docId}', async event => {
  const docId = event.params.docId
  const data  = event.data?.after?.data()
  if (!data) return  // document deleted — leave SMS DB untouched

  let branchId
  try { branchId = await getBranchId(data.branchCode) }
  catch (e) {
    console.warn(`syncExamSubjects: ${e.message} — skipping ${docId}`)
    return
  }

  // Resolve the assigned teacher's EMAIL so the teacher PWA can filter
  // subjects to the logged-in teacher. We use email (not Firebase UID, and
  // not the Firestore teachers doc ID) as the cross-system link because:
  //   • the admin stores assignedTeacherId = Firestore teachers doc ID
  //   • the teacher PWA knows the logged-in teacher's email (auth email)
  //   • email is stable and identical on both sides — no UID resolution,
  //     no chicken-and-egg with teachers who haven't signed in yet.
  // The teacher PWA must filter exam_subjects by assigned_teacher_email.
  let assignedTeacherEmail = null
  if (data.assignedTeacherId) {
    try {
      const tSnap = await admin.firestore().collection('teachers').doc(data.assignedTeacherId).get()
      if (tSnap.exists) {
        const t = tSnap.data()
        assignedTeacherEmail = (t.email || t.personalEmail || '').trim().toLowerCase() || null
      }
    } catch (e) {
      console.warn(`syncExamSubjects: teacher lookup failed for ${data.assignedTeacherId}: ${e.message}`)
    }
  }

  // Columns written here MUST exist in the SMS exam_subjects schema. Beyond
  // the base columns, this requires:
  //   ALTER TABLE exam_subjects ADD COLUMN IF NOT EXISTS assigned_teacher_email TEXT;
  const row = {
    tracker_doc_id:         docId,
    branch_id:              branchId,
    session_code:           data.sessionCode,
    class_name:             data.className,
    subject_name:           data.subjectName,
    kind:                   data.kind,            // 'scholastic' | 'co_scholastic'
    is_optional:            data.isOptional === true,
    sort_order:             data.sortOrder ?? 0,
    assigned_teacher_email: assignedTeacherEmail, // null when no teacher assigned
  }

  const { error } = await supabase()
    .from('exam_subjects')
    .upsert(row, { onConflict: 'branch_id,session_code,class_name,subject_name' })

  if (error) {
    console.error(`syncExamSubjects failed (${docId}):`, error.message)
    return
  }
  console.log(`syncExamSubjects ok: ${docId} [${data.className} / ${data.subjectName}] teacher=${assignedTeacherEmail || '—'}`)

  // Auto-create the "date sheet" (placeholder papers) so this subject shows up in
  // SMS immediately. Scholastic only — co_scholastic subjects use grades, not papers.
  if (data.kind === 'scholastic') {
    try {
      const { data: subj } = await supabase()
        .from('exam_subjects')
        .select('id')
        .eq('branch_id', branchId)
        .eq('session_code', data.sessionCode)
        .eq('class_name', data.className)
        .eq('subject_name', data.subjectName)
        .maybeSingle()
      if (subj?.id) await ensurePapersForSubject(subj.id, branchId, data.sessionCode)
    } catch (e) {
      console.error(`syncExamSubjects: ensurePapers failed (${docId}):`, e.message)
    }
  }
})


// =============================================================================
// TRIGGER 2 — examTerms → exam_terms
//
// Admin portal writes one doc per (branch, session, term) when setting up the
// academic session. These rows are the ANCHOR for the whole marks pipeline:
// exam_papers.term_id is a UUID FK to exam_terms, so a term MUST reach Supabase
// before any paper or mark for that term can be created. The teacher PWA reads
// exam_terms (filtered by session_code + branch_id) to populate its term picker,
// then passes the resulting UUID back as exam_papers.term_id.
//
// Reference data — no source guard (the SMS office never edits the term list).
//
// Firestore doc ID format: `${branchCode}_${sessionCode}_${shortCode}`
// Upsert conflict: (branch_id, session_code, short_code)  ← natural key
//   NOT tracker_doc_id: migration 075 made exam_terms.tracker_doc_id a PARTIAL
//   unique index (WHERE tracker_doc_id IS NOT NULL), which PostgREST cannot use
//   as an ON CONFLICT arbiter without a matching predicate. The natural-key
//   index (migration 070) is full, so we conflict on that instead.
// =============================================================================
exports.syncExamTerms = onDocumentWritten('examTerms/{docId}', async event => {
  const docId = event.params.docId
  const data  = event.data?.after?.data()
  if (!data) return  // document deleted — leave SMS DB untouched

  let branchId
  try { branchId = await getBranchId(data.branchCode) }
  catch (e) {
    console.warn(`syncExamTerms: ${e.message} — skipping ${docId}`)
    return
  }

  // SMS exam_terms schema:
  //   id, branch_id, session_code, name, short_code, weight, sort_order,
  //   starts_on, ends_on, result_date, is_finalized, tracker_doc_id
  // We still WRITE tracker_doc_id (it's 1:1 with the natural key and handy for
  // tracing), but we conflict on (branch_id, session_code, short_code) — see the
  // header note on why tracker_doc_id can't be the arbiter here.
  const row = {
    tracker_doc_id: docId,
    branch_id:      branchId,
    session_code:   data.sessionCode,
    name:           data.name,
    short_code:     data.shortCode,
    sort_order:     data.sortOrder   ?? 0,
    starts_on:      data.startsOn    || null,
    ends_on:        data.endsOn      || null,
    result_date:    data.resultDate  || null,
    is_finalized:   data.isFinalized ?? false,
  }

  const { error } = await supabase()
    .from('exam_terms')
    .upsert(row, { onConflict: 'branch_id,session_code,short_code' })

  if (error) console.error(`syncExamTerms failed (${docId}):`, error.message)
  else       console.log(`syncExamTerms ok: ${docId} [${data.sessionCode} / ${data.shortCode}]`)
})


// =============================================================================
// TRIGGER 3 — examPapers → exam_papers
//
// Teacher PWA writes one paper doc when entering marks for a (subject, term)
// pair for the first time, capturing maxMarks, passingMarks, and examDate.
// These are metadata rows — no source guard.
//
// Firestore doc ID format: `${subjectId}_${termId}`
// Upsert conflict: tracker_doc_id
// =============================================================================
exports.syncExamPapers = onDocumentWritten('examPapers/{docId}', async event => {
  const docId = event.params.docId
  const data  = event.data?.after?.data()
  if (!data) return

  // SMS exam_papers schema:
  //   id, term_id, subject_id, paper_name, max_marks, passing_marks,
  //   exam_date, exam_start_time, exam_end_time, venue, has_practical,
  //   theory_max, practical_max, created_at, updated_at, tracker_doc_id
  // No branch_id on this table — branch is reached via subject_id → exam_subjects.
  // Practical split (migration 079): max_marks stays the TOTAL. When the teacher
  // marks a paper as having a practical, theory_max + practical_max = max_marks.
  const row = {
    tracker_doc_id: docId,
    subject_id:     data.subjectId,
    term_id:        data.termId,
    paper_name:     data.paperName    ?? 'Main',
    max_marks:      data.maxMarks,
    passing_marks:  data.passingMarks ?? 0,
    exam_date:      data.examDate     ?? null,
    has_practical:  data.hasPractical ?? false,
    theory_max:     data.theoryMax    ?? null,
    practical_max:  data.practicalMax ?? 0,
  }

  const { error } = await supabase()
    .from('exam_papers')
    .upsert(row, { onConflict: 'tracker_doc_id' })

  if (error) console.error(`syncExamPapers failed (${docId}):`, error.message)
  else       console.log(`syncExamPapers ok: ${docId}`)
})


// =============================================================================
// TRIGGER 4 — examMarks → exam_marks  ⚠ SOURCE GUARD ACTIVE
//
// Teacher PWA writes one doc per (paper, student).
// Student UUID is resolved by loading the Firestore student doc to extract
// admissionNo / legacyCompId, then querying public.students.
//
// Firestore doc ID format: `${paperId}_${studentId}`
// Upsert conflict: tracker_doc_id
// =============================================================================
exports.syncExamMarks = onDocumentWritten('examMarks/{docId}', async event => {
  const docId = event.params.docId
  const data  = event.data?.after?.data()
  if (!data) return

  // ── Source guard ──
  if (await isManualRow('exam_marks', docId)) {
    console.log(`syncExamMarks: source=manual — skipping ${docId}`)
    return
  }

  // examMarks stores only the Firestore student doc ID — resolve via lookup.
  const studentId = await getStudentIdByFirestoreId(data.studentId)
  if (!studentId) {
    console.warn(
      `syncExamMarks: student not found for Firestore ID "${data.studentId}" ` +
      `(check admission_no / legacy_comp_id in Supabase students table) — skipping ${docId}`
    )
    return
  }

  // SMS exam_marks schema (highly denormalized — reaches branch/subject/term
  // via paper_id → exam_papers → exam_subjects):
  //   id, paper_id, student_id, marks_obtained, is_absent, remarks, source,
  //   entered_by, entered_at, updated_at, tracker_doc_id,
  //   theory_obtained, practical_obtained
  // Practical split (migration 079): marks_obtained stays the TOTAL
  // (theory_obtained + practical_obtained when the paper has a practical).
  const row = {
    tracker_doc_id:     docId,
    paper_id:           data.paperId,
    student_id:         studentId,
    marks_obtained:     data.isAbsent ? null : (data.marksObtained ?? null),
    is_absent:          data.isAbsent ?? false,
    remarks:            data.remarks  ?? '',
    source:             'teacher_pwa',
    entered_by:         data.enteredBy ?? '',
    entered_at:         tsToIso(data.enteredAt),
    theory_obtained:    data.isAbsent ? null : (data.theoryObtained    ?? null),
    practical_obtained: data.isAbsent ? null : (data.practicalObtained ?? null),
  }

  const { error } = await supabase()
    .from('exam_marks')
    .upsert(row, { onConflict: 'tracker_doc_id' })

  if (error) console.error(`syncExamMarks failed (${docId}):`, error.message)
  else       console.log(`syncExamMarks ok: ${docId} — ${data.studentName}`)
})


// =============================================================================
// TRIGGER 5 — examCoschGrades → exam_coscholastic_grades  ⚠ SOURCE GUARD ACTIVE
//
// Teacher PWA writes one grade doc per (subject, term, student).
// Same student-resolution strategy as examMarks (Firestore lookup).
//
// Firestore doc ID format: `${subjectId}_${termId}_${studentId}`
// Upsert conflict: tracker_doc_id
// =============================================================================
exports.syncExamCoschGrades = onDocumentWritten('examCoschGrades/{docId}', async event => {
  const docId = event.params.docId
  const data  = event.data?.after?.data()
  if (!data) return

  // ── Source guard ──
  if (await isManualRow('exam_coscholastic_grades', docId)) {
    console.log(`syncExamCoschGrades: source=manual — skipping ${docId}`)
    return
  }

  const studentId = await getStudentIdByFirestoreId(data.studentId)
  if (!studentId) {
    console.warn(
      `syncExamCoschGrades: student not found for Firestore ID "${data.studentId}" ` +
      `— skipping ${docId}`
    )
    return
  }

  // SMS exam_coscholastic_grades schema (denormalized — branch/session/class
  // reached via subject_id → exam_subjects):
  //   id, term_id, subject_id, student_id, grade, remarks, source,
  //   entered_by, entered_at, updated_at, tracker_doc_id
  const row = {
    tracker_doc_id: docId,
    term_id:        data.termId,
    subject_id:     data.subjectId,
    student_id:     studentId,
    grade:          data.grade   ?? null,
    remarks:        data.remarks ?? '',
    source:         'teacher_pwa',
    entered_by:     data.enteredBy ?? '',
    entered_at:     tsToIso(data.enteredAt),
  }

  const { error } = await supabase()
    .from('exam_coscholastic_grades')
    .upsert(row, { onConflict: 'tracker_doc_id' })

  if (error) console.error(`syncExamCoschGrades failed (${docId}):`, error.message)
  else       console.log(`syncExamCoschGrades ok: ${docId} — ${data.studentName} grade=${data.grade}`)
})


// =============================================================================
// TRIGGER 6 — hpcAssessments → hpc_assessments  ⚠ SOURCE GUARD ACTIVE
//
// Teacher PWA writes one assessment per (student, term) for Nursery–Class 2.
// The Firestore doc includes a student snapshot (name, admissionNo, etc.) frozen
// at assessment time — this means student UUID can be resolved directly from the
// doc's admissionNo field without a Firestore lookup.
//
// The domains JSONB column stores the full 6-domain × 4-indicator structure
// exactly as written by the teacher, using the canonical keys from hpc.js:
//   { physical: { rating, remarks, indicators: { gross_motor, fine_motor, ... } }, ... }
//
// Firestore doc ID format: `${studentId}_${termId}`
// Upsert conflict: tracker_doc_id
// =============================================================================
exports.syncHpcAssessments = onDocumentWritten('hpcAssessments/{docId}', async event => {
  const docId = event.params.docId
  const data  = event.data?.after?.data()
  if (!data) return

  // ── Source guard ──
  if (await isManualRow('hpc_assessments', docId)) {
    console.log(`syncHpcAssessments: source=manual — skipping ${docId}`)
    return
  }

  let branchId
  try { branchId = await getBranchId(data.branchCode) }
  catch (e) {
    console.warn(`syncHpcAssessments: ${e.message} — skipping ${docId}`)
    return
  }

  // admissionNo is in the student snapshot — try direct key lookup first.
  // Fall back to Firestore student doc lookup as a safety net.
  let studentId = await getStudentIdByKeys(data.admissionNo, data.legacyCompId)
  if (!studentId) {
    studentId = await getStudentIdByFirestoreId(data.studentId)
  }
  if (!studentId) {
    console.warn(
      `syncHpcAssessments: student not found ` +
      `(admissionNo="${data.admissionNo}", firestoreId="${data.studentId}") — skipping ${docId}`
    )
    return
  }

  const row = {
    tracker_doc_id:  docId,
    branch_id:       branchId,
    student_id:      studentId,
    term_id:         data.termId,
    session_code:    data.sessionCode,
    class_name:      data.className,
    // Frozen student snapshot (stable for printing even if master record changes)
    student_name:    data.studentName  ?? '',
    admission_no:    data.admissionNo  ?? '',
    roll_number:     data.rollNumber   ?? '',
    date_of_birth:   data.dateOfBirth  ?? null,
    father_name:     data.fatherName   ?? '',
    mother_name:     data.motherName   ?? '',
    photo_key:       data.photoKey     ?? '',
    // Assessment payload — JSONB; keys match exactly teacher/src/lib/hpc.js DOMAIN_KEYS
    domains:         data.domains        ?? {},
    general_remarks: data.generalRemarks ?? '',
    is_void:         data.isVoid         ?? false,
    source:          'teacher_pwa',
    assessed_by:     data.assessedBy ?? '',
    assessed_at:     tsToIso(data.assessedAt),
  }

  const { error } = await supabase()
    .from('hpc_assessments')
    .upsert(row, { onConflict: 'tracker_doc_id' })

  if (error) console.error(`syncHpcAssessments failed (${docId}):`, error.message)
  else       console.log(`syncHpcAssessments ok: ${docId} — ${data.studentName}`)
})


// =============================================================================
// TRIGGER 7 — lessonPlans branch-stamp guard  (data-layer invariant)
//
// Every lessonPlans doc MUST carry branchCode: the admin app's lists filter by
// it for branch-scoped admins, and Firestore cannot match a MISSING field —
// so an unstamped plan is invisible to branch admins while the super admin
// (unfiltered "All branches" view) still sees it.
//
// Current writers (teacher PWA ≥v91, admin Reschedule) stamp it themselves,
// but a stale cached PWA build or any future writer could regress. This
// trigger enforces the invariant at the database layer: if a written plan has
// no branchCode, resolve it from the teacher's record and stamp it.
//
// Re-entrancy: the update fires this trigger again; the second pass sees
// branchCode set and returns immediately.
// =============================================================================
exports.stampLessonPlanBranch = onDocumentWritten('lessonPlans/{docId}', async event => {
  const after = event.data?.after
  if (!after?.exists) return                    // deleted — nothing to stamp
  const data = after.data()
  if (data.branchCode) return                   // already stamped — the normal case

  let branchCode = null
  if (data.teacherId) {
    try {
      const t = await admin.firestore().doc(`teachers/${data.teacherId}`).get()
      if (t.exists) {
        const td = t.data()
        branchCode = td.branchCodes?.[0] || td.branchCode || null
      }
    } catch (e) {
      console.warn(`stampLessonPlanBranch: teacher lookup failed for ${data.teacherId}: ${e.message}`)
    }
  }
  branchCode = branchCode || 'MAIN'             // matches the app's own fallback

  await after.ref.update({ branchCode, branchCodeStampedBy: 'auto-trigger' })
  console.log(`stampLessonPlanBranch: ${event.params.docId} → ${branchCode} (teacher ${data.teacherName || data.teacherId || '?'})`)
})

// ─────────────────────────────────────────────────────────────────────────────
// HRMS → Tracker employee sync (webhook target).
//
// A Postgres trigger on rka-attendance's employees table POSTs here whenever
// is_active flips. We mirror the flag onto the Firestore teacher doc (matched
// by email → personal email → phone) and, on deactivation, BLANK the teacher's
// timetable (delete their slots) and clear any class-teacher assignment so
// attendance/arrangement views show vacant periods immediately.
//
// Auth: shared secret in the x-hrms-secret header (Secret Manager).
// ─────────────────────────────────────────────────────────────────────────────
const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const HRMS_SYNC_SECRET = defineSecret('HRMS_SYNC_SECRET')

exports.hrmsEmployeeSync = onRequest({ secrets: [HRMS_SYNC_SECRET] }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
    if ((req.headers['x-hrms-secret'] || '') !== HRMS_SYNC_SECRET.value()) {
      return res.status(401).json({ error: 'bad secret' })
    }

    const rec = req.body?.record || {}
    const old = req.body?.old_record || {}
    if (typeof rec.is_active !== 'boolean' || rec.is_active === old.is_active) {
      return res.json({ ok: true, skipped: 'no is_active change' })
    }

    const db = admin.firestore()
    const clean = (s) => (s || '').toLowerCase().trim()
    const last10 = (s) => (s || '').replace(/\D/g, '').slice(-10)

    // Match the teacher doc: email → personalEmail → phone (last 10 digits).
    let teacherSnap = null
    for (const [field, value] of [
      ['email', clean(rec.email)],
      ['personalEmail', clean(rec.email)],
      ['email', clean(rec.personal_email)],
      ['personalEmail', clean(rec.personal_email)],
    ]) {
      if (!value) continue
      const s = await db.collection('teachers').where(field, '==', value).limit(1).get()
      if (!s.empty) { teacherSnap = s.docs[0]; break }
    }
    if (!teacherSnap && last10(rec.phone)) {
      const all = await db.collection('teachers').get()
      const hit = all.docs.find((d) => last10(d.data().phone) === last10(rec.phone))
      if (hit) teacherSnap = hit
    }
    if (!teacherSnap) {
      console.log(`hrmsEmployeeSync: no teacher doc for employee ${rec.full_name || rec.id} — nothing to sync`)
      return res.json({ ok: true, matched: false })
    }

    const teacher = teacherSnap.data()
    const updates = {
      isActive: rec.is_active,
      hrmsSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      hrmsEmployeeId: rec.id || null,
    }

    let slotsCleared = 0
    if (rec.is_active === false) {
      // Blank the timetable: delete every slot assigned to this teacher.
      const slots = await db.collection('timetable').where('teacherId', '==', teacherSnap.id).get()
      let batch = db.batch(); let n = 0
      for (const d of slots.docs) {
        batch.delete(d.ref); n++
        if (n % 400 === 0) { await batch.commit(); batch = db.batch() }
      }
      if (n % 400 !== 0 || (n > 0 && n < 400)) await batch.commit()
      slotsCleared = slots.size

      // Clear class-teacher assignment (doc + lookup collection).
      if (teacher.classTeacherOf) updates.classTeacherOf = null
      for (const key of [clean(teacher.email), clean(teacher.personalEmail)]) {
        if (!key) continue
        const ref = db.collection('classTeacherByEmail').doc(key)
        if ((await ref.get()).exists) await ref.delete()
      }
    }

    await teacherSnap.ref.update(updates)
    console.log(`hrmsEmployeeSync: ${teacher.fullName || teacherSnap.id} → isActive=${rec.is_active}, timetable slots cleared: ${slotsCleared}`)
    res.json({ ok: true, matched: true, teacherId: teacherSnap.id, isActive: rec.is_active, slotsCleared })
  } catch (e) {
    console.error('hrmsEmployeeSync:', e)
    res.status(500).json({ error: e.message })
  }
})
