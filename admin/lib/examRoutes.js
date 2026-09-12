// ============================================================================
// admin/lib/examRoutes.js — Examinations window API (single-window pipeline)
//
// Stages (all under one page in the SPA):
//   Setup    → terms + subjects/teachers + class↔template binding   (writes Supabase DIRECTLY; the
//              Firestore examSessions/examTerms/examSubjects config + Cloud Function mirror are retired)
//   Rules    → template scoring rules (PUT /api/report-templates/:id, unchanged)
//   Papers   → generated from the rules (typed component_key + card_max)
//   Status   → who has entered what, per subject × paper
//   Cards    → compute (cardEngine) → render (cardRender) → publish snapshot
//
// Registered from server.js: registerExamRoutes(app, { supabase, admin, verifyAuth, branchIdForCode })
// ============================================================================

import { computeCard, planCard, resolveRows, resolveSeniorNames, seniorOptionals, generatePaperSpecs, applyClassStats, normName } from './cardEngine.js'
import { renderCardHtml } from './cardRender.js'

const STANDARD_TERMS = [
  { shortCode: 'T1', name: 'Term 1', sortOrder: 1 },
  { shortCode: 'HY', name: 'Half Yearly', sortOrder: 2 },
  { shortCode: 'T2', name: 'Term 2', sortOrder: 3 },
  { shortCode: 'AN', name: 'Annual', sortOrder: 4 },
]
const PAPER_SELECT = 'id, term_id, subject_id, paper_name, component_key, max_marks, card_max, passing_marks, exam_date, has_practical, theory_max, practical_max, generated'
// Name heuristics used ONCE to adopt legacy free-text papers into typed slots.
const ADOPT_PATTERNS = {
  pt:        /p\s*\.?\s*a\s*\.?|p\s*\.?\s*t\b|periodic|unit\s*test|^ut\b/i,
  exam:      /^main$|exam|half|annual|yearly|term/i,
  portfolio: /portfolio|notebook|note\s*book/i,
  se:        /enrich|^s\.?\s*e\.?$|subject\s*enr/i,
}

export function registerExamRoutes(app, { supabase, admin, verifyAuth, branchIdForCode }) {
  const fsdb = () => admin.firestore()
  const err = (res, e, where) => { console.error(`[admin] ${where}:`, e); res.status(e.status || 500).json({ error: e.message || String(e) }) }
  const bad = (res, msg) => res.status(400).json({ error: msg })

  async function pagedAll(build) {
    const out = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build().range(from, from + 999)
      if (error) throw error
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return out
  }

  // ── Firestore helpers (identity stays in Firebase) ─────────────────────────
  async function teacherById(id) {
    if (!id) return null
    const snap = await fsdb().collection('teachers').doc(id).get()
    if (!snap.exists) return null
    const t = snap.data()
    return { id: snap.id, name: t.fullName || t.name || '', email: String(t.email || t.personalEmail || '').trim().toLowerCase() || null }
  }
  async function activeTeachers(branchCode) {
    const snap = await fsdb().collection('teachers').where('isActive', '==', true).get()
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => !branchCode || !Array.isArray(t.branchCodes) || t.branchCodes.includes(branchCode))
      .map((t) => ({ id: t.id, name: t.fullName || t.name || '', email: String(t.email || t.personalEmail || '').trim().toLowerCase() || null, classTeacherOf: t.classTeacherOf || null }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  async function classTeachers(branchCode) {
    const snap = await fsdb().collection('classTeacherByEmail').get()
    const out = {}
    for (const d of snap.docs) { const x = d.data(); if (x.className && (!branchCode || x.branchCode === branchCode)) out[x.className] = { name: x.teacherName || '', email: d.id, teacherId: x.teacherDocId || null } }
    return out
  }
  async function timetableSlots(branchCode) {
    const snap = await fsdb().collection('timetable').where('branchCode', '==', branchCode).get()
    return snap.docs.map((d) => d.data())
  }
  // ── Supabase bundle for a class ────────────────────────────────────────────
  async function loadBundle(branchId, sessionCode, className) {
    const [t, s, tpl, map] = await Promise.all([
      supabase.from('exam_terms').select('id, name, short_code, sort_order, starts_on, ends_on, result_date, is_finalized').eq('branch_id', branchId).eq('session_code', sessionCode).order('sort_order'),
      supabase.from('exam_subjects').select('id, subject_name, subject_code, kind, is_optional, sort_order, assigned_teacher_id, assigned_teacher_email, assigned_teacher_name').eq('branch_id', branchId).eq('session_code', sessionCode).eq('class_name', className).order('sort_order').order('subject_name'),
      supabase.from('report_card_template_classes').select('template_id').eq('session_code', sessionCode).eq('class_name', className).maybeSingle(),
      null,
    ])
    if (t.error) throw t.error
    if (s.error) throw s.error
    let template = null
    if (tpl.data?.template_id) {
      const r = await supabase.from('report_card_templates').select('id, family, name, definition').eq('id', tpl.data.template_id).single()
      if (r.error) throw r.error
      template = r.data
    }
    const subjectIds = (s.data || []).map((x) => x.id)
    let papers = []
    if (subjectIds.length) {
      const r = await supabase.from('exam_papers').select(PAPER_SELECT).in('subject_id', subjectIds)
      if (r.error) throw r.error
      papers = r.data || []
    }
    return { terms: t.data || [], subjects: s.data || [], template, papers }
  }
  async function roster(branchId, className, section) {
    let q = supabase.from('students')
      .select('id, full_name, admission_no, class_name, section, roll_number, date_of_birth, father_name, mother_name, photo_key, house, apaar_id, gender, branch_id, optional_subject, science_path, board_reg_no, legacy_comp_id, branches(code, name)')
      .eq('branch_id', branchId).eq('class_name', className).eq('is_active', true).eq('deleted_in_sms', false).eq('enrollment_kind', 'regular')
      .order('section').order('roll_number').order('full_name')
    if (section) q = q.eq('section', section)
    const { data, error } = await q
    if (error) throw error
    return data || []
  }
  function sessionWindow(sessionCode) {
    const y = Number(String(sessionCode).slice(0, 4))
    return { from: `${y}-04-01`, to: `${y + 1}-03-31`, mid: `${y}-09-30` }
  }
  async function attendanceFor(studentIds, sessionCode, terms) {
    if (!studentIds.length) return {}
    const w = sessionWindow(sessionCode)
    const rows = await pagedAll(() => supabase.from('attendance_records').select('student_id, date, status').in('student_id', studentIds).gte('date', w.from).lte('date', w.to))
    const termWindow = (code) => {
      const t = terms.find((x) => x.short_code === code)
      if (t?.starts_on && t?.ends_on) return [t.starts_on, t.ends_on]
      return ['T1', 'HY'].includes(code) ? [w.from, w.mid] : [w.mid < w.to ? nextDay(w.mid) : w.from, w.to]
    }
    const out = {}
    for (const r of rows) {
      const o = (out[r.student_id] ||= { sessionTotal: { present: 0, marked: 0 }, byTerm: {} })
      const p = r.status === 'present' || r.status === 'late' ? 1 : r.status === 'half_day' ? 0.5 : 0
      o.sessionTotal.marked += 1; o.sessionTotal.present += p
      for (const t of terms) {
        const [a, b] = termWindow(t.short_code)
        if (r.date >= a && r.date <= b) { const x = (o.byTerm[t.short_code] ||= { present: 0, marked: 0 }); x.marked += 1; x.present += p }
      }
    }
    return out
  }
  function nextDay(d) { const x = new Date(d); x.setDate(x.getDate() + 1); return x.toISOString().slice(0, 10) }

  // Compute every student's card for a class (+ rank/section-highest)
  /** Subjects that feed a row on the class's card. Senior rows resolve per student
   *  (science_path drops Biology or Mathematics; optional_subject adds one), so the
   *  class-wide set is the union over the roster and `applicable` says which
   *  subjects each student actually takes (null for every other family). */
  function cardSubjects(b, className, students) {
    if (!b.template) return { onCard: null, applicable: null }
    const def = b.template.definition, fam = b.template.family
    if (fam === 'senior_progress' && students?.length) {
      const onCard = new Set(), applicable = {}
      for (const st of students) { const ids = resolveRows(def, fam, className, b.subjects, st).flatMap((r) => r.subjectIds); applicable[st.id] = ids; for (const id of ids) onCard.add(id) }
      return { onCard, applicable }
    }
    return { onCard: new Set(resolveRows(def, fam, className, b.subjects, null).flatMap((r) => r.subjectIds)), applicable: null }
  }
  async function computeClass({ branchId, branchCode, sessionCode, className, cardKey, section, studentIds }) {
    const b = await loadBundle(branchId, sessionCode, className)
    if (!b.template) throw Object.assign(new Error(`${className} has no report-card template bound (Setup stage)`), { status: 400 })
    let students = await roster(branchId, className, section)
    if (studentIds?.length) students = students.filter((s) => studentIds.includes(s.id))
    const sids = students.map((s) => s.id)
    const paperIds = b.papers.map((p) => p.id)
    const [marks, grades, meta, attendance, cts] = await Promise.all([
      paperIds.length && sids.length ? pagedAll(() => supabase.from('exam_marks').select('paper_id, student_id, marks_obtained, theory_obtained, practical_obtained, is_absent, source').in('paper_id', paperIds).in('student_id', sids)) : [],
      sids.length ? pagedAll(() => supabase.from('exam_coscholastic_grades').select('student_id, subject_id, term_id, grade, entered_at').in('student_id', sids).in('term_id', b.terms.map((t) => t.id))) : [],
      sids.length ? pagedAll(() => supabase.from('report_card_student_meta').select('student_id, term_id, discipline, remarks, achievement, height_cm, weight_kg, promoted_to, updated_at').eq('session_code', sessionCode).in('student_id', sids)) : [],
      attendanceFor(sids, sessionCode, b.terms),
      classTeachers(branchCode).catch(() => ({})),
    ])
    const classTeacher = cts?.[className]?.name || null
    const plan = planCard(b.template.definition, b.template.family)
    const by = (arr, k) => { const m = new Map(); for (const r of arr) { if (!m.has(r[k])) m.set(r[k], []); m.get(r[k]).push(r) } return m }
    const marksBy = by(marks, 'student_id'), gradesBy = by(grades, 'student_id'), metaBy = by(meta, 'student_id')
    const cards = students.map((st) => {
      return computeCard({
        def: b.template.definition, family: b.template.family, templateName: b.template.name, className, sessionCode, cardKey,
        student: st, subjects: b.subjects, terms: b.terms, papers: b.papers,
        marks: marksBy.get(st.id) || [], coGrades: gradesBy.get(st.id) || [], meta: metaBy.get(st.id) || [],
        attendance: attendance[st.id] || null, classTeacher,
      })
    })
    applyClassStats(cards)
    return { bundle: b, students, cards, plan }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/exam/config?branchCode=&sessionCode=
  app.get('/api/exam/config', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode } = req.query
      if (!branchCode || !sessionCode) return bad(res, 'branchCode and sessionCode required')
      const bid = await branchIdForCode(branchCode)
      if (!bid) return bad(res, `Branch '${branchCode}' not found`)
      const [terms, subjects, tpl, map, teachers, cts, sessions] = await Promise.all([
        supabase.from('exam_terms').select('id, name, short_code, sort_order, starts_on, ends_on, result_date, is_finalized').eq('branch_id', bid).eq('session_code', sessionCode).order('sort_order'),
        supabase.from('exam_subjects').select('id, class_name, subject_name, subject_code, kind, is_optional, sort_order, assigned_teacher_id, assigned_teacher_email, assigned_teacher_name').eq('branch_id', bid).eq('session_code', sessionCode).order('class_name').order('sort_order').order('subject_name'),
        supabase.from('report_card_templates').select('id, session_code, family, name, definition, is_active').eq('session_code', sessionCode).order('name'),
        supabase.from('report_card_template_classes').select('class_name, template_id').eq('session_code', sessionCode),
        activeTeachers(branchCode), classTeachers(branchCode),
        supabase.from('exam_terms').select('session_code'),
      ])
      for (const r of [terms, subjects, tpl, map, sessions]) if (r.error) throw r.error
      // Legacy rows (Cloud-Function era) carry only assigned_teacher_email — backfill id + name once by email.
      const byEmail = new Map(teachers.filter((t) => t.email).map((t) => [t.email, t]))
      const fixes = (subjects.data || []).filter((s) => s.assigned_teacher_email && (!s.assigned_teacher_id || !s.assigned_teacher_name) && byEmail.has(s.assigned_teacher_email))
      for (const s of fixes) {
        const t = byEmail.get(s.assigned_teacher_email)
        s.assigned_teacher_id = t.id; s.assigned_teacher_name = t.name
        await supabase.from('exam_subjects').update({ assigned_teacher_id: t.id, assigned_teacher_name: t.name }).eq('id', s.id)
      }
      const classMap = {}; for (const r of map.data || []) classMap[r.class_name] = r.template_id
      // paper coverage per class: how many typed papers exist
      const subjIds = (subjects.data || []).map((s) => s.id)
      let paperCounts = {}
      if (subjIds.length) {
        const papers = await pagedAll(() => supabase.from('exam_papers').select('subject_id, component_key').in('subject_id', subjIds))
        const cls = Object.fromEntries((subjects.data || []).map((s) => [s.id, s.class_name]))
        for (const p of papers) { const c = cls[p.subject_id]; const o = (paperCounts[c] ||= { typed: 0, legacy: 0 }); if (p.component_key) o.typed += 1; else o.legacy += 1 }
      }
      res.json({
        sessions: [...new Set((sessions.data || []).map((r) => r.session_code).filter(Boolean))].sort().reverse(),
        terms: terms.data || [], subjects: subjects.data || [], templates: tpl.data || [], classMap, teachers, classTeachers: cts, paperCounts,
      })
    } catch (e) { err(res, e, 'GET /api/exam/config') }
  })

  // POST /api/exam/terms/seed { branchCode, sessionCode }
  app.post('/api/exam/terms/seed', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode } = req.body || {}
      if (!branchCode || !/^\d{4}-\d{2}$/.test(String(sessionCode || ''))) return bad(res, 'branchCode and sessionCode (YYYY-YY) required')
      const bid = await branchIdForCode(branchCode)
      if (!bid) return bad(res, `Branch '${branchCode}' not found`)
      const rows = STANDARD_TERMS.map((t) => ({ branch_id: bid, session_code: sessionCode, name: t.name, short_code: t.shortCode, sort_order: t.sortOrder, is_finalized: false, tracker_doc_id: `${branchCode}_${sessionCode}_${t.shortCode}`, created_by: req.user.email, updated_by: req.user.email }))
      const { error } = await supabase.from('exam_terms').upsert(rows, { onConflict: 'branch_id,session_code,short_code', ignoreDuplicates: true })
      if (error) throw error
      const { data } = await supabase.from('exam_terms').select('id, name, short_code, sort_order, starts_on, ends_on, result_date, is_finalized').eq('branch_id', bid).eq('session_code', sessionCode).order('sort_order')
      res.json({ terms: data || [] })
    } catch (e) { err(res, e, 'POST /api/exam/terms/seed') }
  })

  // PATCH /api/exam/terms/:id { startsOn, endsOn, resultDate, isFinalized }
  app.patch('/api/exam/terms/:id', verifyAuth, async (req, res) => {
    try {
      const b = req.body || {}
      const patch = { updated_at: new Date().toISOString(), updated_by: req.user.email }
      if (b.startsOn !== undefined) patch.starts_on = b.startsOn || null
      if (b.endsOn !== undefined) patch.ends_on = b.endsOn || null
      if (b.resultDate !== undefined) patch.result_date = b.resultDate || null
      if (b.isFinalized !== undefined) patch.is_finalized = !!b.isFinalized
      const { data, error } = await supabase.from('exam_terms').update(patch).eq('id', req.params.id).select('id, name, short_code, sort_order, starts_on, ends_on, result_date, is_finalized').single()
      if (error) throw error
      res.json({ term: data })
    } catch (e) { err(res, e, 'PATCH /api/exam/terms/:id') }
  })

  // GET /api/exam/timetable-subjects?branchCode= → class → [{subjectName, teacherId, teacherName, count}]
  app.get('/api/exam/timetable-subjects', verifyAuth, async (req, res) => {
    try {
      const { branchCode } = req.query
      if (!branchCode) return bad(res, 'branchCode required')
      const slots = await timetableSlots(branchCode)
      const byClass = {}
      for (const s of slots) {
        const classes = (Array.isArray(s.classNames) && s.classNames.length ? s.classNames : String(s.className || '').split('+')).map((c) => String(c || '').trim()).filter(Boolean)
        const subject = String(s.subject || '').trim(); if (!subject) continue
        for (const cls of classes) {
          const m = (byClass[cls] ||= {})
          const slot = (m[subject] ||= { subjectName: subject, teachers: {} })
          const tid = s.teacherId || ''
          const t = (slot.teachers[tid] ||= { teacherId: tid, teacherName: s.teacherName || '', count: 0 }); t.count += 1
        }
      }
      const out = {}
      for (const [cls, m] of Object.entries(byClass)) out[cls] = Object.values(m).map((slot) => { const best = Object.values(slot.teachers).sort((a, b) => b.count - a.count)[0]; return { subjectName: slot.subjectName, teacherId: best?.teacherId || '', teacherName: best?.teacherName || '', count: Object.values(slot.teachers).reduce((s, t) => s + t.count, 0) } }).sort((a, b) => a.subjectName.localeCompare(b.subjectName))
      res.json({ byClass: out })
    } catch (e) { err(res, e, 'GET /api/exam/timetable-subjects') }
  })

  // POST /api/exam/subjects/bulk { branchCode, sessionCode, rows:[{className, subjectName, kind, sortOrder, teacherId, isOptional}] }
  app.post('/api/exam/subjects/bulk', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, rows } = req.body || {}
      if (!branchCode || !sessionCode || !Array.isArray(rows) || !rows.length) return bad(res, 'branchCode, sessionCode, rows[] required')
      const bid = await branchIdForCode(branchCode)
      if (!bid) return bad(res, `Branch '${branchCode}' not found`)
      const tcache = new Map()
      const teacher = async (id) => { if (!id) return null; if (!tcache.has(id)) tcache.set(id, await teacherById(id)); return tcache.get(id) }
      const now = new Date().toISOString()
      const out = []
      for (const r of rows) {
        if (!r.className || !r.subjectName) continue
        const t = await teacher(r.teacherId)
        out.push({
          branch_id: bid, session_code: sessionCode, class_name: String(r.className).trim(), subject_name: String(r.subjectName).trim(),
          kind: r.kind === 'co_scholastic' ? 'co_scholastic' : 'scholastic', is_optional: !!r.isOptional, sort_order: Number(r.sortOrder ?? 0),
          assigned_teacher_id: t?.id || null, assigned_teacher_email: t?.email || null, assigned_teacher_name: t?.name || null,
          updated_at: now, updated_by: req.user.email,
        })
      }
      const { data, error } = await supabase.from('exam_subjects').upsert(out, { onConflict: 'branch_id,session_code,class_name,subject_name' }).select('id, class_name, subject_name')
      if (error) throw error
      res.json({ saved: data?.length || 0 })
    } catch (e) { err(res, e, 'POST /api/exam/subjects/bulk') }
  })

  // PATCH /api/exam/subjects/:id { teacherId|null, kind, sortOrder, isOptional }
  app.patch('/api/exam/subjects/:id', verifyAuth, async (req, res) => {
    try {
      const b = req.body || {}
      const patch = { updated_at: new Date().toISOString(), updated_by: req.user.email }
      if (b.teacherId !== undefined) {
        const t = b.teacherId ? await teacherById(b.teacherId) : null
        if (b.teacherId && !t) return bad(res, 'Teacher not found')
        if (t && !t.email) return bad(res, `${t.name} has no email on their teacher record — add one in Teachers, or they cannot log in to enter marks`)
        patch.assigned_teacher_id = t?.id || null; patch.assigned_teacher_email = t?.email || null; patch.assigned_teacher_name = t?.name || null
      }
      if (b.kind !== undefined) patch.kind = b.kind === 'co_scholastic' ? 'co_scholastic' : 'scholastic'
      if (b.sortOrder !== undefined) patch.sort_order = Number(b.sortOrder)
      if (b.isOptional !== undefined) patch.is_optional = !!b.isOptional
      const { data, error } = await supabase.from('exam_subjects').update(patch).eq('id', req.params.id).select('id, class_name, subject_name, subject_code, kind, is_optional, sort_order, assigned_teacher_id, assigned_teacher_email, assigned_teacher_name').single()
      if (error) throw error
      res.json({ subject: data })
    } catch (e) { err(res, e, 'PATCH /api/exam/subjects/:id') }
  })

  // DELETE /api/exam/subjects/:id — refused when any mark exists under it.
  app.delete('/api/exam/subjects/:id', verifyAuth, async (req, res) => {
    try {
      const { data: papers } = await supabase.from('exam_papers').select('id').eq('subject_id', req.params.id)
      if (papers?.length) {
        const { count } = await supabase.from('exam_marks').select('id', { count: 'exact', head: true }).in('paper_id', papers.map((p) => p.id))
        if (count > 0) return res.status(409).json({ error: `This subject has ${count} marks entered — it cannot be deleted. Change its teacher or kind instead.` })
      }
      const { error } = await supabase.from('exam_subjects').delete().eq('id', req.params.id)
      if (error) throw error
      res.json({ ok: true })
    } catch (e) { err(res, e, 'DELETE /api/exam/subjects/:id') }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RULES (read-side helper; writes go through PUT /api/report-templates/:id)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/exam/rules?branchCode=&sessionCode=&className= → template, derived plan, row mapping check
  app.get('/api/exam/rules', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, className } = req.query
      if (!branchCode || !sessionCode || !className) return bad(res, 'branchCode, sessionCode, className required')
      const bid = await branchIdForCode(branchCode)
      const b = await loadBundle(bid, sessionCode, className)
      if (!b.template) return res.json({ template: null, plan: null, rows: [], terms: b.terms })
      const plan = planCard(b.template.definition, b.template.family)
      const shape = (r, extra = {}) => ({ subject: r.subject, locCode: r.locCode, written: r.written, practical: r.practical, additional: r.additional, mapped: r.sources.map((s) => s.subject_name), unmapped: r.sources.length === 0, ...extra })
      const rows = resolveRows(b.template.definition, b.template.family, className, b.subjects, null).map((r) => shape(r))
      // Senior classes: the core prints for everyone; each student adds ONE optional (chosen in SMS)
      if (b.template.family === 'senior_progress') rows.push(...resolveSeniorNames(b.template.definition, seniorOptionals(b.template.definition, className), b.subjects).map((r) => shape(r, { optional: true })))
      res.json({ template: b.template, plan, rows, terms: b.terms, subjects: b.subjects.filter((s) => (s.kind || 'scholastic') === 'scholastic').map((s) => s.subject_name) })
    } catch (e) { err(res, e, 'GET /api/exam/rules') }
  })

  // POST /api/exam/card-areas/sync { branchCode, sessionCode, templateId }
  // Card areas (co-scholastic rows → RCA, graded subjects → RCG) live in the
  // template; the class teacher enters their grades against exam_subjects rows
  // of kind co_scholastic with that code. Make sure every class bound to the
  // template has one row per area (insert-only: never renames or flips kinds).
  app.post('/api/exam/card-areas/sync', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, templateId } = req.body || {}
      if (!branchCode || !sessionCode || !templateId) return bad(res, 'branchCode, sessionCode, templateId required')
      const bid = await branchIdForCode(branchCode)
      const [{ data: tpl, error: tErr }, { data: bound, error: bErr }] = await Promise.all([
        supabase.from('report_card_templates').select('id, definition').eq('id', templateId).single(),
        supabase.from('report_card_template_classes').select('class_name').eq('session_code', sessionCode).eq('template_id', templateId),
      ])
      if (tErr) throw tErr
      if (bErr) throw bErr
      const d = tpl.definition || {}
      const areas = [
        ...(d.coScholastic?.rows || []).map((r) => ({ name: typeof r === 'string' ? r : r.name, code: 'RCA' })),
        ...(d.gradedSubjects?.rows || []).map((r) => ({ name: typeof r === 'string' ? r : r.name, code: 'RCG' })),
      ].filter((a) => a.name)
      const classes = (bound || []).map((r) => r.class_name)
      let created = 0
      for (const cls of classes) {
        const { data: existing } = await supabase.from('exam_subjects').select('subject_name').eq('branch_id', bid).eq('session_code', sessionCode).eq('class_name', cls)
        const have = new Set((existing || []).map((x) => normName(x.subject_name)))
        const rows = areas.filter((a) => !have.has(normName(a.name))).map((a, i) => ({ branch_id: bid, session_code: sessionCode, class_name: cls, subject_name: a.name, subject_code: a.code, kind: 'co_scholastic', is_optional: false, sort_order: 900 + i, created_by: 'rules-sync', updated_by: req.user.email }))
        if (rows.length) { const { error } = await supabase.from('exam_subjects').insert(rows); if (error) throw error; created += rows.length }
      }
      res.json({ classes: classes.length, areas: areas.length, created })
    } catch (e) { err(res, e, 'POST /api/exam/card-areas/sync') }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PAPERS — generated from the rules
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /api/exam/papers/generate { branchCode, sessionCode, className? } (all bound classes when omitted)
  app.post('/api/exam/papers/generate', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, className } = req.body || {}
      if (!branchCode || !sessionCode) return bad(res, 'branchCode and sessionCode required')
      const bid = await branchIdForCode(branchCode)
      if (!bid) return bad(res, `Branch '${branchCode}' not found`)
      let classes = className ? [className] : []
      if (!classes.length) {
        const { data } = await supabase.from('report_card_template_classes').select('class_name').eq('session_code', sessionCode)
        classes = (data || []).map((r) => r.class_name)
      }
      const summary = { created: 0, adopted: 0, existing: 0, skipped: [], perClass: {} }
      for (const cls of classes) {
        const b = await loadBundle(bid, sessionCode, cls)
        if (!b.template) { summary.skipped.push({ className: cls, reason: 'no template bound' }); continue }
        if (!b.terms.length) { summary.skipped.push({ className: cls, reason: 'no terms — seed terms first' }); continue }
        const plan = planCard(b.template.definition, b.template.family)
        // Senior rows resolve per student; papers are needed for the class core plus every optional the class offers.
        let rows
        if (b.template.family === 'senior_progress') {
          const d = b.template.definition || {}
          const names = [...new Set([...(d.coreOrder?.[cls] || []), ...seniorOptionals(d, cls)])]
          rows = resolveSeniorNames(d, names, b.subjects).filter((r) => r.sources.length)
        } else rows = resolveRows(b.template.definition, b.template.family, cls, b.subjects, null)
        const termsByCode = Object.fromEntries(b.terms.map((t) => [t.short_code, t]))
        const specs = generatePaperSpecs(plan, rows, termsByCode)
        const per = { created: 0, adopted: 0, existing: 0, unmapped: rows.filter((r) => !r.sources.length).map((r) => r.subject) }
        const typed = new Map(b.papers.filter((p) => p.component_key).map((p) => [`${p.subject_id}|${p.term_id}|${p.component_key}`, p]))
        const untyped = b.papers.filter((p) => !p.component_key)
        // marks count per untyped paper — to pick the best adoption candidate
        let markCount = new Map()
        if (b.papers.length) {
          const rowsM = await pagedAll(() => supabase.from('exam_marks').select('paper_id').in('paper_id', b.papers.map((p) => p.id)))
          for (const m of rowsM) markCount.set(m.paper_id, (markCount.get(m.paper_id) || 0) + 1)
        }
        const inserts = []
        for (const sp of specs) {
          const key = `${sp.subjectId}|${sp.termId}|${sp.componentKey}`
          const ex = typed.get(key)
          if (ex) {
            const exMarks = markCount.get(ex.id) || 0
            const ptTerm0 = ['T1', 'T2'].includes(sp.termCode)
            const rival = untyped.filter((p) => p.subject_id === sp.subjectId && p.term_id === sp.termId && (markCount.get(p.id) || 0) > 0 && ((ADOPT_PATTERNS[sp.componentKey] || /$^/).test(p.paper_name || '') || (sp.componentKey === 'pt' && ptTerm0 && /^main$/i.test(p.paper_name || ''))))
              .sort((a, b) => (markCount.get(b.id) || 0) - (markCount.get(a.id) || 0))[0]
            if (ex.generated && exMarks === 0 && rival) {
              // generated slot is empty but a legacy paper already holds the marks → adopt the legacy one instead
              await supabase.from('exam_papers').delete().eq('id', ex.id)
              const patch = { component_key: sp.componentKey, card_max: sp.cardMax, generated: true, updated_at: new Date().toISOString() }
              const { error } = await supabase.from('exam_papers').update(patch).eq('id', rival.id)
              if (error) throw error
              untyped.splice(untyped.indexOf(rival), 1)
              typed.set(key, { ...rival, ...patch })
              per.adopted += 1
              continue
            }
            per.existing += 1
            // keep card_max in sync with the rule; raw max only when no marks are riding on it
            const patch = {}
            if (Number(ex.card_max) !== Number(sp.cardMax)) patch.card_max = sp.cardMax
            if (Object.keys(patch).length) await supabase.from('exam_papers').update(patch).eq('id', ex.id)
            continue
          }
          // adopt a legacy free-text paper in the same subject+term whose name matches
          const ptTerm = ['T1', 'T2'].includes(sp.termCode)
          const matches = (p) => (ADOPT_PATTERNS[sp.componentKey] || /$^/).test(p.paper_name || '') || (sp.componentKey === 'pt' && ptTerm && /^main$/i.test(p.paper_name || ''))
          const cands = untyped.filter((p) => p.subject_id === sp.subjectId && p.term_id === sp.termId && matches(p))
          // the candidate carrying the most marks wins (17 spellings of PA-1 in the wild)
          const pick = cands.sort((a, b) => (markCount.get(b.id) || 0) - (markCount.get(a.id) || 0))[0]
          if (pick) {
            const hasMarks = (markCount.get(pick.id) || 0) > 0
            const patch = { component_key: sp.componentKey, card_max: sp.cardMax, generated: true, updated_at: new Date().toISOString() }
            if (!hasMarks) { patch.max_marks = sp.maxMarks; patch.has_practical = !!sp.hasPractical; patch.theory_max = sp.theoryMax ?? null; patch.practical_max = sp.practicalMax ?? 0; patch.paper_name = sp.paperName; patch.passing_marks = Math.ceil(sp.maxMarks * 0.33) }
            const { error } = await supabase.from('exam_papers').update(patch).eq('id', pick.id)
            if (error) throw error
            untyped.splice(untyped.indexOf(pick), 1)
            typed.set(key, { ...pick, ...patch })
            per.adopted += 1
            continue
          }
          inserts.push({ subject_id: sp.subjectId, term_id: sp.termId, paper_name: sp.paperName, component_key: sp.componentKey, max_marks: sp.maxMarks, card_max: sp.cardMax, passing_marks: Math.ceil(sp.maxMarks * 0.33), has_practical: !!sp.hasPractical, theory_max: sp.theoryMax ?? null, practical_max: sp.practicalMax ?? 0, generated: true, tracker_doc_id: `gen_${sp.subjectId}_${sp.termId}_${sp.componentKey}` })
        }
        if (inserts.length) {
          // a legacy paper with the same (term, subject, name) blocks the name-unique index — suffix it
          for (const ins of inserts) if (untyped.some((p) => p.subject_id === ins.subject_id && p.term_id === ins.term_id && p.paper_name === ins.paper_name)) ins.paper_name = `${ins.paper_name} (card)`
          const { error } = await supabase.from('exam_papers').insert(inserts)
          if (error) throw error
          per.created += inserts.length
        }
        summary.created += per.created; summary.adopted += per.adopted; summary.existing += per.existing
        summary.perClass[cls] = per
      }
      res.json(summary)
    } catch (e) { err(res, e, 'POST /api/exam/papers/generate') }
  })

  // GET /api/exam/class-papers?branchCode=&sessionCode=&className= → typed + legacy papers grouped by subject
  app.get('/api/exam/class-papers', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, className } = req.query
      if (!branchCode || !sessionCode || !className) return bad(res, 'branchCode, sessionCode, className required')
      const bid = await branchIdForCode(branchCode)
      const b = await loadBundle(bid, sessionCode, className)
      const counts = new Map()
      if (b.papers.length) {
        const rows = await pagedAll(() => supabase.from('exam_marks').select('paper_id').in('paper_id', b.papers.map((p) => p.id)))
        for (const m of rows) counts.set(m.paper_id, (counts.get(m.paper_id) || 0) + 1)
      }
      res.json({ terms: b.terms, subjects: b.subjects, template: b.template ? { id: b.template.id, family: b.template.family, name: b.template.name } : null, papers: b.papers.map((p) => ({ ...p, marks: counts.get(p.id) || 0 })) })
    } catch (e) { err(res, e, 'GET /api/exam/class-papers') }
  })

  // DELETE /api/exam/papers/:id — only when it carries no marks
  app.delete('/api/exam/papers/:id', verifyAuth, async (req, res) => {
    try {
      const { count } = await supabase.from('exam_marks').select('id', { count: 'exact', head: true }).eq('paper_id', req.params.id)
      if (count > 0) return res.status(409).json({ error: `Paper has ${count} marks — cannot delete` })
      const { error } = await supabase.from('exam_papers').delete().eq('id', req.params.id)
      if (error) throw error
      res.json({ ok: true })
    } catch (e) { err(res, e, 'DELETE /api/exam/papers/:id') }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CLASS GRID — office enters a whole class for one term in one screen
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/exam/class-grid?branchCode=&sessionCode=&className=&termId=&section=
  app.get('/api/exam/class-grid', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, className, termId, section } = req.query
      if (!branchCode || !sessionCode || !className || !termId) return bad(res, 'branchCode, sessionCode, className, termId required')
      const bid = await branchIdForCode(branchCode)
      const [b, students] = await Promise.all([loadBundle(bid, sessionCode, className), roster(bid, className, section || undefined)])
      let subjects = b.subjects.filter((x) => (x.kind || 'scholastic') === 'scholastic')
      // Only subjects that feed a row on the card are entered; the rest (timetable-only) are listed as hidden.
      let hidden = []
      const { onCard, applicable } = cardSubjects(b, className, students)
      if (onCard) {
        hidden = subjects.filter((x) => !onCard.has(x.id)).map((x) => x.subject_name)
        subjects = subjects.filter((x) => onCard.has(x.id))
      }
      const subjOrder = new Map(subjects.map((x, i) => [x.id, i]))
      const ORDER = ['oral', 'written', 'pt', 'portfolio', 'se', 'notebook', 'exam']
      const papers = b.papers.filter((p) => p.term_id === termId && p.component_key && subjOrder.has(p.subject_id))
        .sort((a, c) => (subjOrder.get(a.subject_id) - subjOrder.get(c.subject_id)) || ((ORDER.indexOf(a.component_key) + 1 || 99) - (ORDER.indexOf(c.component_key) + 1 || 99)))
      const sids = students.map((x) => x.id)
      const marks = papers.length && sids.length ? await pagedAll(() => supabase.from('exam_marks').select('paper_id, student_id, marks_obtained, theory_obtained, practical_obtained, is_absent, source').in('paper_id', papers.map((p) => p.id)).in('student_id', sids)) : []
      res.json({
        term: b.terms.find((t) => t.id === termId) || null,
        hiddenSubjects: hidden,
        applicable, // senior classes only: studentId → subjectIds this student takes (others are not entered)
        subjects: subjects.map((x) => ({ id: x.id, name: x.subject_name, teacher: x.assigned_teacher_name || null })),
        papers: papers.map((p) => ({ id: p.id, subjectId: p.subject_id, componentKey: p.component_key, name: p.paper_name, max: Number(p.max_marks), cardMax: p.card_max != null ? Number(p.card_max) : null, hasPractical: !!p.has_practical, theoryMax: p.theory_max != null ? Number(p.theory_max) : null, practicalMax: p.practical_max != null ? Number(p.practical_max) : null })),
        students: students.map((x) => ({ id: x.id, name: x.full_name, roll: x.roll_number, section: x.section, admissionNo: x.admission_no })),
        marks,
      })
    } catch (e) { err(res, e, 'GET /api/exam/class-grid') }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS — who owes what
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/exam/status?branchCode=&sessionCode=&className=
  app.get('/api/exam/status', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, className } = req.query
      if (!branchCode || !sessionCode || !className) return bad(res, 'branchCode, sessionCode, className required')
      const bid = await branchIdForCode(branchCode)
      const [b, students, cts, tlist] = await Promise.all([loadBundle(bid, sessionCode, className), roster(bid, className), classTeachers(branchCode), activeTeachers(null)])
      const tName = new Map(tlist.map((t) => [t.id, t.name]))
      const sids = new Set(students.map((s) => s.id))
      const { onCard, applicable } = cardSubjects(b, className, students)
      const expectedFor = (subjectId) => (applicable ? students.filter((st) => applicable[st.id]?.includes(subjectId)).length : students.length)
      const typedPapers = b.papers.filter((p) => p.component_key && (!onCard || onCard.has(p.subject_id)))
      const marks = typedPapers.length ? await pagedAll(() => supabase.from('exam_marks').select('paper_id, student_id, is_absent, source, entered_at, updated_at').in('paper_id', typedPapers.map((p) => p.id))) : []
      const agg = new Map()
      for (const m of marks) {
        if (!sids.has(m.student_id)) continue
        if (!agg.has(m.paper_id)) agg.set(m.paper_id, { entered: 0, absent: 0, manual: 0, lastAt: null })
        const a = agg.get(m.paper_id)
        a.entered += 1; if (m.is_absent) a.absent += 1; if (m.source === 'manual') a.manual += 1
        const t = m.updated_at || m.entered_at; if (t && (!a.lastAt || t > a.lastAt)) a.lastAt = t
      }
      const termName = Object.fromEntries(b.terms.map((t) => [t.id, t]))
      const items = b.subjects.filter((s) => (s.kind || 'scholastic') === 'scholastic' && (!onCard || onCard.has(s.id))).map((s) => ({
        subjectId: s.id, subjectName: s.subject_name, teacher: s.assigned_teacher_name || tName.get(s.assigned_teacher_id) || s.assigned_teacher_email || null, teacherEmail: s.assigned_teacher_email || null,
        papers: typedPapers.filter((p) => p.subject_id === s.id).sort((a, c) => (termName[a.term_id]?.sort_order || 0) - (termName[c.term_id]?.sort_order || 0)).map((p) => {
          const a = agg.get(p.id) || { entered: 0, absent: 0, manual: 0, lastAt: null }
          const expected = expectedFor(p.subject_id)
          return { id: p.id, termId: p.term_id, termCode: termName[p.term_id]?.short_code, termName: termName[p.term_id]?.name, componentKey: p.component_key, paperName: p.paper_name, maxMarks: Number(p.max_marks), cardMax: p.card_max != null ? Number(p.card_max) : null, examDate: p.exam_date, ...a, roster: expected, state: a.entered === 0 ? 'empty' : a.entered < expected ? 'partial' : 'done' }
        }),
      }))
      // card entries completeness per exam term
      const areas = b.subjects.filter((s) => s.kind === 'co_scholastic' && ['RCA', 'RCG'].includes(s.subject_code))
      const [grades, meta] = await Promise.all([
        areas.length && students.length ? pagedAll(() => supabase.from('exam_coscholastic_grades').select('student_id, subject_id, term_id').in('subject_id', areas.map((a) => a.id)).in('student_id', [...sids])) : [],
        students.length ? pagedAll(() => supabase.from('report_card_student_meta').select('student_id, term_id, remarks, discipline').eq('session_code', sessionCode).in('student_id', [...sids])) : [],
      ])
      const cardEntries = b.terms.map((t) => {
        const g = grades.filter((x) => x.term_id === t.id).length
        const rem = meta.filter((x) => x.term_id === t.id && x.remarks).length
        const disc = meta.filter((x) => x.term_id === t.id && x.discipline).length
        return { termId: t.id, termCode: t.short_code, termName: t.name, areas: areas.length, gradesEntered: g, gradesExpected: areas.length * students.length, remarks: rem, discipline: disc, roster: students.length }
      })
      const plan = b.template ? planCard(b.template.definition, b.template.family) : null
      res.json({ classTeacher: cts[className] || null, roster: students.length, sections: [...new Set(students.map((s) => s.section).filter(Boolean))].sort(), terms: b.terms, template: b.template ? { id: b.template.id, family: b.template.family, name: b.template.name } : null, cardKeys: plan?.cardKeys || [], items, cardEntries, legacyPapers: b.papers.filter((p) => !p.component_key).length })
    } catch (e) { err(res, e, 'GET /api/exam/status') }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CARDS — compute / preview / publish
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/exam/class-cards?branchCode=&sessionCode=&className=&cardKey=&section=
  app.get('/api/exam/class-cards', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, className, cardKey, section } = req.query
      if (!branchCode || !sessionCode || !className) return bad(res, 'branchCode, sessionCode, className required')
      const bid = await branchIdForCode(branchCode)
      const { cards, plan } = await computeClass({ branchId: bid, branchCode, sessionCode, className, cardKey, section })
      const key = cards[0]?.cardKey || cardKey
      const { data: pub } = await supabase.from('published_report_cards').select('id, student_id, version, published_at, published_by').eq('session_code', sessionCode).eq('class_name', className).eq('card_key', key).eq('is_current', true)
      const pubBy = new Map((pub || []).map((p) => [p.student_id, p]))
      res.json({
        cardKey: key, cardKeys: plan.cardKeys, plan: { cardTerms: plan.cardTerms, components: plan.components },
        rows: cards.map((c) => ({
          studentId: c.student.id, name: c.student.name, roll: c.student.rollNumber, section: c.student.section, admissionNo: c.student.admissionNo,
          ok: c.completeness.ok, missing: c.completeness.missing, warnings: c.completeness.warnings,
          overall: c.overall, rank: c.rank, subjects: c.rows.map((r) => ({ subject: r.subject, obtained: r.total.obtained, max: r.total.max, grade: r.total.grade, unmapped: r.unmapped, byTerm: Object.fromEntries(Object.entries(r.byTerm).map(([k, v]) => [k, v.hidden ? null : { obtained: v.obtained, max: v.max, complete: v.complete, grade: v.grade, comps: Object.fromEntries(Object.entries(v.comps).map(([ck, cv]) => [ck, cv.missing ? null : cv.absent ? 'AB' : cv.value])) }])) })),
          published: pubBy.get(c.student.id) || null,
        })),
      })
    } catch (e) { err(res, e, 'GET /api/exam/class-cards') }
  })

  // GET /api/exam/card?studentId=&sessionCode=&cardKey= → { card, html } (live preview)
  app.get('/api/exam/card', verifyAuth, async (req, res) => {
    try {
      const { studentId, sessionCode, cardKey } = req.query
      if (!studentId || !sessionCode) return bad(res, 'studentId and sessionCode required')
      const { data: st, error } = await supabase.from('students').select('id, class_name, branch_id, section, branches(code)').eq('id', studentId).single()
      if (error) throw error
      const { cards } = await computeClass({ branchId: st.branch_id, branchCode: st.branches?.code, sessionCode, className: st.class_name, cardKey, section: st.section || undefined })
      const card = cards.find((c) => c.student.id === studentId)
      if (!card) return res.status(404).json({ error: 'Student not in the active roster' })
      res.json({ card, html: renderCardHtml(card) })
    } catch (e) { err(res, e, 'GET /api/exam/card') }
  })

  // POST /api/exam/publish { branchCode, sessionCode, className, cardKey, section?, studentIds? }
  // Hard gate: students with missing entries are NOT published (returned as blocked).
  app.post('/api/exam/publish', verifyAuth, async (req, res) => {
    try {
      const { branchCode, sessionCode, className, cardKey, section, studentIds } = req.body || {}
      if (!branchCode || !sessionCode || !className) return bad(res, 'branchCode, sessionCode, className required')
      const bid = await branchIdForCode(branchCode)
      // rank needs the whole section — compute everyone, publish the requested subset
      const { cards, bundle } = await computeClass({ branchId: bid, branchCode, sessionCode, className, cardKey, section })
      const wanted = studentIds?.length ? cards.filter((c) => studentIds.includes(c.student.id)) : cards
      const key = cards[0]?.cardKey || cardKey
      const blocked = wanted.filter((c) => !c.completeness.ok).map((c) => ({ studentId: c.student.id, name: c.student.name, roll: c.student.rollNumber, missing: c.completeness.missing }))
      const ready = wanted.filter((c) => c.completeness.ok)
      let published = 0
      if (ready.length) {
        const { data: prev } = await supabase.from('published_report_cards').select('id, student_id, version').eq('session_code', sessionCode).eq('card_key', key).eq('is_current', true).in('student_id', ready.map((c) => c.student.id))
        const prevBy = new Map((prev || []).map((p) => [p.student_id, p]))
        const now = new Date().toISOString()
        const rows = ready.map((c) => {
          const version = (prevBy.get(c.student.id)?.version || 0) + 1
          const stamped = { ...c, publishedAt: now, publishedVersion: version, publishedBy: req.user.email }
          return { student_id: c.student.id, branch_id: bid, session_code: sessionCode, class_name: className, section: c.student.section || null, card_key: key, card_label: c.cardLabel, template_id: bundle.template.id, family: c.family, version, is_current: true, card: stamped, html: renderCardHtml(stamped), published_by: req.user.email, published_at: now }
        })
        if (prev?.length) { const { error } = await supabase.from('published_report_cards').update({ is_current: false }).in('id', prev.map((p) => p.id)); if (error) throw error }
        for (let i = 0; i < rows.length; i += 50) { const { error } = await supabase.from('published_report_cards').insert(rows.slice(i, i + 50)); if (error) throw error }
        published = rows.length
      }
      res.json({ cardKey: key, published, blocked })
    } catch (e) { err(res, e, 'POST /api/exam/publish') }
  })

  // GET /api/exam/published?branchCode=&sessionCode=&className=&cardKey=
  app.get('/api/exam/published', verifyAuth, async (req, res) => {
    try {
      const { sessionCode, className, cardKey, studentId } = req.query
      let q = supabase.from('published_report_cards').select('id, student_id, class_name, section, card_key, card_label, version, published_at, published_by').eq('is_current', true).order('published_at', { ascending: false })
      if (sessionCode) q = q.eq('session_code', sessionCode)
      if (className) q = q.eq('class_name', className)
      if (cardKey) q = q.eq('card_key', cardKey)
      if (studentId) q = q.eq('student_id', studentId)
      const { data, error } = await q
      if (error) throw error
      res.json({ published: data || [] })
    } catch (e) { err(res, e, 'GET /api/exam/published') }
  })

  // GET /api/exam/published/:id → { html, card, meta }
  app.get('/api/exam/published/:id', verifyAuth, async (req, res) => {
    try {
      const { data, error } = await supabase.from('published_report_cards').select('id, student_id, card_key, card_label, version, published_at, published_by, card, html').eq('id', req.params.id).single()
      if (error) throw error
      res.json(data)
    } catch (e) { err(res, e, 'GET /api/exam/published/:id') }
  })

  // POST /api/exam/unpublish { ids:[] } — withdraws the current version (history kept)
  app.post('/api/exam/unpublish', verifyAuth, async (req, res) => {
    try {
      const ids = (req.body?.ids || []).filter(Boolean)
      if (!ids.length) return bad(res, 'ids[] required')
      const { error } = await supabase.from('published_report_cards').update({ is_current: false }).in('id', ids)
      if (error) throw error
      res.json({ withdrawn: ids.length })
    } catch (e) { err(res, e, 'POST /api/exam/unpublish') }
  })
}
