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

export function registerHpcRoutes(app, { supabase, verifyAuth, branchIdForCode }) {
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
}
