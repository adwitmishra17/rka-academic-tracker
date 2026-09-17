// ============================================================================
// admin/lib/cardEngine.js — the ONE report-card engine.
//
// Pure functions: no I/O. The Examinations routes fetch rows from Supabase /
// Firestore and hand them here; the output `card` object is what gets
// snapshotted into published_report_cards (with its rendered HTML) and what
// the Examinations window shows in preview / crosslist / status.
//
// Model (all driven by report_card_templates.definition):
//   • cardTerms   — the columns printed on the card (T1/T2, annual, HY/AN)
//   • components  — what each subject-term cell is made of (Periodic Test /10,
//                   Portfolio /5, Subject Enrichment /5, Term Exam /80 …).
//                   Each component maps a card term → the exam_terms row its
//                   paper lives in (termMap), carries the RAW paper max
//                   (rawMax) and the marks it is worth on the card (max).
//   • rows        — subjects printed, incl. composites (Class 9-10 Science =
//                   Physics+Chemistry+Biology) and per-student senior rows.
//
// Normalisation: value = roundHalfUp(raw * cardMax / rawMax). 6.5 → 7, 6.4 → 6.
// ============================================================================

export const roundHalfUp = (x) => (x == null || Number.isNaN(x) ? null : Math.floor(Number(x) + 0.5))

// ── Grade scale ─────────────────────────────────────────────────────────────
export const DEFAULT_BANDS = [[91, 'A1'], [81, 'A2'], [71, 'B1'], [61, 'B2'], [51, 'C1'], [41, 'C2'], [33, 'D']]
export function gradeFor(pct, scale) {
  if (pct == null || Number.isNaN(pct)) return null
  const bands = scale?.bands?.length ? scale.bands : DEFAULT_BANDS
  for (const [min, g] of bands) if (pct >= min) return g
  return scale?.floorLabel || 'E'
}

// ── Subject-name matching (template rows ↔ exam_subjects) ───────────────────
export function normName(s) {
  return String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}
// Each key lists the exam_subjects spellings that satisfy the template row.
const ALIASES = {
  'ENGLISH LNG AND LIT': ['ENGLISH', 'ENGLISH LANGUAGE AND LITERATURE', 'ENGLISH LNG AND LIT'],
  'ENGLISH CORE':        ['ENGLISH', 'ENGLISH CORE'],
  'ENGLISH':             ['ENGLISH', 'ENGLISH CORE', 'ENGLISH LANGUAGE AND LITERATURE'],
  'HINDI COURSE A':      ['HINDI', 'HINDI COURSE A', 'HINDI A'],
  'HINDI CORE':          ['HINDI', 'HINDI CORE'],
  'HINDI':               ['HINDI', 'HINDI CORE', 'HINDI COURSE A'],
  'MATHEMATICS':         ['MATHEMATICS', 'MATHS', 'MATH'],
  'SCIENCE':             ['SCIENCE', 'GENERAL SCIENCE'],
  'SOCIAL SCIENCE':      ['SOCIAL SCIENCE', 'SST', 'SOCIAL STUDIES', 'S ST'],
  'COMPUTER':            ['COMPUTER', 'COMPUTERS', 'COMPUTER SCIENCE', 'IT'],
  'COMPUTER SCIENCE':    ['COMPUTER SCIENCE', 'COMPUTERS', 'COMPUTER'],
  'GK':                  ['GK', 'GENERAL KNOWLEDGE', 'G K'],
  'ARTIFICIAL INTELLIGENCE': ['ARTIFICIAL INTELLIGENCE', 'AI'],
  'PHYSICAL EDUCATION':  ['PHYSICAL EDUCATION', 'PE', 'P E', 'PHY EDU'],
  'POLITICAL SCIENCE':   ['POLITICAL SCIENCE', 'POL SCIENCE', 'POL SC', 'CIVICS'],
  'BUSINESS STUDIES':    ['BUSINESS STUDIES', 'BST', 'B ST'],
  'ACCOUNTANCY':         ['ACCOUNTANCY', 'ACCOUNTS'],
  'EVS':                 ['EVS', 'ENVIRONMENTAL STUDIES'],
}
// Class 9-10 composites — the card row is the SUM of component-subject papers.
export const DEFAULT_COMPOSITES = {
  'SCIENCE':        ['PHYSICS', 'CHEMISTRY', 'BIOLOGY'],
  'SOCIAL SCIENCE': ['HISTORY', 'GEOGRAPHY', 'POLITICAL SCIENCE', 'ECONOMICS'],
}
// Office-driven entry (2026-09-13): the office enters the COMBINED mark for
// Science / Social Science / Hindi directly, so rows map to one subject each.
// Explicit row.sources still allow a composite when a school wants one.
export function rowSourceNames(rowSubject, opts = {}) {
  const key = normName(rowSubject)
  if (opts.sources?.length) return opts.sources.map(normName)
  return ALIASES[key] || [key]
}
/** Resolve a template row to exam_subjects ids. Composite rows return several. */
export function resolveRowSubjects(row, subjects, { composite }) {
  const wanted = rowSourceNames(row.subject, { sources: row.sources, composite })
  const byNorm = new Map(subjects.map((s) => [normName(s.subject_name), s]))
  const hits = []
  for (const w of wanted) { const s = byNorm.get(w); if (s && !hits.includes(s)) hits.push(s) }
  // Alias rows match ONE subject — the first hit wins; explicit sources may list several.
  return row.sources?.length ? hits : hits.slice(0, 1)
}

// ── Plan: card terms + components for a family, with rule defaults ──────────
// Defaults reproduce the school's printed cards so seeded templates work
// before anyone opens the Scoring Rules stage.
export function planCard(def, family) {
  const d = def || {}
  const rounding = d.scoring?.rounding || 'half-up'
  if (family === 'performance_profile') {
    const terms = (d.terms?.length ? d.terms : [{ key: 'T1', label: 'TERM - 1', examLabel: 'Half Yearly Exam' }, { key: 'T2', label: 'TERM - 2', examLabel: 'Yearly Exam' }])
      .map((t) => ({ key: t.key, label: t.label, examLabel: t.examLabel || '' }))
    // Defaults only when the list was never set. An explicitly emptied list ([]) stays empty —
    // otherwise removing the last component in Scoring rules silently brings the defaults back.
    const comps = (Array.isArray(d.components) ? d.components : [
      { key: 'pt', label: 'Periodic Test', max: 10, source: { type: 'exam', kind: 'PT' } },
      { key: 'portfolio', label: 'Portfolio', max: 5, source: { type: 'sheet' } },
      { key: 'se', label: 'Subject Enrichment', max: 5, source: { type: 'sheet' } },
      { key: 'exam', label: 'Term Exam', max: 80, source: { type: 'exam', kind: 'TERM' } },
    ]).map((c) => {
      // Default term for each component: periodic tests are their own exam term (T1 / T2);
      // the term exam AND the office sheets (portfolio, subject enrichment …) are entered
      // with the half-yearly / annual exam — the office fills them in at the same sitting.
      const isPT = c.source?.kind === 'PT' || c.key === 'pt'
      const termMap = c.source?.termMap || Object.fromEntries(terms.map((t) => [t.key, isPT ? t.key : ({ T1: 'HY', T2: 'AN' }[t.key] || t.key)]))
      const rawMax = c.rawMax ?? (c.key === 'pt' ? 40 : c.max)
      return { key: c.key, label: c.label, max: Number(c.max), rawMax: Number(rawMax), kind: c.source?.type === 'sheet' || c.source?.type === 'monthlyAvg' ? 'sheet' : 'exam', termMap }
    })
    return {
      family, rounding, subjectTotal: d.subjectTotal || 100,
      cardTerms: terms,
      // Card keys = what gets published. The interim card prints term 1 only.
      cardKeys: [
        { key: 'T1', label: `${terms[0]?.label || 'TERM - 1'} card`, showTerms: [terms[0]?.key], gateTerms: [terms[0]?.key] },
        { key: 'T2', label: 'Final card', showTerms: terms.map((t) => t.key), gateTerms: terms.map((t) => t.key) },
      ],
      components: comps,
    }
  }
  if (family === 'secondary_annual') {
    const ia = Array.isArray(d.ia?.components) ? d.ia.components : [
      { key: 'ppt', label: 'P.P.T.', max: 5, source: { type: 'exam', kind: 'PT', agg: 'avg' } },
      { key: 'ma', label: 'M.A.', max: 5, source: { type: 'sheet' } },
      { key: 'portfolio', label: 'Portfolio', max: 5, source: { type: 'sheet' } },
      { key: 'se', label: 'Subject Enrichment', max: 5, source: { type: 'sheet' } },
    ]
    const annualTerm = d.annualExam?.term || 'AN'
    const comps = ia.map((c) => {
      // Legacy 'monthlyAvg' (monthly-test average) is retired: treated as an office-entered sheet.
      const type = (c.source?.type === 'monthlyAvg' ? 'sheet' : c.source?.type) || 'exam'
      if (type === 'sheet') return { key: c.key, label: c.label, max: Number(c.max), rawMax: Number(c.rawMax ?? c.max), kind: 'sheet', ia: true, termMap: { annual: c.source?.term || annualTerm } }
      // PT average over the periodic-test terms
      return { key: c.key, label: c.label, max: Number(c.max), rawMax: Number(c.rawMax ?? 40), kind: 'exam', ia: true, agg: 'avg', paperKey: 'pt', terms: c.source?.terms || ['T1', 'T2'] }
    })
    comps.push({ key: 'exam', label: 'Annual Exam', max: Number(d.annualExam?.total || 80), kind: 'exam', ia: false, termMap: { annual: annualTerm }, parts: d.annualExam?.parts || ['practical', 'written'] })
    return {
      family, rounding, subjectTotal: d.subjectTotal || 100, iaTotal: Number(d.ia?.total ?? 20),
      cardTerms: [{ key: 'annual', label: 'ANNUAL' }],
      cardKeys: [{ key: 'annual', label: 'Annual card', showTerms: ['annual'], gateTerms: ['annual'] }],
      components: comps,
    }
  }
  if (family === 'pre_primary') {
    // Nursery / KG "Progress Report Card": Half Yearly + Annual, each subject = ORAL /40 + WRITTEN /60
    // (a row may be written-only /100). Rank + overall grade; co-curricular A–E per term.
    const terms = (d.terms?.length ? d.terms : [{ key: 'HY', label: 'HALF YEARLY EXAM' }, { key: 'AN', label: 'ANNUAL EXAM' }]).map((t) => ({ key: t.key, label: t.label, examTerm: t.examTerm || t.key }))
    const comps = [
      { key: 'oral',    label: 'Oral',    kind: 'exam', perRow: 'oral',    termMap: Object.fromEntries(terms.map((t) => [t.key, t.examTerm])) },
      { key: 'written', label: 'Written', kind: 'exam', perRow: 'written', termMap: Object.fromEntries(terms.map((t) => [t.key, t.examTerm])) },
    ]
    return {
      family, rounding, subjectTotal: d.subjectTotal || 100,
      cardTerms: terms,
      cardKeys: [
        { key: terms[0].key, label: `${titleCase(terms[0].label)} card`, showTerms: [terms[0].key], gateTerms: [terms[0].key], interim: true },
        { key: terms[1]?.key || 'AN', label: 'Final card', showTerms: terms.map((t) => t.key), gateTerms: terms.map((t) => t.key) },
      ],
      components: comps,
    }
  }
  if (family === 'senior_progress') {
    const terms = (d.terms?.length ? d.terms : [{ key: 'HY', label: 'HALF YEARLY' }, { key: 'AN', label: 'ANNUAL' }]).map((t) => ({ key: t.key, label: t.label }))
    const comps = [{ key: 'exam', label: 'Exam', kind: 'exam', split: true, termMap: Object.fromEntries(terms.map((t) => [t.key, t.examTerm || t.key])) }]
    return {
      family, rounding, subjectTotal: d.subjectTotal || 200,
      cardTerms: terms,
      cardKeys: [
        { key: terms[0].key, label: `${terms[0].label} card`, showTerms: [terms[0].key], gateTerms: [terms[0].key], interim: d.interim?.enabled !== false },
        { key: terms[1]?.key || 'AN', label: 'Final card', showTerms: terms.map((t) => t.key), gateTerms: terms.map((t) => t.key) },
      ],
      components: comps,
    }
  }
  return { family, rounding, cardTerms: [], cardKeys: [], components: [] }
}

// ── Rows for a class (+ per-student for seniors) ────────────────────────────
/** Optional subjects a senior class offers (one per student, chosen in SMS).
 *  Stored per class in the template as optionalOrder; the default mirrors the
 *  SMS admission rule: every stream offers Physical Education, Computer
 *  Science and Hindi; Commerce also offers Mathematics. */
export function seniorOptionals(def, className) {
  const list = def?.optionalOrder?.[className]
  if (Array.isArray(list)) return list
  const base = ['PHYSICAL EDUCATION', 'COMPUTER SCIENCE', 'HINDI CORE']
  return /Commerce$/.test(className || '') ? [...base, 'MATHEMATICS'] : base
}
/** Senior rows for an explicit list of scheme names (core, optional, or both). */
export function resolveSeniorNames(def, names, subjects) {
  const schemes = def?.schemes || {}
  const scholastic = subjects.filter((s) => (s.kind || 'scholastic') === 'scholastic')
  return names.map((name) => {
    const scheme = schemes[name] || schemes[normName(name)] || { theory: 100, practical: 0 }
    const ids = resolveRowSubjects({ subject: name }, scholastic, { composite: false })
    return { subject: name, sources: ids, subjectIds: ids.map((s) => s.id), written: Number(scheme.theory || 0), practical: Number(scheme.practical || 0), countsInAggregate: true }
  })
}

/** The class a student moves to on promotion (null when it is not knowable:
 *  Class 10 picks a stream, Class 12 leaves). The office overrides per student
 *  in Card entries; blank means this default. */
export function nextClass(className) {
  const c = String(className || '').trim()
  const ladder = { Nursery: 'LKG', LKG: 'UKG', UKG: 'Class 1' }
  if (ladder[c]) return ladder[c]
  const m = c.match(/^Class (\d+)(?: (.+))?$/)
  if (!m) return null
  const n = Number(m[1]), stream = m[2]
  if (n >= 12 || n === 10) return null
  if (n === 11) return stream ? `Class 12 ${stream}` : null
  return `Class ${n + 1}`
}

export function resolveRows(def, family, className, subjects, student) {
  const d = def || {}
  const isComposite = /^Class (9|10)$/.test(className)
  const scholastic = subjects.filter((s) => (s.kind || 'scholastic') === 'scholastic')
  if (family === 'senior_progress') {
    const schemes = d.schemes || {}
    let core = [...(d.coreOrder?.[className] || [])]
    const sp = String(student?.science_path || '').toUpperCase()
    if (sp === 'PCM') core = core.filter((s) => normName(s) !== 'BIOLOGY')
    if (sp === 'PCB') core = core.filter((s) => normName(s) !== 'MATHEMATICS')
    const opt = student?.optional_subject ? normName(student.optional_subject) : null
    let names = [...core]
    if (opt && !names.some((n) => normName(n) === opt)) {
      // optional_subject uses exam_subjects spelling ("Physical Education") — find the scheme name that aliases to it
      const schemeName = Object.keys(schemes).find((k) => rowSourceNames(k).includes(opt)) || student.optional_subject
      names.push(schemeName)
    }
    // Per-student subject exceptions (SMS students.subject_overrides): the rare
    // senior who differs from the stream default — e.g. Arts with Economics
    // instead of History. Drop first, then add (names not already present).
    const ov = student?.subject_overrides || null
    if (ov && (ov.drop?.length || ov.add?.length)) {
      const dropSet = new Set((ov.drop || []).map(normName))
      if (dropSet.size) names = names.filter((n) => !dropSet.has(normName(n)))
      for (const a of (ov.add || [])) {
        const an = normName(a)
        if (an && !names.some((n) => normName(n) === an)) {
          const schemeName = Object.keys(schemes).find((k) => rowSourceNames(k).includes(an)) || a
          names.push(schemeName)
        }
      }
    }
    return resolveSeniorNames(d, names, subjects)
  }
  const rows = d.classRows?.[className]
  if (rows?.length) {
    return rows.map((r) => {
      const ids = resolveRowSubjects(r, scholastic, { composite: isComposite })
      return { subject: r.subject, locCode: r.locCode || null, sources: ids, subjectIds: ids.map((s) => s.id), written: r.written != null ? Number(r.written) : null, practical: r.practical != null ? Number(r.practical) : 0, oral: r.oral != null ? Number(r.oral) : (family === 'pre_primary' ? 40 : null), additional: !!r.additional, countsInAggregate: r.countsInAggregate !== false }
    })
  }
  // No template rows → every scholastic subject, one row each (legacy behaviour)
  return scholastic.map((s) => ({ subject: s.subject_name, sources: [s], subjectIds: [s.id], practical: 0, countsInAggregate: !s.is_optional }))
}

// ── Paper specs to generate for a class ─────────────────────────────────────
// termsByCode: { T1: termRow, HY: termRow … } for the branch+session.
export function generatePaperSpecs(plan, rows, termsByCode) {
  const specs = []
  const push = (s) => { if (!specs.some((x) => x.subjectId === s.subjectId && x.termId === s.termId && x.componentKey === s.componentKey)) specs.push(s) }
  for (const row of rows) {
    for (const subj of row.sources) {
      for (const c of plan.components) {
        if (c.agg === 'avg') {
          for (const tc of c.terms) {
            const term = termsByCode[tc]; if (!term) continue
            push({ subjectId: subj.id, termId: term.id, termCode: tc, componentKey: c.paperKey || c.key, paperName: 'Periodic Test', maxMarks: c.rawMax, cardMax: c.max, hasPractical: false })
          }
          continue
        }
        for (const [cardTerm, examCode] of Object.entries(c.termMap || {})) {
          const term = termsByCode[examCode]; if (!term) continue
          if (c.perRow) {
            const max = Number(row[c.perRow] ?? 0)
            if (max > 0) push({ subjectId: subj.id, termId: term.id, termCode: examCode, componentKey: c.key, paperName: c.label, maxMarks: max, cardMax: max, hasPractical: false })
            continue
          }
          if (c.key === 'exam' && (plan.family === 'secondary_annual' || plan.family === 'senior_progress')) {
            const th = Number(row.written ?? c.max), pr = Number(row.practical || 0)
            const total = th + pr
            push({ subjectId: subj.id, termId: term.id, termCode: examCode, componentKey: 'exam', paperName: plan.family === 'senior_progress' ? `${plan.cardTerms.find((t) => t.key === cardTerm)?.label || cardTerm} Exam` : 'Annual Exam',
              maxMarks: total, cardMax: total, hasPractical: pr > 0, theoryMax: pr > 0 ? th : null, practicalMax: pr > 0 ? pr : 0 })
          } else {
            push({ subjectId: subj.id, termId: term.id, termCode: examCode, componentKey: c.key, paperName: c.label, maxMarks: c.rawMax ?? c.max, cardMax: c.max, hasPractical: false })
          }
        }
      }
    }
  }
  return specs
}

// ── Compute ─────────────────────────────────────────────────────────────────
/**
 * @param {object} p
 *  def, family, className, student{id,roll_number,section,…}
 *  subjects[] exam_subjects rows (all kinds) for class+branch+session
 *  terms[]    exam_terms rows for branch+session
 *  papers[]   exam_papers rows (id, term_id, subject_id, component_key, max_marks, card_max, has_practical, theory_max, practical_max, passing_marks)
 *  marks[]    exam_marks rows for THIS student (paper_id, marks_obtained, theory_obtained, practical_obtained, is_absent)
 *  coGrades[] exam_coscholastic_grades for this student (subject_id, term_id, grade)
 *  meta[]     report_card_student_meta rows for this student
 *  attendance {sessionTotal:{present,marked}, byTerm:{examCode:{present,marked}}} — optional
 *  cardKey    which card to build (defaults to the final one)
 */
export function computeCard(p) {
  const plan = planCard(p.def, p.family)
  const scale = p.def?.gradeScale
  const cardKey = plan.cardKeys.find((k) => k.key === p.cardKey) || plan.cardKeys[0]
  const termsByCode = Object.fromEntries((p.terms || []).map((t) => [t.short_code, t]))
  const termById = Object.fromEntries((p.terms || []).map((t) => [t.id, t]))
  const rows = resolveRows(p.def, p.family, p.className, p.subjects || [], p.student)
  const markByPaper = new Map((p.marks || []).map((m) => [m.paper_id, m]))
  const paperIndex = new Map() // `${subjectId}|${termId}|${componentKey}` → paper
  for (const pp of p.papers || []) if (pp.component_key) paperIndex.set(`${pp.subject_id}|${pp.term_id}|${pp.component_key}`, pp)
  const missing = [] // hard-gate items
  const warnings = []

  // One component cell for a row in one exam term: sums the row's source papers.
  function cellFor(row, examCode, componentKey, cardMax, rawMaxDefault) {
    const term = termsByCode[examCode]
    if (!term) return { missing: true, reason: `Term ${examCode} not set up` }
    let raw = 0, rawMax = 0, counted = 0, absent = 0, absentSeen = false, papersFound = 0
    let th = 0, pr = 0, thMax = 0, prMax = 0
    for (const subj of row.sources) {
      const paper = paperIndex.get(`${subj.id}|${term.id}|${componentKey}`)
      if (!paper) continue
      papersFound += 1
      const mk = markByPaper.get(paper.id)
      if (!mk) continue
      if (mk.is_absent) { absentSeen = true; absent += 1; rawMax += Number(paper.max_marks); thMax += Number(paper.theory_max || 0); prMax += Number(paper.practical_max || 0); continue }
      if (mk.marks_obtained == null) continue
      counted += 1
      raw += Number(mk.marks_obtained); rawMax += Number(paper.max_marks)
      th += Number(mk.theory_obtained || 0); pr += Number(mk.practical_obtained || 0)
      thMax += Number(paper.theory_max || 0); prMax += Number(paper.practical_max || 0)
    }
    if (!papersFound) return { missing: true, reason: 'paper not generated', noPaper: true }
    if (!counted && !absentSeen) return { missing: true, reason: 'marks not entered' }
    if (!counted && absentSeen) return { absent: true, raw: 0, rawMax, value: 0, max: cardMax }
    const denom = rawMax || rawMaxDefault || 1
    const value = roundHalfUp(raw * cardMax / denom)
    const out = { raw, rawMax, value, max: cardMax, partial: counted + absent < row.sources.length }
    if (thMax || prMax) { out.theory = roundHalfUp(th * cardMax / denom); out.practical = roundHalfUp(pr * cardMax / denom); out.theoryMax = thMax; out.practicalMax = prMax }
    return out
  }

  const gateTerms = new Set(cardKey.gateTerms)
  const outRows = rows.map((row) => {
    const r = { subject: row.subject, locCode: row.locCode, additional: !!row.additional, countsInAggregate: row.countsInAggregate !== false, unmapped: row.sources.length === 0, oralMax: row.oral ?? null, writtenMax: row.written ?? null, byTerm: {}, total: { obtained: 0, max: 0, pct: null, grade: null } }
    if (r.unmapped) { missing.push({ row: row.subject, reason: 'no subject mapped for this row' }); return r }
    let cumO = 0, cumM = 0
    for (const ct of plan.cardTerms) {
      const shown = cardKey.showTerms.includes(ct.key)
      const gated = gateTerms.has(ct.key)
      const cell = { comps: {}, obtained: 0, max: 0, pct: null, grade: null, complete: true }
      for (const c of plan.components) {
        let v
        if (c.agg === 'avg') {
          const parts = c.terms.map((tc) => cellFor(row, tc, c.paperKey || c.key, c.max, c.rawMax))
          const have = parts.filter((x) => !x.missing)
          if (!have.length) v = { missing: true, reason: 'no periodic test entered' }
          else {
            const pcts = have.map((x) => (x.absent ? 0 : x.raw / (x.rawMax || 1)))
            v = { value: roundHalfUp((pcts.reduce((a, b) => a + b, 0) / pcts.length) * c.max), max: c.max, raw: have.map((x) => x.absent ? 'AB' : x.raw).join(' / '), rawMax: have.map((x) => x.rawMax).join(' / '), absent: have.every((x) => x.absent), partial: have.length < parts.length }
          }
        } else {
          const examCode = c.termMap?.[ct.key]
          if (!examCode) continue
          if (c.perRow) {
            const rowMax = Number(row[c.perRow] ?? 0)
            if (!(rowMax > 0)) continue // this row has no such paper (e.g. written-only)
            v = cellFor(row, examCode, c.key, rowMax, rowMax)
          } else {
            // Senior/secondary exam papers: card max is the row's own scheme
            const cardMax = c.key === 'exam' && (plan.family !== 'performance_profile') ? (Number(row.written ?? c.max) + Number(row.practical || 0)) : c.max
            v = cellFor(row, examCode, c.key === 'exam' && c.paperKey ? c.paperKey : c.key, cardMax, c.rawMax)
          }
        }
        cell.comps[c.key] = v
        cell.max += v.max ?? (c.max || 0)
        if (v.missing) { cell.complete = false; if (gated && shown && !v.soft) missing.push({ row: row.subject, term: ct.label, component: c.label, reason: v.reason }); if (v.soft && gated) warnings.push({ row: row.subject, term: ct.label, component: c.label, reason: v.reason }) }
        else cell.obtained += v.value || 0
      }
      if (cell.max > 0 && cell.complete) { cell.pct = 100 * cell.obtained / cell.max; cell.grade = gradeFor(cell.pct, scale) }
      if (plan.family === 'senior_progress') {
        const ex = cell.comps.exam
        if (ex && !ex.missing && ex.theoryMax) cell.fail = (100 * ex.theory / ex.theoryMax) < Number(p.def?.failFlag?.theoryPassPct ?? 33)
      }
      r.byTerm[ct.key] = shown ? cell : { hidden: true }
      if (shown && cell.complete) { cumO += cell.obtained; cumM += cell.max }
    }
    r.total = { obtained: cumO, max: cumM, pct: cumM > 0 ? 100 * cumO / cumM : null, grade: cumM > 0 ? gradeFor(100 * cumO / cumM, scale) : null }
    return r
  })

  let oO = 0, oM = 0
  const overallByTerm = {}
  for (const r of outRows) {
    if (!r.countsInAggregate || r.unmapped) continue
    oO += r.total.obtained; oM += r.total.max
    for (const [k, cell] of Object.entries(r.byTerm)) {
      if (cell.hidden || !cell.complete) continue
      const o = (overallByTerm[k] ||= { obtained: 0, max: 0 })
      o.obtained += cell.obtained; o.max += cell.max
    }
  }
  for (const o of Object.values(overallByTerm)) { o.pct = o.max ? 100 * o.obtained / o.max : null; o.grade = gradeFor(o.pct, scale) }
  const overall = { obtained: oO, max: oM, pct: oM ? 100 * oO / oM : null, grade: oM ? gradeFor(100 * oO / oM, scale) : null, byTerm: overallByTerm }

  // ── Non-marks sections (per card term, resolved to the exam term(s) it maps to) ──
  const examCodesFor = (ctKey) => {
    const codes = new Set()
    for (const c of plan.components) { const e = c.termMap?.[ctKey]; if (e) codes.add(e) }
    if (plan.family === 'secondary_annual') for (const c of plan.components) for (const t of c.terms || []) codes.add(t)
    return [...codes].map((c) => termsByCode[c]?.id).filter(Boolean)
  }
  const coSubjects = (p.subjects || []).filter((s) => s.kind === 'co_scholastic')
  const gradeIn = (subjectId, termIds) => {
    const hits = (p.coGrades || []).filter((g) => g.subject_id === subjectId && termIds.includes(g.term_id))
    hits.sort((a, b) => new Date(b.entered_at || 0) - new Date(a.entered_at || 0))
    return hits[0]?.grade ?? null
  }
  const areaRows = (defRows, code) => (defRows || []).map((r) => {
    const name = typeof r === 'string' ? r : r.name
    const subj = coSubjects.find((s) => normName(s.subject_name) === normName(name) && (!code || s.subject_code === code)) || coSubjects.find((s) => normName(s.subject_name) === normName(name))
    const byTerm = {}
    for (const ct of plan.cardTerms) {
      if (!cardKey.showTerms.includes(ct.key)) { byTerm[ct.key] = null; continue }
      const g = subj ? gradeIn(subj.id, examCodesFor(ct.key)) : null
      byTerm[ct.key] = g
      if (g == null && gateTerms.has(ct.key)) missing.push({ row: name, term: ct.label, component: 'grade', reason: subj ? 'grade not entered' : 'area not configured' })
    }
    return { name, byTerm }
  })
  const coScholastic = areaRows(p.def?.coScholastic?.rows, 'RCA')
  const gradedSubjects = areaRows(p.def?.gradedSubjects?.rows, 'RCG')

  const metaRows = p.meta || []
  const discipline = {}, remarks = {}
  for (const ct of plan.cardTerms) {
    if (!cardKey.showTerms.includes(ct.key)) continue
    const ids = examCodesFor(ct.key)
    const m = metaRows.filter((x) => x.term_id && ids.includes(x.term_id)).sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0]
    discipline[ct.key] = m?.discipline ?? null
    remarks[ct.key] = m?.remarks ?? null
    if (gateTerms.has(ct.key) && p.def?.discipline && !m?.discipline) warnings.push({ row: 'Discipline', term: ct.label, reason: 'not entered' })
  }
  const sess = metaRows.find((x) => !x.term_id) || {}
  const lastTerm = cardKey.showTerms[cardKey.showTerms.length - 1]
  const remarkText = remarks[lastTerm] || autoRemark(outRows, overall, p.attendance, p.student)

  // Attendance
  let attendance = null
  if (p.attendance) {
    const mode = p.def?.attendance?.mode || 'sessionTotal'
    attendance = { mode, sessionTotal: p.attendance.sessionTotal || null, byTerm: {} }
    for (const ct of plan.cardTerms) {
      const codes = examCodesFor(ct.key).map((id) => termById[id]?.short_code).filter(Boolean)
      let present = 0, marked = 0, any = false
      for (const c of codes) { const a = p.attendance.byTerm?.[c]; if (a) { present += a.present; marked += a.marked; any = true } }
      attendance.byTerm[ct.key] = any ? { present, marked } : null
    }
  }

  return {
    v: 2, family: p.family, templateName: p.templateName || null, title: p.def?.title || 'REPORT CARD',
    cardKey: cardKey.key, cardLabel: cardKey.label, showTerms: cardKey.showTerms, interim: !!cardKey.interim,
    sessionCode: p.sessionCode, className: p.className, classTeacher: p.classTeacher || null,
    student: publicStudent(p.student),
    plan: { cardTerms: plan.cardTerms, components: plan.components.map(({ key, label, max, ia, split, parts }) => ({ key, label, max, ia: !!ia, split: !!split, parts })), subjectTotal: plan.subjectTotal, iaTotal: plan.iaTotal || null },
    rows: outRows, overall,
    coScholastic, gradedSubjects, discipline, remarks, remark: remarkText,
    session: { achievement: sess.achievement || null, heightCm: sess.height_cm ?? null, weightKg: sess.weight_kg ?? null, promotedTo: sess.promoted_to || nextClass(p.className) || null, promotedToDefault: !sess.promoted_to },
    attendance,
    scales: { coScholastic: p.def?.coScholastic?.scale || ['A', 'B', 'C'], graded: p.def?.gradedSubjects?.scale || ['A'], discipline: p.def?.discipline?.scale || ['A', 'B', 'C'], gradeScale: { bands: scale?.bands || DEFAULT_BANDS, floorLabel: scale?.floorLabel || 'E' } },
    footer: p.def?.footer || {}, legend: p.def?.legend || null,
    completeness: { ok: missing.length === 0, missing, warnings },
    rank: null, sectionStrength: null, sectionHighest: null, sectionAverage: null, sectionAverageByTerm: null, // filled by the class pass
    computedAt: new Date().toISOString(),
  }
}

function publicStudent(s) {
  if (!s) return null
  return {
    id: s.id, name: s.full_name, admissionNo: s.admission_no, className: s.class_name, section: s.section, rollNumber: s.roll_number,
    dob: s.date_of_birth, father: s.father_name, mother: s.mother_name, house: s.house, apaarId: s.apaar_id, gender: s.gender,
    boardRegNo: s.board_reg_no || null, compId: s.legacy_comp_id || null, photoKey: s.photo_key || null,
    branchCode: s.branches?.code || null, branchName: s.branches?.name || null,
    optionalSubject: s.optional_subject || null, sciencePath: s.science_path || null,
  }
}

// ── Class pass: rank + section-highest across a set of computed cards ───────
export function applyClassStats(cards) {
  const complete = cards.filter((c) => c.completeness.ok && c.overall.pct != null)
  const bySection = new Map()
  for (const c of complete) { const k = c.student.section || ''; if (!bySection.has(k)) bySection.set(k, []); bySection.get(k).push(c) }
  for (const [, list] of bySection) {
    const sorted = [...list].sort((a, b) => b.overall.pct - a.overall.pct)
    let last = null, rank = 0
    sorted.forEach((c, i) => { if (last == null || c.overall.pct < last - 1e-9) { rank = i + 1; last = c.overall.pct } c.rank = rank; c.sectionStrength = list.length })
    const highest = {}, sums = {}, counts = {}
    const byTermSum = {}, byTermCount = {}
    for (const c of list) for (const r of c.rows) {
      if (r.unmapped || !(r.total.max > 0)) continue
      const cur = highest[r.subject] ?? -1; if (r.total.obtained > cur) highest[r.subject] = r.total.obtained
      sums[r.subject] = (sums[r.subject] || 0) + r.total.obtained; counts[r.subject] = (counts[r.subject] || 0) + 1
      for (const [k, cell] of Object.entries(r.byTerm)) { if (cell.hidden || !cell.complete) continue; const key = `${r.subject}|${k}`; byTermSum[key] = (byTermSum[key] || 0) + cell.obtained; byTermCount[key] = (byTermCount[key] || 0) + 1 }
    }
    const average = {}; for (const s of Object.keys(sums)) average[s] = Math.round(10 * sums[s] / counts[s]) / 10
    const averageByTerm = {}; for (const key of Object.keys(byTermSum)) averageByTerm[key] = Math.round(10 * byTermSum[key] / byTermCount[key]) / 10
    for (const c of list) { c.sectionHighest = highest; c.sectionAverage = average; c.sectionAverageByTerm = averageByTerm }
  }
  return cards
}

// ── Auto remark (used when the class teacher left the remark blank) ─────────
export function autoRemark(rows, overall, attendance, student) {
  const pct = overall?.pct
  const first = (student?.full_name || student?.name || 'The student').split(' ')[0]
  if (pct == null) return ''
  const tier = pct >= 90 ? 'an outstanding' : pct >= 75 ? 'a very good' : pct >= 60 ? 'a good' : pct >= 45 ? 'a satisfactory' : 'a below-average'
  const scored = rows.filter((r) => !r.unmapped && r.total.max > 0 && r.countsInAggregate).map((r) => ({ s: r.subject, p: r.total.pct }))
  scored.sort((a, b) => b.p - a.p)
  const parts = [`${first} has shown ${tier} performance this session.`]
  if (scored.length >= 2 && scored[0].p >= 75) parts.push(`Strong in ${titleCase(scored[0].s)}${scored[1].p >= 75 ? ` and ${titleCase(scored[1].s)}` : ''}.`)
  const weak = scored.filter((x) => x.p < 45)
  if (weak.length) parts.push(`Needs focused effort in ${weak.slice(0, 2).map((x) => titleCase(x.s)).join(' and ')}.`)
  else if (scored.length && scored[scored.length - 1].p < 65 && pct >= 60) parts.push(`More practice in ${titleCase(scored[scored.length - 1].s)} will help.`)
  const a = attendance?.sessionTotal
  if (a?.marked) { const ap = 100 * a.present / a.marked; if (ap >= 95) parts.push('Attendance has been excellent.'); else if (ap < 75) parts.push('Regular attendance is essential for further improvement.') }
  parts.push(pct >= 75 ? 'Keep it up!' : 'Keep working hard.')
  return parts.join(' ')
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bLng\b/, 'Lng').replace(/\bAnd\b/, '&') }
