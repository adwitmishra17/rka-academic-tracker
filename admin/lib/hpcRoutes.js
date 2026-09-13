// ============================================================================
// admin/lib/hpcRoutes.js — Holistic Progress Card: setup + office entry.
//   GET  /api/hpc/setup?sessionCode=           the session's HPC definition (seeded on first read)
//   PUT  /api/hpc/setup { sessionCode, definition }
//   GET  /api/hpc/entries?branchCode&sessionCode&termId&className&section
//        roster × existing assessments for the grid
//   POST /api/hpc/entries { branchCode, sessionCode, termId, rows:[{studentId, domains, generalRemarks}] }
//        upsert (non-void row per student+term), source 'manual', student snapshot frozen
// Registered from server.js BEFORE the older /api/hpc/:id route.
// ============================================================================
import { DEFAULT_HPC_DEFINITION } from './hpcDefaults.js'
import { renderHpcHtml, renderHpcDocument, renderHpcPages, HPC_CSS } from './hpcRender.js'

export function registerHpcRoutes(app, { supabase, verifyAuth, branchIdForCode, admin }) {
  const bad = (res, m) => res.status(400).json({ error: m })
  const fail = (res, e, where) => { console.error(`[admin] ${where}:`, e); res.status(500).json({ error: e.message }) }

  async function definitionFor(sessionCode, seed = true) {
    const { data, error } = await supabase.from('report_card_templates').select('id, name, definition, updated_at, updated_by').eq('session_code', sessionCode).eq('family', 'hpc').eq('is_active', true).order('updated_at', { ascending: false }).limit(1)
    if (error) throw error
    if (data?.length) return data[0]
    if (!seed) return null
    // New session: carry last session's setup forward (domains, scale, classes), else the built-in default
    const prevCode = (() => { const y = parseInt(String(sessionCode).slice(0, 4), 10); return Number.isFinite(y) ? `${y - 1}-${String(y % 100).padStart(2, '0')}` : null })()
    let definition = DEFAULT_HPC_DEFINITION, from = 'hpc-seed'
    if (prevCode) {
      const prev = await supabase.from('report_card_templates').select('definition').eq('session_code', prevCode).eq('family', 'hpc').eq('is_active', true).limit(1)
      if (prev.data?.[0]?.definition?.domains?.length) { definition = prev.data[0].definition; from = `hpc-seed:copied-from-${prevCode}` }
    }
    const ins = await supabase.from('report_card_templates').insert({ session_code: sessionCode, family: 'hpc', name: 'Holistic Progress Card', definition, is_active: true, updated_by: from }).select('id, name, definition, updated_at, updated_by').single()
    if (ins.error) throw ins.error
    return ins.data
  }

  app.get('/api/hpc/setup', verifyAuth, async (req, res) => {
    try {
      const sessionCode = String(req.query.sessionCode || '').trim()
      if (!sessionCode) return bad(res, 'sessionCode required')
      res.json({ template: await definitionFor(sessionCode) })
    } catch (e) { fail(res, e, 'GET /api/hpc/setup') }
  })

  app.put('/api/hpc/setup', verifyAuth, async (req, res) => {
    try {
      const { sessionCode, definition } = req.body || {}
      if (!sessionCode || !definition || typeof definition !== 'object') return bad(res, 'sessionCode and definition required')
      const d = definition
      if (!Array.isArray(d.classes) || !Array.isArray(d.domains) || !d.scale?.options?.length) return bad(res, 'definition needs classes[], domains[] and scale.options[]')
      const keys = new Set()
      for (const dom of d.domains) {
        if (!dom.key || !dom.name?.trim()) return bad(res, 'every domain needs a key and a name')
        if (keys.has(dom.key)) return bad(res, `duplicate domain key ${dom.key}`); keys.add(dom.key)
        const ik = new Set()
        for (const ind of dom.indicators || []) { if (!ind.key || !ind.label?.trim()) return bad(res, `indicator in ${dom.name} needs a key and a label`); if (ik.has(ind.key)) return bad(res, `duplicate indicator key ${ind.key} in ${dom.name}`); ik.add(ind.key) }
      }
      const cur = await definitionFor(sessionCode)
      const { data, error } = await supabase.from('report_card_templates').update({ definition: d, updated_at: new Date().toISOString(), updated_by: req.user?.email || null }).eq('id', cur.id).select('id, name, definition, updated_at, updated_by').single()
      if (error) throw error
      res.json({ template: data })
    } catch (e) { fail(res, e, 'PUT /api/hpc/setup') }
  })

  const STUDENT_COLS = 'id, full_name, admission_no, class_name, section, roll_number, date_of_birth, father_name, mother_name, photo_key, branch_id'
  async function roster(branchId, className, section) {
    let q = supabase.from('students').select(STUDENT_COLS).eq('branch_id', branchId).eq('class_name', className).eq('is_active', true).eq('deleted_in_sms', false).eq('enrollment_kind', 'regular').order('section').order('roll_number').order('full_name')
    if (section) q = q.eq('section', section)
    const { data, error } = await q
    if (error) throw error
    return data || []
  }

  app.get('/api/hpc/entries', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, termId, className, section } = req.query
      if (!branchCode || !sessionCode || !termId || !className) return bad(res, 'branchCode, sessionCode, termId, className required')
      const bid = await branchIdForCode(branchCode)
      if (!bid) return bad(res, `Branch '${branchCode}' not found`)
      const [tpl, students, term] = await Promise.all([definitionFor(sessionCode), roster(bid, className, section || undefined), supabase.from('exam_terms').select('id, name, short_code').eq('id', termId).single()])
      const sids = students.map((s) => s.id)
      const { data: rows, error } = sids.length ? await supabase.from('hpc_assessments').select('id, student_id, domains, general_remarks, source, assessed_at, assessed_by, updated_at').eq('term_id', termId).eq('is_void', false).in('student_id', sids) : { data: [] }
      if (error) throw error
      const byStudent = Object.fromEntries((rows || []).map((r) => [r.student_id, r]))
      res.json({
        template: tpl, term: term.data || null,
        students: students.map((s) => ({ id: s.id, name: s.full_name, admissionNo: s.admission_no, section: s.section, roll: s.roll_number, assessment: byStudent[s.id] || null })),
      })
    } catch (e) { fail(res, e, 'GET /api/hpc/entries') }
  })

  app.post('/api/hpc/entries', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, termId, rows } = req.body || {}
      if (!branchCode || !sessionCode || !termId || !Array.isArray(rows)) return bad(res, 'branchCode, sessionCode, termId, rows[] required')
      const bid = await branchIdForCode(branchCode)
      if (!bid) return bad(res, `Branch '${branchCode}' not found`)
      const sids = rows.map((r) => r.studentId).filter(Boolean)
      if (!sids.length) return res.json({ saved: 0 })
      const [{ data: students, error: sErr }, { data: existing, error: eErr }] = await Promise.all([
        supabase.from('students').select(STUDENT_COLS).in('id', sids),
        supabase.from('hpc_assessments').select('id, student_id').eq('term_id', termId).eq('is_void', false).in('student_id', sids),
      ])
      if (sErr) throw sErr; if (eErr) throw eErr
      const stu = Object.fromEntries((students || []).map((s) => [s.id, s]))
      const ex = Object.fromEntries((existing || []).map((r) => [r.student_id, r.id]))
      const who = req.user?.email || req.user?.uid || null, now = new Date().toISOString()
      let saved = 0
      for (const r of rows) {
        const s = stu[r.studentId]; if (!s) continue
        const domains = r.domains && typeof r.domains === 'object' ? r.domains : {}
        const general_remarks = r.generalRemarks?.trim() ? r.generalRemarks.trim() : null
        if (ex[r.studentId]) {
          const { error } = await supabase.from('hpc_assessments').update({ domains, general_remarks, source: 'manual', assessed_at: now, assessed_by: who, updated_at: now }).eq('id', ex[r.studentId])
          if (error) throw error
        } else {
          const { error } = await supabase.from('hpc_assessments').insert({
            branch_id: bid, session_code: sessionCode, term_id: termId, student_id: s.id,
            student_name: s.full_name, admission_no: s.admission_no, class_name: s.class_name, section: s.section, roll_number: s.roll_number, date_of_birth: s.date_of_birth, father_name: s.father_name, mother_name: s.mother_name, photo_key: s.photo_key,
            domains, general_remarks, source: 'manual', assessed_at: now, assessed_by: who,
          })
          if (error) throw error
        }
        saved += 1
      }
      res.json({ saved })
    } catch (e) { fail(res, e, 'POST /api/hpc/entries') }
  })

  // ── Render: assessment → four-page HTML (stored on the row; SMS prints it) ──
  const HPC_SELECT = 'id, branch_id, session_code, term_id, student_id, student_name, admission_no, class_name, section, roll_number, date_of_birth, father_name, mother_name, photo_key, domains, general_remarks, assessed_at, source, is_void, branches(code, name), exam_terms(id, name, short_code, session_code)'
  const photoCache = new Map()   // photo_key → data URL (process lifetime)
  async function photoDataUrl(key) {
    if (!key) return null
    if (photoCache.has(key)) return photoCache.get(key)
    let out = null
    try {
      const r = await fetch(`${process.env.SUPABASE_URL}/functions/v1/r2-sign`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify({ op: 'download_data', key }) })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.data_url) out = j.data_url
    } catch (e) { console.warn('[hpc] photo fetch failed', key, e.message) }
    photoCache.set(key, out)
    return out
  }
  async function classTeacherName(branchCode, className) {
    try {
      const snap = await admin.firestore().collection('classTeacherByEmail').where('className', '==', className).get()
      const hit = snap.docs.map((d) => d.data()).find((x) => !branchCode || x.branchCode === branchCode)
      return hit?.teacherName || null
    } catch { return null }
  }
  async function attendanceByMonth(studentId, sessionCode) {
    const y = Number(String(sessionCode).slice(0, 4))
    const { data } = await supabase.from('attendance_records').select('date, status').eq('student_id', studentId).gte('date', `${y}-04-01`).lte('date', `${y + 1}-03-31`)
    const byMonth = {}; let marked = 0, present = 0
    for (const r of data || []) {
      const m = String(r.date).slice(5, 7); const p = r.status === 'present' || r.status === 'late' ? 1 : r.status === 'half_day' ? 0.5 : 0
      const c = (byMonth[m] ||= { marked: 0, present: 0 }); c.marked += 1; c.present += p; marked += 1; present += p
    }
    return { byMonth, marked, present }
  }
  async function buildCard(a, defs) {
    if (!defs[a.session_code]) defs[a.session_code] = (await definitionFor(a.session_code)).definition
    const [attendance, meta, classTeacher, photo] = await Promise.all([
      attendanceByMonth(a.student_id, a.session_code),
      supabase.from('report_card_student_meta').select('height_cm, weight_kg').eq('student_id', a.student_id).eq('session_code', a.session_code).is('term_id', null).limit(1).then((r) => r.data?.[0] || null),
      classTeacherName(a.branches?.code, a.class_name),
      photoDataUrl(a.photo_key),
    ])
    return { assessment: a, def: defs[a.session_code], extras: { attendance, heightCm: meta?.height_cm ?? null, weightKg: meta?.weight_kg ?? null, classTeacher, photoDataUrl: photo, printedAt: new Date().toISOString() } }
  }
  /** Render + store one or more assessments. Returns [{ id, pages }] (pages = the four .page divs). */
  async function renderAndStore(ids, who) {
    const { data, error } = await supabase.from('hpc_assessments').select(HPC_SELECT).in('id', ids)
    if (error) throw error
    const byId = Object.fromEntries((data || []).map((a) => [a.id, a]))
    const defs = {}, out = []
    for (const id of ids) {
      const a = byId[id]; if (!a) continue
      const card = await buildCard(a, defs)
      const html = renderHpcHtml(card)
      await supabase.from('hpc_assessments').update({ rendered_html: html, rendered_at: new Date().toISOString() }).eq('id', id)
      out.push({ id, pages: renderHpcPages(card), student: a.student_name })
    }
    return out
  }

  // POST /api/hpc/render { ids[] } → { html: one printable document, cards:[{id, student}] }
  app.post('/api/hpc/render', verifyAuth, async (req, res) => {
    try {
      const ids = (req.body?.ids || []).filter(Boolean).slice(0, 80)
      if (!ids.length) return bad(res, 'ids[] required')
      const cards = await renderAndStore(ids, req.user?.email)
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Holistic Progress Cards</title><style>${HPC_CSS}</style></head><body>${cards.map((c) => c.pages).join('\n')}</body></html>`
      res.json({ html, cards: cards.map((c) => ({ id: c.id, student: c.student })) })
    } catch (e) { fail(res, e, 'POST /api/hpc/render') }
  })
}
