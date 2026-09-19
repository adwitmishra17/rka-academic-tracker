import React, { useState, useMemo, useEffect } from 'react'
import { examApi, reportTemplateApi } from '../../lib/api'
import { compareClasses } from '../../lib/classes'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'
import CardAreasEditor from './CardAreasEditor.jsx'

/* Stage 1 — Setup: terms (per branch+session), subjects + teachers per class,
   class-teacher (read-only, from Teachers), and the report-card template bound
   to each class. Writes go straight to Supabase via /api/exam/*. */

const CO_HINTS = ['art', 'craft', 'music', 'dance', 'physical education', ' pe', 'pe ', 'sport', 'game', 'moral', 'yoga', 'drawing', 'painting', 'club', 'library', 'value education', 'life skill', 'karate', 'eca', 'activity', 'reading', 'cuet']
const TERM_HINT = { T1: 'Periodic test 1 (PA-1) — feeds the Half-Yearly card', HY: 'Half-Yearly exam', T2: 'Periodic test 2 (PA-2) — feeds the Annual card', AN: 'Annual exam' }
// Which card family suits which class — a mismatch (e.g. the XI–XII Progress
// Report on Class 9) yields no rows, no composites and wrong papers.
function familyFits(family, cls) {
  if (!family) return true
  if (/^Class (11|12)\b/.test(cls)) return family === 'senior_progress'
  if (/^Class (9|10)$/.test(cls)) return family === 'secondary_annual'
  if (['Nursery', 'LKG', 'UKG'].includes(cls)) return family === 'pre_primary' || family === 'performance_profile'
  return family === 'performance_profile'
}
const FAMILY_LABEL = { performance_profile: 'Classes I–VIII style', secondary_annual: 'Classes IX–X style', senior_progress: 'Classes XI–XII style', pre_primary: 'Nursery–KG style' }
const guessKind = (n) => (CO_HINTS.some((h) => ` ${String(n).toLowerCase()} `.includes(h)) ? 'co_scholastic' : 'scholastic')

export default function SetupStage({ branch, sessionCode, className, config, refreshConfig, classNames, classBadges, setClass, setStage }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [termDraft, setTermDraft] = useState({})
  const [buildRows, setBuildRows] = useState(null)   // timetable preview
  const [newSub, setNewSub] = useState({ subjectName: '', kind: 'scholastic', teacherId: '' })
  const [flash, setFlash] = useState('')
  const [tplNonce, setTplNonce] = useState(0)   // re-mounts the select after a cancelled change
  const say = (m) => { setFlash(m); setTimeout(() => setFlash(''), 3000) }
  const fail = (e) => setErr(e.message || String(e))

  const terms = config?.terms || []
  const teachers = config?.teachers || []
  const templates = (config?.templates || []).filter((t) => t.family !== 'hpc')   // the HPC setup is its own page
  const classMap = config?.classMap || {}
  const selected = className || ''
  // The card decides what is listed here: rows come from the class's template
  // (via /api/exam/rules) and each maps to the exam subject that feeds it.
  const [cardRows, setCardRows] = useState([])      // [{ subject, mapped:[names] }]
  const [rulesTick, setRulesTick] = useState(0)
  useEffect(() => {
    setCardRows([])
    if (!selected || !classMap[selected]) return
    examApi.rules(branch, sessionCode, selected).then(({ rows }) => setCardRows(rows || [])).catch(() => {})
  }, [branch, sessionCode, selected, classMap, rulesTick]) // eslint-disable-line
  const classSubjects = useMemo(() => (config?.subjects || []).filter((s) => s.class_name === selected), [config, selected])
  const byName = useMemo(() => Object.fromEntries(classSubjects.map((s) => [s.subject_name, s])), [classSubjects])
  const onCardNames = useMemo(() => new Set(cardRows.flatMap((r) => r.mapped || [])), [cardRows])
  const otherSubjects = useMemo(() => classSubjects.filter((s) => !onCardNames.has(s.subject_name) && !['RCA', 'RCG'].includes(s.subject_code)).sort((a, b) => (a.kind === b.kind ? a.subject_name.localeCompare(b.subject_name) : a.kind === 'co_scholastic' ? 1 : -1)), [classSubjects, onCardNames])
  const subjects = classSubjects
  // Family of the template bound to this class — drives whether "Add to card"
  // offers core/optional (seniors) or a single classRows row (other families).
  const cardFamily = useMemo(() => (templates.find((t) => t.id === classMap[selected])?.family) || null, [templates, classMap, selected])
  // canonical exam-subject name for a card row that has no subject yet
  const CANON = { 'ENGLISH LNG & LIT.': 'English', 'ENGLISH CORE': 'English', 'HINDI COURSE-A': 'Hindi', 'HINDI CORE': 'Hindi', 'GENERAL AWARENESS WRITTEN': 'General Awareness', 'GK': 'GK' }
  const canonName = (row) => CANON[row] || row.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/, '&')
  async function createForRows(rows) {
    if (!rows.length) return
    setBusy('add'); setErr('')
    try {
      await examApi.bulkSubjects(branch, sessionCode, rows.map((r, i) => ({ className: selected, subjectName: canonName(r.subject), kind: 'scholastic', sortOrder: 100 + i })))
      await refreshConfig(); setRulesTick((n) => n + 1); say(`${rows.length} subject${rows.length === 1 ? '' : 's'} created`)
    } catch (e) { fail(e) }
    setBusy('')
  }
  useEffect(() => { setBuildRows(null); setErr('') }, [selected])

  // ── Terms ─────────────────────────────────────────────────────────────────
  async function seedTerms() {
    setBusy('terms'); setErr('')
    try { await examApi.seedTerms(branch, sessionCode); await refreshConfig(); say('4 standard terms created') } catch (e) { fail(e) }
    setBusy('')
  }
  async function saveTerm(t) {
    const d = termDraft[t.id]; if (!d) return
    setBusy(t.id)
    try { await examApi.saveTerm(t.id, d); setTermDraft((x) => { const n = { ...x }; delete n[t.id]; return n }); await refreshConfig(); say(`${t.name} saved`) } catch (e) { fail(e) }
    setBusy('')
  }

  // ── Subjects ──────────────────────────────────────────────────────────────
  async function openBuild() {
    setBusy('build'); setErr('')
    try {
      const { byClass } = await examApi.timetableSubjects(branch)
      const existing = new Set((config?.subjects || []).map((s) => `${s.class_name}__${s.subject_name.toLowerCase()}`))
      const classes = selected ? [selected] : Object.keys(byClass).sort(compareClasses)
      const rows = []
      for (const cls of classes) for (const r of byClass[cls] || []) {
        const exists = existing.has(`${cls}__${r.subjectName.toLowerCase()}`)
        rows.push({ className: cls, subjectName: r.subjectName, teacherId: r.teacherId, teacherName: r.teacherName, count: r.count, kind: guessKind(r.subjectName), exists, include: !exists })
      }
      if (!rows.length) setErr(selected ? `No timetable periods found for ${selected} in ${branch}.` : `No timetable periods found for ${branch}.`)
      setBuildRows(rows)
    } catch (e) { fail(e) }
    setBusy('')
  }
  async function commitBuild() {
    const rows = buildRows.filter((r) => r.include && !r.exists)
    if (!rows.length) { setBuildRows(null); return }
    setBusy('commit')
    try {
      const orderBy = {}
      const payload = rows.map((r) => ({ className: r.className, subjectName: r.subjectName, kind: r.kind, teacherId: r.teacherId || null, sortOrder: (orderBy[r.className] = (orderBy[r.className] || subjects.length) + 1) }))
      const { saved } = await examApi.bulkSubjects(branch, sessionCode, payload)
      setBuildRows(null); await refreshConfig(); say(`${saved} subjects added`)
    } catch (e) { fail(e) }
    setBusy('')
  }
  async function addSubject() {
    if (!newSub.subjectName.trim() || !selected) return
    setBusy('add')
    try {
      await examApi.bulkSubjects(branch, sessionCode, [{ className: selected, subjectName: newSub.subjectName.trim(), kind: newSub.kind, teacherId: newSub.teacherId || null, sortOrder: subjects.length + 1 }])
      setNewSub({ subjectName: '', kind: 'scholastic', teacherId: '' }); await refreshConfig(); say('Subject added')
    } catch (e) { fail(e) }
    setBusy('')
  }
  async function patchSubject(s, patch) {
    setBusy(s.id); setErr('')
    try { await examApi.saveSubject(s.id, patch); await refreshConfig() } catch (e) { fail(e) }
    setBusy('')
  }
  async function removeSubject(s) {
    if (!confirm(`Remove ${s.subject_name} from ${s.class_name}? Its generated papers go with it (refused if any marks exist).`)) return
    setBusy(s.id)
    try { await examApi.deleteSubject(s.id); await refreshConfig(); say('Removed') } catch (e) { fail(e) }
    setBusy('')
  }
  // Promote a subject from the "other subjects" list onto this class's card by
  // appending it to the bound template's definition — seniors use coreOrder /
  // optionalOrder (+ a default scheme), other families use classRows. Mirrors
  // RulesStage's addToList / addRow so both entry points behave identically.
  async function addToCard(s, which) {
    const tpl = templates.find((t) => t.id === classMap[selected])
    if (!tpl) { setErr('Bind a report-card template to this class first (above).'); return }
    const name = s.subject_name.trim().toUpperCase()
    const fam = tpl.family
    setBusy(s.id); setErr('')
    try {
      const def = JSON.parse(JSON.stringify(tpl.definition || {}))
      if (fam === 'senior_progress') {
        const key = which === 'optionalOrder' ? 'optionalOrder' : 'coreOrder'
        const fallback = key === 'optionalOrder'
          ? (/Commerce$/.test(selected) ? ['PHYSICAL EDUCATION', 'COMPUTER SCIENCE', 'HINDI CORE', 'MATHEMATICS'] : ['PHYSICAL EDUCATION', 'COMPUTER SCIENCE', 'HINDI CORE'])
          : []
        const cur = def[key]?.[selected] || fallback
        if (cur.some((n) => String(n).toUpperCase() === name)) { say(`${s.subject_name} is already on the card`); setBusy(''); return }
        def.schemes = def.schemes || {}
        if (!def.schemes[name]) def.schemes[name] = { theory: 80, practical: 20 }
        def[key] = def[key] || {}
        def[key][selected] = [...cur, name]
      } else {
        def.classRows = def.classRows || {}
        const cur = def.classRows[selected] || []
        if (cur.some((r) => String(r.subject || '').toUpperCase() === name)) { say(`${s.subject_name} is already on the card`); setBusy(''); return }
        const row = fam === 'secondary_annual' ? { subject: name, locCode: '', written: 80, practical: 0 }
          : fam === 'pre_primary' ? { subject: name, oral: 40, written: 60 }
          : { subject: name }
        def.classRows[selected] = [...cur, row]
      }
      await reportTemplateApi.save(tpl.id, { definition: def })
      await refreshConfig(); setRulesTick((n) => n + 1)
      say(`${s.subject_name} added to the card — set its marks split in Rules`)
    } catch (e) { fail(e) }
    setBusy('')
  }

  // ── Own copy: split this class off the shared template so it can be configured alone ──
  async function ownCopy(cls) {
    const cur = templates.find((t) => t.id === classMap[cls]); if (!cur) return
    const shared = Object.entries(classMap).filter(([c, id]) => id === cur.id && c !== cls).map(([c]) => c)
    if (!shared.length) { say(`${cls} is already the only class on "${cur.name}"`); return }
    if (!confirm(`Give ${cls} its own report-card template?\n\nA copy of "${cur.name}" is created as "${cur.name.replace(/\s*·\s*[^·]+$/, '')} · ${cls}" with the same components, card areas and ${cls}'s rows, and ${cls} is moved onto it. ${shared.join(', ')} stay on the shared template. From then on the two are edited separately (Copy rows / Copy components can still push changes across).\n\nPapers are unaffected; re-sync is not needed unless you change the rules afterwards.`)) return
    setBusy('tpl'); setErr('')
    try {
      const r = await reportTemplateApi.duplicate(sessionCode, cls, cur.id)
      await refreshConfig(); setTplNonce((n) => n + 1); say(`${cls} now uses its own template "${r.template.name}"`)
    } catch (e) { fail(e) }
    setBusy('')
  }
  // ── Template binding (clones the lowest class's rows for marks-card families) ──
  async function bindTemplate(cls, templateId) {
    const cur = templates.find((t) => t.id === classMap[cls])
    const next = templates.find((t) => t.id === templateId)
    if ((cur?.id || '') === (templateId || '')) return
    const fitNote = next && !familyFits(next.family, cls) ? `\n\nWARNING: "${next.name}" is a ${FAMILY_LABEL[next.family]} card — it will not fit ${cls} (no rows, wrong papers).` : ''
    if (!confirm(`Change the report-card template for ${cls}?\n\nFrom: ${cur?.name || 'none'}\nTo: ${next?.name || 'none'}${fitNote}\n\nRules, papers and the card layout all follow the template. Re-sync papers afterwards.`)) { setTplNonce((n) => n + 1); return }
    setBusy('tpl'); setErr('')
    try {
      if (templateId) {
        const tpl = next
        const def = tpl?.definition || {}
        if (['performance_profile', 'secondary_annual', 'pre_primary'].includes(tpl?.family) && !def.classRows?.[cls]) {
          const src = Object.keys(def.classRows || {}).sort(compareClasses)[0]
          if (src) await reportTemplateApi.save(templateId, { definition: { ...def, classRows: { ...def.classRows, [cls]: JSON.parse(JSON.stringify(def.classRows[src])) } } })
        }
      }
      await reportTemplateApi.assign(sessionCode, cls, templateId || null)
      await refreshConfig(); say(templateId ? 'Template bound' : 'Template unbound')
    } catch (e) { fail(e) }
    setBusy('')
  }

  const teacherOpts = (
    <>
      <option value="">— not set —</option>
      {teachers.map((t) => <option key={t.id} value={t.id} disabled={!t.email}>{t.name}</option>)}
    </>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      {flash && <Note tone="green">{flash}</Note>}

      {/* Terms */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-dark)', margin: 0, flex: 1 }}>Terms · {branch} · {sessionCode}</h3>
          {terms.length === 0 && <Btn kind="primary" onClick={seedTerms} disabled={busy === 'terms'}>Initialise 4 standard terms</Btn>}
        </div>
        {terms.length === 0 ? (
          <Note tone="gold">No terms yet for this branch and session. The standard set is <b>Term 1</b> (periodic test 1) · <b>Half Yearly</b> · <b>Term 2</b> (periodic test 2) · <b>Annual</b>. Nothing else in this window works until terms exist.</Note>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Term</th><th style={th}>Code</th><th style={th}>Starts</th><th style={th}>Ends</th><th style={th}>Result date</th><th style={th}>Finalised</th><th style={th}></th></tr></thead>
            <tbody>{terms.map((t) => {
              const d = termDraft[t.id] || {}
              const v = (k, col) => (d[k] !== undefined ? d[k] : (t[col] || ''))
              const set = (k, val) => setTermDraft((x) => ({ ...x, [t.id]: { ...x[t.id], [k]: val } }))
              return (
                <tr key={t.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{t.name}<div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 400 }}>{TERM_HINT[t.short_code] || ''}</div></td><td style={td}><Pill tone="muted">{t.short_code}</Pill></td>
                  <td style={td}><input type="date" value={v('startsOn', 'starts_on')} onChange={(e) => set('startsOn', e.target.value)} style={inp} /></td>
                  <td style={td}><input type="date" value={v('endsOn', 'ends_on')} onChange={(e) => set('endsOn', e.target.value)} style={inp} /></td>
                  <td style={td}><input type="date" value={v('resultDate', 'result_date')} onChange={(e) => set('resultDate', e.target.value)} style={inp} /></td>
                  <td style={td}><input type="checkbox" checked={d.isFinalized !== undefined ? d.isFinalized : !!t.is_finalized} onChange={(e) => set('isFinalized', e.target.checked)} /></td>
                  <td style={{ ...td, textAlign: 'right' }}>{termDraft[t.id] && <Btn small kind="primary" onClick={() => saveTerm(t)} disabled={busy === t.id}>Save</Btn>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </div>

      {/* Class overview + subjects */}
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 14, alignItems: 'start' }}>
        <div style={{ ...card, padding: 8 }}>
          <div style={{ padding: '6px 8px 8px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Classes</div>
          {classNames.map((c) => {
            const b = classBadges[c] || {}
            const active = c === selected
            return (
              <button key={c} onClick={() => setClass(c)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '7px 9px', border: 'none', borderRadius: 10, background: active ? 'var(--green-light)' : 'transparent', cursor: 'pointer', color: active ? 'var(--green-dark)' : 'var(--text)', fontSize: 12.5, fontWeight: active ? 600 : 500 }}>
                <span style={{ flex: 1 }}>{c}</span>
                <span title="subjects" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{b.subjects || 0}</span>
                {b.subjects > 0 && !b.template && <span title="no report-card template" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--crimson)' }} />}
                {b.template && !familyFits(templates.find((t) => t.id === classMap[c])?.family, c) && <span title="template does not fit this class" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--crimson)', outline: '2px solid var(--crimson-light)' }} />}
              </button>
            )
          })}
          <div style={{ padding: '10px 8px 4px' }}>
            <Btn small onClick={openBuild} disabled={busy === 'build' || terms.length === 0} title="Sweep the whole branch timetable">Build all classes from timetable</Btn>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {!selected ? (
            <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>Pick a class on the left to manage its subjects, teachers and card template — or build every class from the timetable in one go.</div>
          ) : (
            <>
              {/* Class header: template + class teacher */}
              <div style={{ ...card, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ marginRight: 'auto' }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-dark)', margin: 0 }}>{selected}</h3>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                    Class teacher: <b style={{ color: 'var(--text)' }}>{config?.classTeachers?.[selected]?.name || '— not set —'}</b> <span title="Set on the teacher's record in Teachers → class teacher of">(from Teachers)</span>
                  </div>
                </div>
                <div>
                  <span style={lbl}>Report-card template</span>
                  <select key={`${selected}-${tplNonce}-${classMap[selected] || ''}`} defaultValue={classMap[selected] || ''} onChange={(e) => bindTemplate(selected, e.target.value)} disabled={busy === 'tpl'} style={{ ...inp, minWidth: 260, borderColor: classMap[selected] && !familyFits(templates.find((t) => t.id === classMap[selected])?.family, selected) ? 'var(--crimson)' : 'var(--gray-200)' }}>
                    <option value="">— none (no card for this class) —</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{familyFits(t.family, selected) ? '' : '  (does not fit this class)'}</option>)}
                  </select>
                  {classMap[selected] && !familyFits(templates.find((t) => t.id === classMap[selected])?.family, selected) && (
                    <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 4 }}>This template does not fit {selected} — no rows or composites will resolve. Pick the matching card.</div>
                  )}
                  {classMap[selected] && (() => { const others = Object.entries(classMap).filter(([c, id]) => id === classMap[selected] && c !== selected).map(([c]) => c); return others.length ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>Shared with {others.join(', ')} — components and card areas are common.</span>
                      <button onClick={() => ownCopy(selected)} disabled={busy === 'tpl'} style={{ border: '1px solid var(--gray-200)', background: 'var(--white)', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }} title="Copy this template for this class only, so it can be configured independently">Own copy for {selected}</button>
                    </div>
                  ) : <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Only {selected} uses this template.</div> })()}
                </div>
                {classMap[selected] && <Btn small onClick={async () => { const t = templates.find((x) => x.id === classMap[selected]); const n = prompt('Template name (shown in the list; not printed):', t?.name || ''); if (!n || !n.trim() || n.trim() === t?.name) return; setBusy('tpl'); try { await reportTemplateApi.save(t.id, { name: n.trim() }); await refreshConfig(); say('Template renamed') } catch (e) { fail(e) } setBusy('') }} title="Rename this template">Rename</Btn>}
                <Btn small onClick={() => setStage('rules')} disabled={!classMap[selected]}>Scoring rules →</Btn>
              </div>

              {/* On the card — one line per card row, in print order */}
              <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Subjects on the card <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {cardRows.some((r) => r.optional) ? `${cardRows.filter((r) => !r.optional).length} core + ${cardRows.filter((r) => r.optional).length} optional` : cardRows.length}</span></div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Exactly what prints, in print order. Change rows in Scoring rules; set the subject teacher here for reference.{cardRows.some((r) => r.optional) ? ' Optional subjects print only for the students who chose them in SMS.' : ''}</div>
                  </div>
                  {cardRows.some((r) => !(r.mapped || []).length) && <Btn kind="primary" small onClick={() => createForRows(cardRows.filter((r) => !(r.mapped || []).length))} disabled={busy === 'add'}>Create {cardRows.filter((r) => !(r.mapped || []).length).length} missing subject{cardRows.filter((r) => !(r.mapped || []).length).length === 1 ? '' : 's'}</Btn>}
                </div>
                {!classMap[selected] ? (
                  <div style={{ padding: 20, fontSize: 12.5, color: 'var(--text-muted)' }}>Bind a report-card template above — the card decides which subjects are listed.</div>
                ) : cardRows.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 12.5, color: 'var(--text-muted)' }}>This template has no rows for {selected} yet. Add them in <button onClick={() => setStage('rules')} style={{ border: 'none', background: 'none', color: 'var(--green-dark)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>Scoring rules</button>.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>#</th><th style={th}>On the card</th><th style={th}>Exam subject</th><th style={th}>Subject teacher <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(reference — marks are entered by the office)</span></th><th style={th}>Optional</th></tr></thead>
                    <tbody>{cardRows.map((r, i) => {
                      const members = (r.mapped || []).map((n) => byName[n]).filter(Boolean)
                      const firstOptional = r.optional && !cardRows[i - 1]?.optional
                      return (
                        <React.Fragment key={r.subject}>
                        {firstOptional && <tr><td colSpan={5} style={{ ...td, background: 'var(--gray-50)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600 }}>Optional · one per student, chosen in SMS (science path PCM / PCB also drops Biology or Mathematics from the core)</td></tr>}
                        <tr style={{ background: members.length ? 'transparent' : 'var(--gold-light)' }}>
                          <td style={{ ...td, color: 'var(--text-muted)', width: 30 }}>{r.optional ? '•' : i + 1}</td>
                          <td style={{ ...td, fontWeight: 700, textTransform: 'uppercase', fontSize: 12 }}>{r.subject}{r.additional ? <span style={{ marginLeft: 6 }}><Pill tone="gold">additional</Pill></span> : null}</td>
                          <td style={td}>{members.length ? members.map((s) => <span key={s.id} style={{ marginRight: 6 }}>{s.subject_name}</span>) : <span style={{ color: 'var(--gold-dark)', fontSize: 12 }}>no subject yet → <button onClick={() => createForRows([r])} disabled={busy === 'add'} style={{ border: 'none', background: 'none', color: 'var(--green-dark)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, padding: 0 }}>create "{canonName(r.subject)}"</button></span>}{members.length > 1 && <div style={{ fontSize: 10.5, color: 'var(--green-dark)' }}>summed, then scaled to /100</div>}</td>
                          <td style={td}>{members.map((s) => <div key={s.id} style={{ marginBottom: members.length > 1 ? 4 : 0 }}><select value={s.assigned_teacher_id || ''} onChange={(e) => patchSubject(s, { teacherId: e.target.value || null })} style={{ ...inp, width: '100%', minWidth: 150, maxWidth: 260 }}>
                                  {!s.assigned_teacher_id && s.assigned_teacher_email && <option value="">{s.assigned_teacher_email}</option>}
                                  {teacherOpts}
                                </select></div>)}</td>
                          <td style={td}>{members.map((s) => <input key={s.id} type="checkbox" checked={!!s.is_optional} onChange={(e) => patchSubject(s, { isOptional: e.target.checked })} title="Elective (Class 11/12 admission choice)" />)}</td>
                        </tr>
                        </React.Fragment>
                      )
                    })}</tbody>
                  </table></div>
                )}
              </div>

              {/* Card areas — grades, not marks; template-wide */}
              {classMap[selected] && <CardAreasEditor template={templates.find((t) => t.id === classMap[selected])} sharedClasses={Object.entries(classMap).filter(([, id]) => id === classMap[selected]).map(([c]) => c).sort(compareClasses)} branch={branch} sessionCode={sessionCode} refreshConfig={refreshConfig} onSaved={() => setRulesTick((n) => n + 1)} />}

              {/* Other subjects — timetable/lesson-log only, not on the card */}
              <details style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <summary style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1 }}>Other subjects for {selected} (timetable, lesson log, monthly tests — not on the card) · <b>{otherSubjects.length}</b></span>
                  <Btn small onClick={(e) => { e.preventDefault(); openBuild() }} disabled={busy === 'build' || terms.length === 0}>Import from timetable</Btn>
                </summary>
                {otherSubjects.length > 0 && (
                  <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', borderTop: '1px solid var(--gray-100)' }}>
                    <thead><tr><th style={th}>Subject</th><th style={th}>Kind</th><th style={th}>Teacher</th><th style={th}></th></tr></thead>
                    <tbody>{otherSubjects.map((s) => (
                      <tr key={s.id} style={{ opacity: busy === s.id ? 0.5 : 1 }}>
                        <td style={{ ...td, fontWeight: 600 }}>{s.subject_name}</td>
                        <td style={td}><button onClick={() => patchSubject(s, { kind: s.kind === 'co_scholastic' ? 'scholastic' : 'co_scholastic' })} title="Click to flip" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}><Pill tone={s.kind === 'co_scholastic' ? 'gold' : 'green'}>{s.kind === 'co_scholastic' ? 'co-scholastic' : 'scholastic'}</Pill></button></td>
                        <td style={td}><select value={s.assigned_teacher_id || ''} onChange={(e) => patchSubject(s, { teacherId: e.target.value || null })} style={{ ...inp, width: '100%', minWidth: 150, maxWidth: 260 }}>
                                  {!s.assigned_teacher_id && s.assigned_teacher_email && <option value="">{s.assigned_teacher_email}</option>}
                                  {teacherOpts}
                                </select></td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {classMap[selected] && s.kind !== 'co_scholastic' && (
                            cardFamily === 'senior_progress' ? (
                              <>
                                <Btn small onClick={() => addToCard(s, 'coreOrder')} disabled={busy === s.id} title="Add as a core subject — appears for every student in this class">+ core</Btn>{' '}
                                <Btn small onClick={() => addToCard(s, 'optionalOrder')} disabled={busy === s.id} title="Add as a one-per-student optional (chosen in SMS)">+ optional</Btn>{' '}
                              </>
                            ) : (
                              <><Btn small onClick={() => addToCard(s)} disabled={busy === s.id} title="Add this subject to the report card">+ add to card</Btn>{' '}</>
                            )
                          )}
                          <Btn small kind="danger" onClick={() => removeSubject(s)}>✕ remove</Btn>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '10px 14px', borderTop: '1px solid var(--gray-100)', flexWrap: 'wrap' }}>
                  <div><span style={lbl}>Add subject</span><input value={newSub.subjectName} onChange={(e) => setNewSub((x) => ({ ...x, subjectName: e.target.value, kind: guessKind(e.target.value) }))} placeholder="e.g. Sanskrit" style={{ ...inp, width: 180 }} /></div>
                  <div><span style={lbl}>Kind</span><select value={newSub.kind} onChange={(e) => setNewSub((x) => ({ ...x, kind: e.target.value }))} style={inp}><option value="scholastic">Scholastic</option><option value="co_scholastic">Co-scholastic</option></select></div>
                  <div><span style={lbl}>Teacher</span><select value={newSub.teacherId} onChange={(e) => setNewSub((x) => ({ ...x, teacherId: e.target.value }))} style={{ ...inp, minWidth: 200 }}>{teacherOpts}</select></div>
                  <Btn kind="primary" onClick={addSubject} disabled={!newSub.subjectName.trim() || busy === 'add'}>Add</Btn>
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      {/* Timetable build preview */}
      {buildRows && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setBuildRows(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', width: 'min(900px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}><b>Subjects from the timetable</b><div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Teacher = who takes the most periods. Untick anything that shouldn't be examined. Already-present subjects are greyed out.</div></div>
              <Btn small onClick={() => setBuildRows((r) => r.map((x) => ({ ...x, include: !x.exists })))}>All</Btn>
              <Btn small onClick={() => setBuildRows((r) => r.map((x) => ({ ...x, include: false })))}>None</Btn>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}></th><th style={th}>Class</th><th style={th}>Subject</th><th style={th}>Kind</th><th style={th}>Teacher</th><th style={th}>Periods</th></tr></thead>
                <tbody>{buildRows.map((r, i) => (
                  <tr key={i} style={{ opacity: r.exists ? 0.45 : 1 }}>
                    <td style={td}><input type="checkbox" checked={r.include} disabled={r.exists} onChange={(e) => setBuildRows((rows) => rows.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} /></td>
                    <td style={td}>{r.className}</td><td style={{ ...td, fontWeight: 600 }}>{r.subjectName}{r.exists ? <Pill tone="muted">exists</Pill> : null}</td>
                    <td style={td}><select value={r.kind} disabled={r.exists} onChange={(e) => setBuildRows((rows) => rows.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))} style={inp}><option value="scholastic">Scholastic</option><option value="co_scholastic">Co-scholastic</option></select></td>
                    <td style={td}><select value={r.teacherId || ''} disabled={r.exists} onChange={(e) => setBuildRows((rows) => rows.map((x, j) => j === i ? { ...x, teacherId: e.target.value } : x))} style={{ ...inp, minWidth: 180 }}>{teacherOpts}</select></td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>{r.count}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--gray-100)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setBuildRows(null)}>Cancel</Btn>
              <Btn kind="primary" onClick={commitBuild} disabled={busy === 'commit'}>Add {buildRows.filter((r) => r.include && !r.exists).length} subjects</Btn>
            </div>
          </div>
        </div>
      )}
      {busy === 'build' && <Spinner />}
    </div>
  )
}
