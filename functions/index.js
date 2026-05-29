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


// =============================================================================
// TRIGGER 1 — examSubjects → exam_subjects
//
// Admin portal writes one doc per (branch, session, class, subject).
// These are reference data rows — no source guard needed since the SMS office
// never manually edits the subject catalogue.
//
// Firestore doc ID format: auto-generated (addDoc in ReportCardSetup.jsx)
// Upsert conflict: tracker_doc_id
// =============================================================================
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
    sort_order:             data.sortOrder ?? 0,
    assigned_teacher_email: assignedTeacherEmail, // null when no teacher assigned
  }

  const { error } = await supabase()
    .from('exam_subjects')
    .upsert(row, { onConflict: 'tracker_doc_id' })

  if (error) console.error(`syncExamSubjects failed (${docId}):`, error.message)
  else       console.log(`syncExamSubjects ok: ${docId} [${data.className} / ${data.subjectName}] teacher=${assignedTeacherEmail || '—'}`)
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
// Upsert conflict: tracker_doc_id
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
  //   starts_on, ends_on, result_date, is_finalized, tracker_doc_id UNIQUE
  // Table has UNIQUE (branch_id, session_code, short_code), but we upsert on
  // tracker_doc_id — it is deterministic and already encodes all three.
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
    .upsert(row, { onConflict: 'tracker_doc_id' })

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
  //   exam_date, exam_start_time, exam_end_time, venue, created_at,
  //   updated_at, tracker_doc_id
  // No branch_id on this table — branch is reached via subject_id → exam_subjects.
  const row = {
    tracker_doc_id: docId,
    subject_id:     data.subjectId,
    term_id:        data.termId,
    paper_name:     data.paperName    ?? 'Main',
    max_marks:      data.maxMarks,
    passing_marks:  data.passingMarks ?? 0,
    exam_date:      data.examDate     ?? null,
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
  //   entered_by, entered_at, updated_at, tracker_doc_id
  const row = {
    tracker_doc_id: docId,
    paper_id:       data.paperId,
    student_id:     studentId,
    marks_obtained: data.isAbsent ? null : (data.marksObtained ?? null),
    is_absent:      data.isAbsent ?? false,
    remarks:        data.remarks  ?? '',
    source:         'teacher_pwa',
    entered_by:     data.enteredBy ?? '',
    entered_at:     tsToIso(data.enteredAt),
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
