// ============================================================================
// admin/server.js
//
// Express server that:
//   1. Serves the built Vite admin SPA from dist/ (existing behaviour)
//   2. Exposes /api/* endpoints that read from the SMS Supabase using the
//      service-role key (never reaches the browser)
//
// Auth: every /api/* request must carry a Firebase Auth ID token in the
//   Authorization: Bearer <token> header. The token is verified via the
//   Firebase Admin SDK before any Supabase work is done.
//
// Env vars (see .env.example):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   FIREBASE_SERVICE_ACCOUNT_PATH   (or FIREBASE_SERVICE_ACCOUNT_JSON inline)
//   PORT                            (Hostinger sets this automatically)
//
// Hostinger runs: npm install → npm run build → npm start (this file)
// ============================================================================

import express  from 'express'
import path     from 'path'
import fs       from 'fs'
import { fileURLToPath } from 'url'
import dotenv   from 'dotenv'
import admin    from 'firebase-admin'
import { createClient } from '@supabase/supabase-js'

// Load .env / .env.local in dev (Hostinger injects env vars directly).
dotenv.config()
dotenv.config({ path: '.env.local' })

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const distDir    = path.join(__dirname, 'dist')

const app  = express()
const PORT = process.env.PORT || 3000

// ─── Startup diagnostics: which env vars did we actually pick up? ───────────
// (Prints names only, never values — safe to leave in production logs.)
const seen = {
  SUPABASE_URL:                       !!process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY:          !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  FIREBASE_SERVICE_ACCOUNT_JSON:      !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  FIREBASE_SERVICE_ACCOUNT_JSON_B64:  !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64,
  FIREBASE_SERVICE_ACCOUNT_PATH:      !!process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
}
console.log('[admin] env vars present:', seen)

// ─── Initialise Firebase Admin ──────────────────────────────────────────────
// Three ways to provide the service account, in order of preference:
//   FIREBASE_SERVICE_ACCOUNT_JSON_B64 — base64-encoded JSON (recommended for
//       Hostinger control-panel env vars: avoids the private_key newline
//       mangling that often breaks plain JSON paste-in)
//   FIREBASE_SERVICE_ACCOUNT_JSON     — raw JSON string (only safe if your
//       host preserves \n inside the value correctly)
//   FIREBASE_SERVICE_ACCOUNT_PATH     — filesystem path (for local dev)
let firebaseReady       = false
let firebaseInitError   = null   // exposed via /api/health for remote debugging
let firebaseInitSource  = null   // which env var path was used
try {
  let serviceAccount = null
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8')
    serviceAccount = JSON.parse(decoded)
    firebaseInitSource = 'FIREBASE_SERVICE_ACCOUNT_JSON_B64'
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    firebaseInitSource = 'FIREBASE_SERVICE_ACCOUNT_JSON'
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const raw = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')
    serviceAccount = JSON.parse(raw)
    firebaseInitSource = 'FIREBASE_SERVICE_ACCOUNT_PATH'
  }
  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
    firebaseReady = true
    console.log(`[admin] Firebase Admin initialised (source: ${firebaseInitSource}, project: ${serviceAccount.project_id})`)
  } else {
    firebaseInitError = 'No service-account env var set (FIREBASE_SERVICE_ACCOUNT_JSON_B64 / FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_PATH)'
    console.warn(`[admin] Firebase Admin not initialised — ${firebaseInitError}`)
  }
} catch (e) {
  firebaseInitError = e.message
  console.error('[admin] Firebase Admin init FAILED:', e.message)
  if (e.message.includes('JSON')) {
    console.error('[admin]   → most likely the service-account JSON is malformed. Common cause: newlines in private_key got stripped when pasted into the host control panel. Use FIREBASE_SERVICE_ACCOUNT_JSON_B64 (base64-encoded) instead.')
  }
}

// ─── Initialise Supabase ────────────────────────────────────────────────────
let supabase = null
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  )
  console.log(`[admin] Supabase client initialised (url: ${process.env.SUPABASE_URL})`)
} else {
  const missing = []
  if (!process.env.SUPABASE_URL)              missing.push('SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  console.warn(`[admin] Supabase NOT initialised — missing: ${missing.join(', ')}`)
}

const apiReady = firebaseReady && !!supabase

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))

// Auth middleware — verifies Firebase ID token, attaches { uid, email } to req.user.
async function verifyAuth(req, res, next) {
  if (!apiReady) return res.status(503).json({ error: 'API not configured on server' })
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.user = { uid: decoded.uid, email: (decoded.email || '').toLowerCase() }
    next()
  } catch (e) {
    console.warn('[admin] token verify failed:', e.message)
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// In-memory caches for the (small, rarely-changing) branches table.
let branchesCache = null  // { id → { id, code, name } }
async function loadBranches() {
  if (branchesCache) return branchesCache
  const { data, error } = await supabase.from('branches').select('id, code, name')
  if (error) throw error
  branchesCache = Object.fromEntries(data.map(b => [b.id, b]))
  return branchesCache
}
async function branchIdForCode(code) {
  const branches = await loadBranches()
  const entry = Object.values(branches).find(b => b.code === code)
  return entry?.id || null
}

// Transform a Supabase students row into the camelCase shape the Tracker
// frontend already understands (mirrors the Firestore schema). Keeps the
// view code unchanged — only the data source changed.
function toFrontendStudent(row, branches) {
  return {
    id:               row.id,
    fullName:         row.full_name        || '',
    admissionNo:      row.admission_no     || '',
    legacyCompId:     row.legacy_comp_id   || '',
    apaarId:          row.apaar_id         || '',
    gender:           row.gender           || '',
    dateOfBirth:      row.date_of_birth    || '',
    dateOfAdmission:  row.date_of_admission|| '',
    branchCode:       branches[row.branch_id]?.code || '',
    className:        row.class_name       || '',
    section:          row.section          || '',
    rollNumber:       row.roll_number != null ? String(row.roll_number) : '',
    optionalSubject:  row.optional_subject || '',
    sciencePath:      row.science_path     || '',
    fatherName:       row.father_name      || '',
    motherName:       row.mother_name      || '',
    guardianName:     row.guardian_name    || '',
    parentPhone:      row.parent_phone     || '',
    parentPhoneAlt:   row.parent_phone_alt || '',
    parentEmail:      row.parent_email     || '',
    religion:         row.religion         || '',
    category:         row.category         || '',
    caste:            row.caste            || '',
    house:            row.house            || '',
    addressPresent:   row.address_present  || '',
    addressPermanent: row.address_permanent|| '',
    parentOccupation: row.parent_occupation|| '',
    priorSchool:      row.prior_school     || '',
    transportRoute:   row.transport_route  || '',
    isActive:         row.is_active !== false,
    photoKey:         row.photo_key        || '',
    // Withdrawal metadata (read-only for Tracker; SMS owns the state)
    withdrawnAt:      row.withdrawn_at     || null,
    withdrawnBy:      row.withdrawn_by     || '',
    withdrawalReason: row.withdrawal_reason|| '',
  }
}

// ─── API routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/students
 * Query params:
 *   branchCode = MAIN|CITY   (optional; if omitted, returns all branches the
 *                             caller is allowed to see — currently no
 *                             server-side enforcement; relies on the SPA's
 *                             branch picker. Add RLS here later if needed.)
 *   className  = exact match (optional)
 *   isActive   = true|false|all (optional; DEFAULTS TO true — the SMS now
 *                holds 795 withdrawn/TC'd students from the Sheshmani
 *                backfill, which must not appear in Tracker lists)
 */
app.get('/api/students', verifyAuth, async (req, res) => {
  try {
    const branches = await loadBranches()
    let bid = null
    if (req.query.branchCode) {
      bid = await branchIdForCode(req.query.branchCode)
      if (!bid) return res.json({ students: [] })
    }

    // Students admitted FOR a future session (admission_session beyond the
    // running April–March session) are not on this year's rosters —
    // teachers must not see next year's admits in attendance/marks.
    const now = new Date(Date.now() + 330 * 60000)   // IST
    const y = now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
    const nowSession = `${y}-${String((y + 1) % 100).padStart(2, '0')}`

    const buildQuery = () => {
      let q = supabase.from('students').select('*')
      if (bid) q = q.eq('branch_id', bid)
      if (req.query.className) q = q.eq('class_name', req.query.className)
      if (req.query.isActive === 'false')    q = q.eq('is_active', false)
      else if (req.query.isActive !== 'all') q = q.eq('is_active', true)
      q = q.or(`admission_session.is.null,admission_session.lte.${nowSession}`)
      return q.order('class_name').order('roll_number')
    }

    // Page past PostgREST's 1000-row cap (a single request silently
    // truncates at 1000 — that's how "1000 students" bugs are born).
    const rows = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await buildQuery().range(from, from + 999)
      if (error) throw error
      rows.push(...data)
      if (data.length < 1000) break
    }
    res.json({ students: rows.map(r => toFrontendStudent(r, branches)) })
  } catch (e) {
    console.error('[admin] GET /api/students:', e)
    res.status(500).json({ error: e.message || 'Internal error' })
  }
})

/**
 * GET /api/students/:id
 * Returns one student by Supabase UUID.
 */
app.get('/api/students/:id', verifyAuth, async (req, res) => {
  try {
    const branches = await loadBranches()
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Student not found' })
    res.json({ student: toFrontendStudent(data, branches) })
  } catch (e) {
    console.error('[admin] GET /api/students/:id:', e)
    res.status(500).json({ error: e.message || 'Internal error' })
  }
})

/**
 * POST /api/admin/impersonate
 *
 * Super admin → "log in as teacher X" for bug identification.
 *
 * Mints a Firebase custom token tied to the teacher's Auth UID, writes an
 * audit record, and returns the token + the teacher PWA URL. The admin's
 * frontend opens that URL with ?impersonate=<token>&actor=<admin-email> in
 * a new tab; the teacher PWA detects the param and signs in with the token.
 *
 * Body: { teacherDocId: string }
 * Auth: only the super admin email may call this.
 */
const SUPER_ADMIN_EMAIL = 'adwit@rkacademyballia.in'
const TEACHER_PWA_URL   = process.env.TEACHER_PWA_URL || 'https://teacher.rkacademyballia.in'

app.post('/api/admin/impersonate', verifyAuth, async (req, res) => {
  try {
    if (req.user.email !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Forbidden — super admin only' })
    }
    const { teacherDocId } = req.body || {}
    if (!teacherDocId) return res.status(400).json({ error: 'teacherDocId is required' })

    // Load teacher record from Firestore (teachers collection is still
    // Tracker-owned; not in Supabase).
    const teacherSnap = await admin.firestore()
      .collection('teachers').doc(teacherDocId).get()
    if (!teacherSnap.exists) return res.status(404).json({ error: 'Teacher not found' })
    const teacher = teacherSnap.data()
    const teacherEmail = (teacher.email || teacher.personalEmail || '').trim().toLowerCase()
    if (!teacherEmail) return res.status(400).json({ error: 'Teacher record has no email' })

    // Resolve (or create) the matching Firebase Auth user. Teachers who have
    // never logged in via Google OAuth don't have an Auth account yet —
    // createUser() makes one with their email so the custom token can attach
    // to a stable UID.
    let firebaseUser
    try {
      firebaseUser = await admin.auth().getUserByEmail(teacherEmail)
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        firebaseUser = await admin.auth().createUser({
          email: teacherEmail,
          displayName: teacher.fullName || teacherEmail,
        })
        console.log(`[admin] impersonate: created Auth user for ${teacherEmail} (had never signed in)`)
      } else {
        throw e
      }
    }

    // Mint a custom token. The `impersonatedBy` custom claim lets the teacher
    // PWA (or anywhere else) detect impersonation from the ID token alone,
    // independent of the URL/sessionStorage trail.
    const customToken = await admin.auth().createCustomToken(firebaseUser.uid, {
      impersonatedBy: req.user.email,
    })

    // Audit — written via Admin SDK so it bypasses Firestore rules.
    await admin.firestore().collection('impersonationAudit').add({
      adminEmail:    req.user.email,
      teacherEmail,
      teacherDocId,
      teacherName:   teacher.fullName || '',
      teacherUid:    firebaseUser.uid,
      action:        'start',
      at:            admin.firestore.FieldValue.serverTimestamp(),
      userAgent:     req.headers['user-agent'] || '',
    })
    console.log(`[admin] impersonate: ${req.user.email} → ${teacherEmail}`)

    res.json({
      customToken,
      teacherEmail,
      teacherName:   teacher.fullName || '',
      teacherPwaUrl: TEACHER_PWA_URL,
    })
  } catch (e) {
    console.error('[admin] /api/admin/impersonate:', e)
    res.status(500).json({ error: e.message || 'Internal error' })
  }
})

/**
 * GET /api/health — unauthenticated quick check + diagnostics.
 *
 * Returns booleans for which env vars are visible to the Node process plus
 * the last init error (if any) — useful for diagnosing 503s without needing
 * access to Hostinger's Node logs. No secret values are exposed.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    firebase: firebaseReady,
    supabase: !!supabase,
    apiReady,
    diag: {
      env_present: {
        SUPABASE_URL:                      !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY:         !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        FIREBASE_SERVICE_ACCOUNT_JSON_B64: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64,
        FIREBASE_SERVICE_ACCOUNT_JSON:     !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
        FIREBASE_SERVICE_ACCOUNT_PATH:     !!process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      },
      firebase_init_source: firebaseInitSource,
      firebase_init_error:  firebaseInitError,
    },
  })
})

// ─── Exam / Report-card routes (read SMS Supabase via service-role) ─────────
// Mirrors the SMS report-card logic (src/lib/reportCards.js) server-side so the
// Firebase-only admin app can show/print report cards without a browser Supabase
// client. The service-role key never leaves the server.

const CBSE_GRADES = [
  { min: 91, grade: 'A1' }, { min: 81, grade: 'A2' }, { min: 71, grade: 'B1' },
  { min: 61, grade: 'B2' }, { min: 51, grade: 'C1' }, { min: 41, grade: 'C2' },
  { min: 33, grade: 'D' },  { min: 0,  grade: 'E' },
]
function gradeFor(pct) {
  if (pct == null || isNaN(pct)) return null
  for (const g of CBSE_GRADES) if (pct >= g.min) return g
  return CBSE_GRADES[CBSE_GRADES.length - 1]
}

// Faithful server-side port of SMS getStudentReportCard({ studentId, sessionCode }).
async function computeReportCard(studentId, sessionCode) {
  const { data: student, error: stErr } = await supabase.from('students')
    .select('id, full_name, admission_no, class_name, section, roll_number, date_of_birth, father_name, mother_name, photo_key, house, apaar_id, gender, branch_id, branches(code, name)')
    .eq('id', studentId).single()
  if (stErr) throw stErr

  const { data: terms, error: tErr } = await supabase.from('exam_terms')
    .select('id, name, short_code, weight, sort_order, starts_on, ends_on, result_date, is_finalized')
    .eq('branch_id', student.branch_id).eq('session_code', sessionCode)
    .order('sort_order').order('starts_on')
  if (tErr) throw tErr

  const { data: subjects, error: subErr } = await supabase.from('exam_subjects')
    .select('id, subject_name, subject_code, kind, is_optional, sort_order')
    .eq('branch_id', student.branch_id).eq('session_code', sessionCode).eq('class_name', student.class_name)
    .order('sort_order').order('subject_name')
  if (subErr) throw subErr
  const scholastic   = (subjects ?? []).filter(s => (s.kind ?? 'scholastic') === 'scholastic')
  const coScholastic = (subjects ?? []).filter(s => s.kind === 'co_scholastic')

  const termIds = (terms || []).map(t => t.id)
  let papers = []
  if (termIds.length) {
    const { data, error } = await supabase.from('exam_papers')
      .select('id, term_id, subject_id, max_marks, passing_marks').in('term_id', termIds)
    if (error) throw error
    papers = (data || []).filter(p => scholastic.find(s => s.id === p.subject_id))
  }

  const paperIds = papers.map(p => p.id)
  let marks = []
  if (paperIds.length) {
    const { data, error } = await supabase.from('exam_marks')
      .select('paper_id, marks_obtained, is_absent').eq('student_id', studentId).in('paper_id', paperIds)
    if (error) throw error
    marks = data || []
  }
  const markByPaper = new Map(marks.map(m => [m.paper_id, m]))

  const grid = scholastic.map(subj => {
    const row = { subject: subj, byTerm: {}, total: { obtained: 0, max: 0, pct: null, grade: null } }
    let cumO = 0, cumM = 0
    for (const t of terms) {
      const paper = papers.find(p => p.term_id === t.id && p.subject_id === subj.id)
      if (!paper) { row.byTerm[t.id] = { paper: null }; continue }
      const mk = markByPaper.get(paper.id)
      const obtained = mk?.is_absent ? null : (mk?.marks_obtained ?? null)
      const pct = (obtained != null && Number(paper.max_marks) > 0) ? (100 * obtained / Number(paper.max_marks)) : null
      row.byTerm[t.id] = { paperId: paper.id, marks: obtained, max: Number(paper.max_marks), passing: Number(paper.passing_marks), absent: !!mk?.is_absent, pct, grade: gradeFor(pct) }
      if (obtained != null) { cumO += obtained; cumM += Number(paper.max_marks) }
    }
    row.total = { obtained: cumO, max: cumM, pct: cumM > 0 ? (100 * cumO / cumM) : null, grade: gradeFor(cumM > 0 ? (100 * cumO / cumM) : null) }
    return row
  })

  let overallO = 0, overallM = 0
  for (const row of grid) {
    if (row.subject.is_optional && row.total.max === 0) continue
    overallO += row.total.obtained; overallM += row.total.max
  }
  const overallPct = overallM > 0 ? (100 * overallO / overallM) : null

  // Co-scholastic — most authoritative grade per subject (finalized term, else latest).
  let coRows = []
  if (coScholastic.length && termIds.length) {
    const { data: grades } = await supabase.from('exam_coscholastic_grades')
      .select('subject_id, term_id, grade, remarks, entered_at')
      .in('subject_id', coScholastic.map(s => s.id)).in('term_id', termIds).eq('student_id', studentId)
    const finalIds = new Set((terms || []).filter(t => t.is_finalized).map(t => t.id))
    const bySubject = new Map()
    for (const g of grades ?? []) {
      const cur = bySubject.get(g.subject_id)
      const isF = finalIds.has(g.term_id), isCurF = cur && finalIds.has(cur.term_id)
      if (!cur || (isF && !isCurF) || (isF === isCurF && new Date(g.entered_at) > new Date(cur.entered_at))) bySubject.set(g.subject_id, g)
    }
    coRows = coScholastic.map(s => ({ name: s.subject_name, code: s.subject_code, grade: bySubject.get(s.id)?.grade ?? '—', remarks: bySubject.get(s.id)?.remarks ?? null }))
  }

  return {
    student, sessionCode, terms, grid,
    overall: { obtained: overallO, max: overallM, pct: overallPct, grade: gradeFor(overallPct) },
    coScholastic: coRows,
  }
}

// GET /api/exam/sessions — distinct session codes (for the picker).
app.get('/api/exam/sessions', verifyAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('exam_terms').select('session_code')
    if (error) throw error
    const sessions = [...new Set((data || []).map(r => r.session_code).filter(Boolean))].sort().reverse()
    res.json({ sessions })
  } catch (e) { console.error('[admin] GET /api/exam/sessions:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/exam/crosslist?branchCode=&termId=&className=&section=
// Consolidated class marks matrix for a term: students × subjects with
// totals. Subjects/teachers flow from the Tracker sync; marks from the
// teacher app. Mirrors the SMS Examinations → Crosslist screen.
app.get('/api/exam/crosslist', verifyAuth, async (req, res) => {
  try {
    const { branchCode, termId, className, section } = req.query
    if (!branchCode || !termId || !className) return res.status(400).json({ error: 'branchCode, termId, className required' })
    const bid = await branchIdForCode(branchCode)
    if (!bid) return res.status(400).json({ error: `Branch '${branchCode}' not found` })

    const [{ data: term, error: tErr }, { data: subjects, error: sErr }] = await Promise.all([
      supabase.from('exam_terms').select('id, name, session_code').eq('id', termId).single(),
      supabase.from('exam_subjects').select('id, subject_name, sort_order')
        .eq('branch_id', bid).eq('class_name', className)
        .order('sort_order').order('subject_name'),
    ])
    if (tErr) throw tErr
    if (sErr) throw sErr
    if (!subjects?.length) return res.status(400).json({ error: `No subjects configured for ${className} — assign them in Classes & Subjects.` })

    const { data: papers, error: pErr } = await supabase
      .from('exam_papers').select('id, subject_id, max_marks')
      .eq('term_id', termId).in('subject_id', subjects.map(s => s.id))
    if (pErr) throw pErr
    if (!papers?.length) return res.status(400).json({ error: `No papers for ${term.name} · ${className}.` })

    const papersBySubject = new Map()
    for (const p of papers) {
      if (!papersBySubject.has(p.subject_id)) papersBySubject.set(p.subject_id, [])
      papersBySubject.get(p.subject_id).push(p)
    }
    const cols = subjects.filter(s => papersBySubject.has(s.id)).map(s => ({
      id: s.id, name: s.subject_name,
      maxMarks: papersBySubject.get(s.id).reduce((x, p) => x + Number(p.max_marks || 0), 0),
    }))

    let stq = supabase.from('students')
      .select('id, full_name, admission_no, roll_number, section')
      .eq('branch_id', bid).eq('class_name', className)
      .eq('is_active', true).eq('deleted_in_sms', false)
      .order('section').order('roll_number').order('full_name')
    if (section) stq = stq.eq('section', section)
    const { data: students, error: stErr } = await stq
    if (stErr) throw stErr

    const paperIds = papers.map(p => p.id)
    const marks = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('exam_marks')
        .select('paper_id, student_id, marks_obtained, is_absent')
        .in('paper_id', paperIds).range(from, from + 999)
      if (error) throw error
      marks.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    const subjectOfPaper = new Map(papers.map(p => [p.id, p.subject_id]))
    const cellMap = new Map()
    for (const m of marks) {
      const key = `${m.student_id}|${subjectOfPaper.get(m.paper_id)}`
      const cur = cellMap.get(key) || { obtained: 0, absent: false, entered: false }
      cur.entered = true
      if (m.is_absent) cur.absent = true
      else cur.obtained += Number(m.marks_obtained || 0)
      cellMap.set(key, cur)
    }

    const rows = (students || []).map(st => {
      const per = {}
      let total = 0, maxTotal = 0, any = false
      for (const c of cols) {
        const cell = cellMap.get(`${st.id}|${c.id}`) || null
        per[c.id] = cell
        if (cell?.entered) { any = true; maxTotal += c.maxMarks; if (!cell.absent) total += cell.obtained }
      }
      return {
        id: st.id, name: st.full_name, admissionNo: st.admission_no,
        rollNumber: st.roll_number, section: st.section,
        marks: per, total, maxTotal,
        percent: maxTotal > 0 ? (total / maxTotal) * 100 : null, hasAny: any,
      }
    })
    const ranked = [...rows].filter(r => r.percent != null).sort((a, b) => b.percent - a.percent)
    let lastPct = null, lastRank = 0
    ranked.forEach((r, i) => {
      if (lastPct === null || r.percent < lastPct - 1e-9) { lastRank = i + 1; lastPct = r.percent }
      r.rank = lastRank
    })

    res.json({ term, subjects: cols, students: rows })
  } catch (e) { console.error('[admin] GET /api/exam/crosslist:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/exam/terms?branchCode=&sessionCode=
app.get('/api/exam/terms', verifyAuth, async (req, res) => {
  try {
    let q = supabase.from('exam_terms')
      .select('id, name, short_code, sort_order, session_code, is_finalized').order('sort_order')
    if (req.query.sessionCode) q = q.eq('session_code', req.query.sessionCode)
    if (req.query.branchCode) {
      const bid = await branchIdForCode(req.query.branchCode)
      if (!bid) return res.json({ terms: [] })
      q = q.eq('branch_id', bid)
    }
    const { data, error } = await q
    if (error) throw error
    res.json({ terms: data })
  } catch (e) { console.error('[admin] GET /api/exam/terms:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/exam/report-card-students?branchCode=&className=&section=
app.get('/api/exam/report-card-students', verifyAuth, async (req, res) => {
  try {
    const { branchCode, className, section } = req.query
    if (!branchCode || !className) return res.json({ students: [] })
    const bid = await branchIdForCode(branchCode)
    if (!bid) return res.json({ students: [] })
    let q = supabase.from('students')
      .select('id, full_name, admission_no, class_name, section, roll_number, photo_key')
      .eq('branch_id', bid).eq('class_name', className).eq('is_active', true).eq('deleted_in_sms', false)
      .order('section').order('roll_number').order('full_name')
    if (section) q = q.eq('section', section)
    const { data, error } = await q
    if (error) throw error
    res.json({ students: data })
  } catch (e) { console.error('[admin] GET /api/exam/report-card-students:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/exam/report-card?studentId=&sessionCode=
app.get('/api/exam/report-card', verifyAuth, async (req, res) => {
  try {
    const { studentId, sessionCode } = req.query
    if (!studentId || !sessionCode) return res.status(400).json({ error: 'studentId and sessionCode required' })
    res.json({ card: await computeReportCard(studentId, sessionCode) })
  } catch (e) { console.error('[admin] GET /api/exam/report-card:', e); res.status(500).json({ error: e.message }) }
})

// POST /api/exam/marks — admin override. Mirrors SMS saveMarks: upsert
// exam_marks on (paper_id, student_id) with source='manual' so the
// Firestore→Supabase mirror leaves the corrected value untouched.
// Body: { marks: [{ paperId, studentId, marksObtained, isAbsent }] }
app.post('/api/exam/marks', verifyAuth, async (req, res) => {
  try {
    const { marks } = req.body || {}
    if (!Array.isArray(marks) || marks.length === 0) return res.status(400).json({ error: 'marks[] required' })
    const now = new Date().toISOString()
    const rows = marks
      .filter(m => m.paperId && m.studentId)
      .map(m => ({
        paper_id:       m.paperId,
        student_id:     m.studentId,
        marks_obtained: m.isAbsent ? null : (m.marksObtained == null || m.marksObtained === '' ? null : Number(m.marksObtained)),
        is_absent:      !!m.isAbsent,
        source:         'manual',
        entered_by:     req.user.email || req.user.uid,
        entered_at:     now,
      }))
    if (!rows.length) return res.status(400).json({ error: 'no valid rows' })
    const { error } = await supabase.from('exam_marks').upsert(rows, { onConflict: 'paper_id,student_id' })
    if (error) throw error
    res.json({ saved: rows.length })
  } catch (e) { console.error('[admin] POST /api/exam/marks:', e); res.status(500).json({ error: e.message }) }
})

// ─── HPC routes (Holistic Progress Card — read SMS Supabase, service-role) ──
const HPC_SELECT = `id, branch_id, session_code, term_id, student_id, student_name, admission_no, class_name, section, roll_number, date_of_birth, father_name, mother_name, photo_key, domains, general_remarks, assessed_at, assessed_by, source, is_void, voided_at, voided_by, void_reason, branches(code, name), exam_terms(id, name, short_code, session_code)`

// GET /api/hpc?branchCode=&termId=&className=&section=
app.get('/api/hpc', verifyAuth, async (req, res) => {
  try {
    const { branchCode, termId, className, section } = req.query
    let q = supabase.from('hpc_assessments').select(HPC_SELECT).eq('is_void', false).order('assessed_at', { ascending: false })
    if (branchCode) { const bid = await branchIdForCode(branchCode); if (!bid) return res.json({ assessments: [] }); q = q.eq('branch_id', bid) }
    if (termId)    q = q.eq('term_id', termId)
    if (className) q = q.eq('class_name', className)
    if (section)   q = q.eq('section', section)
    const { data, error } = await q
    if (error) throw error
    res.json({ assessments: data })
  } catch (e) { console.error('[admin] GET /api/hpc:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/hpc/:id
app.get('/api/hpc/:id', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('hpc_assessments').select(HPC_SELECT).eq('id', req.params.id).single()
    if (error) throw error
    res.json({ assessment: data })
  } catch (e) { console.error('[admin] GET /api/hpc/:id:', e); res.status(500).json({ error: e.message }) }
})

// POST /api/hpc/override  { id, domains, general_remarks } — source='manual', mirror-safe.
app.post('/api/hpc/override', verifyAuth, async (req, res) => {
  try {
    const { id, domains, general_remarks } = req.body || {}
    if (!id || !domains) return res.status(400).json({ error: 'id and domains required' })
    const { data, error } = await supabase.from('hpc_assessments').update({
      domains,
      general_remarks: general_remarks?.trim() ? general_remarks.trim() : null,
      source: 'manual',
      updated_at: new Date().toISOString(),
    }).eq('id', id).select(HPC_SELECT).single()
    if (error) throw error
    res.json({ assessment: data })
  } catch (e) { console.error('[admin] POST /api/hpc/override:', e); res.status(500).json({ error: e.message }) }
})

// POST /api/hpc/void  { id, reason } — super admin only.
app.post('/api/hpc/void', verifyAuth, async (req, res) => {
  try {
    if (req.user.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Super admin only' })
    const { id, reason } = req.body || {}
    if (!id || !reason?.trim()) return res.status(400).json({ error: 'id and reason required' })
    const { error } = await supabase.from('hpc_assessments').update({
      is_void: true, voided_at: new Date().toISOString(), voided_by: req.user.email, void_reason: reason.trim(),
    }).eq('id', id)
    if (error) throw error
    res.json({ ok: true })
  } catch (e) { console.error('[admin] POST /api/hpc/void:', e); res.status(500).json({ error: e.message }) }
})

// ─── Board Candidates / CBSE List of Candidates (LoC) ───────────────────────
// Owned in Supabase (no mirror). Full CRUD via service-role; gated by verifyAuth.
function detectStream(className) {
  if (!className) return null
  if (/Science$/.test(className))    return 'Science'
  if (/Commerce$/.test(className))   return 'Commerce'
  if (/Humanities$/.test(className)) return 'Humanities'
  return null
}
const LOC_EDITABLE = ['candidate_name','father_name','mother_name','date_of_birth','gender','nationality','category','religion','aadhaar_no','apaar_id','subject_codes','subject_names','identification_mark_1','identification_mark_2','is_cwsn','cwsn_category','needs_scribe','needs_extra_time','science_path','stream','photo_url','signature_url','remarks']

// GET /api/loc?branchCode=&sessionCode=&examClass=&status=&q=
app.get('/api/loc', verifyAuth, async (req, res) => {
  try {
    const { branchCode, sessionCode, examClass, status, q } = req.query
    let query = supabase.from('loc_candidates')
      .select('*, students(full_name, admission_no, class_name, section), branches(code)')
      .order('candidate_name').limit(1000)
    if (branchCode) { const bid = await branchIdForCode(branchCode); if (!bid) return res.json({ candidates: [] }); query = query.eq('branch_id', bid) }
    if (sessionCode) query = query.eq('session_code', sessionCode)
    if (examClass)   query = query.eq('exam_class', examClass)
    if (status)      query = query.eq('status', status)
    if (q?.trim())   query = query.or(`candidate_name.ilike.%${q.trim()}%,aadhaar_no.ilike.%${q.trim()}%,apaar_id.ilike.%${q.trim()}%`)
    const { data, error } = await query
    if (error) throw error
    res.json({ candidates: data })
  } catch (e) { console.error('[admin] GET /api/loc:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/loc/eligible?branchCode=&sessionCode=&examClass= — Class 10/12 students not yet enrolled.
app.get('/api/loc/eligible', verifyAuth, async (req, res) => {
  try {
    const { branchCode, sessionCode, examClass } = req.query
    if (!branchCode || !sessionCode || !examClass) return res.json({ students: [] })
    const bid = await branchIdForCode(branchCode)
    if (!bid) return res.json({ students: [] })
    let sq = supabase.from('students')
      .select('id, full_name, admission_no, class_name, section, roll_number')
      .eq('branch_id', bid).eq('is_active', true).eq('deleted_in_sms', false)
    sq = examClass === '10' ? sq.eq('class_name', 'Class 10') : sq.ilike('class_name', 'Class 12%')
    const { data: sd, error } = await sq.order('class_name').order('roll_number')
    if (error) throw error
    const { data: enrolled } = await supabase.from('loc_candidates').select('student_id').eq('session_code', sessionCode).eq('exam_class', examClass)
    const taken = new Set((enrolled || []).map(r => r.student_id))
    res.json({ students: (sd || []).filter(s => !taken.has(s.id)) })
  } catch (e) { console.error('[admin] GET /api/loc/eligible:', e); res.status(500).json({ error: e.message }) }
})

// GET /api/loc/subjects?examClass=&stream=
app.get('/api/loc/subjects', verifyAuth, async (req, res) => {
  try {
    const { examClass, stream } = req.query
    let q = supabase.from('cbse_subjects').select('code, name, exam_class, stream').eq('is_active', true).order('code')
    if (examClass) q = q.eq('exam_class', examClass)
    const { data, error } = await q
    if (error) throw error
    const all = data || []
    res.json({ subjects: !stream ? all.filter(s => s.stream == null) : all.filter(s => s.stream == null || s.stream === stream) })
  } catch (e) { console.error('[admin] GET /api/loc/subjects:', e); res.status(500).json({ error: e.message }) }
})

// POST /api/loc/enrol  { studentId, sessionCode, examClass }
app.post('/api/loc/enrol', verifyAuth, async (req, res) => {
  try {
    const { studentId, sessionCode, examClass } = req.body || {}
    if (!studentId || !sessionCode || !examClass) return res.status(400).json({ error: 'studentId, sessionCode, examClass required' })
    const { data: st, error: se } = await supabase.from('students')
      .select('id, branch_id, class_name, full_name, father_name, mother_name, date_of_birth, gender, category, religion, apaar_id, science_path')
      .eq('id', studentId).single()
    if (se) throw se
    const row = {
      student_id: st.id, branch_id: st.branch_id, session_code: sessionCode, exam_class: examClass,
      stream: detectStream(st.class_name), science_path: st.science_path || null,
      candidate_name: st.full_name, father_name: st.father_name, mother_name: st.mother_name,
      date_of_birth: st.date_of_birth, gender: st.gender, category: st.category, religion: st.religion,
      apaar_id: st.apaar_id, created_by: req.user.email,
    }
    const { data, error } = await supabase.from('loc_candidates').insert(row).select('*').single()
    if (error) throw error
    res.json({ candidate: data })
  } catch (e) { console.error('[admin] POST /api/loc/enrol:', e); res.status(500).json({ error: e.message }) }
})

// PATCH /api/loc/:id — edit CBSE fields (whitelisted).
app.patch('/api/loc/:id', verifyAuth, async (req, res) => {
  try {
    const patch = { updated_by: req.user.email, updated_at: new Date().toISOString() }
    for (const k of LOC_EDITABLE) if (k in (req.body || {})) patch[k] = req.body[k]
    const { data, error } = await supabase.from('loc_candidates').update(patch).eq('id', req.params.id).select('*').single()
    if (error) throw error
    res.json({ candidate: data })
  } catch (e) { console.error('[admin] PATCH /api/loc/:id:', e); res.status(500).json({ error: e.message }) }
})

// POST /api/loc/:id/finalise  &  /withdraw
app.post('/api/loc/:id/finalise', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('loc_candidates').update({ status: 'finalised', finalised_at: new Date().toISOString(), finalised_by: req.user.email, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single()
    if (error) throw error; res.json({ candidate: data })
  } catch (e) { console.error('[admin] POST /api/loc/:id/finalise:', e); res.status(500).json({ error: e.message }) }
})
app.post('/api/loc/:id/withdraw', verifyAuth, async (req, res) => {
  try {
    const { reason } = req.body || {}
    const { data, error } = await supabase.from('loc_candidates').update({ status: 'withdrawn', withdrawn_at: new Date().toISOString(), withdrawn_by: req.user.email, withdrawal_reason: reason || null, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single()
    if (error) throw error; res.json({ candidate: data })
  } catch (e) { console.error('[admin] POST /api/loc/:id/withdraw:', e); res.status(500).json({ error: e.message }) }
})

// DELETE /api/loc/:id
app.delete('/api/loc/:id', verifyAuth, async (req, res) => {
  try { const { error } = await supabase.from('loc_candidates').delete().eq('id', req.params.id); if (error) throw error; res.json({ ok: true }) }
  catch (e) { console.error('[admin] DELETE /api/loc/:id:', e); res.status(500).json({ error: e.message }) }
})

// ─── Static + SPA fallback (must come AFTER /api routes) ────────────────────
app.use(express.static(distDir, {
  maxAge: '1y',
  index: false,
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
  },
}))

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`[admin] listening on port ${PORT}  (apiReady=${apiReady})`)
})
