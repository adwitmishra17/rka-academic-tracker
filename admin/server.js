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
 *   isActive   = true|false  (optional; defaults to undefined = all)
 */
app.get('/api/students', verifyAuth, async (req, res) => {
  try {
    const branches = await loadBranches()
    let q = supabase.from('students').select('*')

    if (req.query.branchCode) {
      const bid = await branchIdForCode(req.query.branchCode)
      if (!bid) return res.json({ students: [] })
      q = q.eq('branch_id', bid)
    }
    if (req.query.className) q = q.eq('class_name', req.query.className)
    if (req.query.isActive === 'true')  q = q.eq('is_active', true)
    if (req.query.isActive === 'false') q = q.eq('is_active', false)

    // Default to active-only; Tracker UI explicitly toggles to show withdrawn.
    // If neither was specified, leave the filter off so the toggle works.
    const { data, error } = await q.order('class_name').order('roll_number')
    if (error) throw error
    res.json({ students: data.map(r => toFrontendStudent(r, branches)) })
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
