import React, { useState, useEffect, useMemo } from 'react'
import { examApi, reportTemplateApi } from '../../lib/api'
import { planCard } from '../../../lib/cardEngine.js'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'
import { compareClasses } from '../../lib/classes'

/* Stage 2 — Scoring rules. Edits the class's report-card template
   definition: which components make a subject-term cell, their RAW paper
   max vs the marks they are worth ON THE CARD, which exam term each
   component's paper lives in, and how template rows map to the class's
   actual subjects (composites, split subjects like Hindi Grammar +
   Hindi Literature). Rounding is half-up (6.5 → 7, 6.4 → 6). */

const EXAM_CODES = ['T1', 'HY', 'T2', 'AN']

export default function RulesStage({ branch, sessionCode, className, config, refreshConfig, setStage }) {
  const [data, setData] = useState(null)
  const [def, setDef] = useState(null)   // editable copy of template.definition
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = () => {
    setBusy(true); setErr('')
    examApi.rules(branch, sessionCode, className)
      .then((d) => { setData(d); setDef(d.template ? JSON.parse(JSON.stringify(d.template.definition || {})) : null); setDirty(false) })
      .catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  useEffect(load, [branch, sessionCode, className]) // eslint-disable-line

  const family = data?.template?.family
  // The plan is derived from the EDITING copy (def), not the server's snapshot,
  // so every edit — including removing a component — shows immediately and
  // what you see is exactly what Save persists. Same engine code as the server.
  const plan = useMemo(() => (def && family ? planCard(def, family) : data?.plan || null), [def, family, data])
  const sharedClasses = useMemo(() => Object.entries(config?.classMap || {}).filter(([, id]) => id === data?.template?.id).map(([c]) => c), [config, data])
  const classSubjects = data?.subjects || []
  const cardTerms = plan?.cardTerms || []

  function upd(mut) { setDef((d) => { const n = JSON.parse(JSON.stringify(d)); mut(n); return n }); setDirty(true) }

  // ── components (performance_profile) ──────────────────────────────────────
  const comps = useMemo(() => (plan ? plan.components : []), [plan])

  // Does the on-card arithmetic add up to the card's subject total?
  const arithmetic = useMemo(() => {
    if (!plan) return { ok: true, text: '' }
    const total = plan.subjectTotal || 100
    if (family === 'performance_profile') {
      const sum = comps.reduce((s, c) => s + Number(c.max || 0), 0)
      const parts = comps.map((c) => `${c.label} ${c.max}`).join(' + ')
      return { ok: sum === total, sum, text: `Each term column: ${parts} = ${sum} / ${total}`, problem: sum > total ? `exceeds ${total} by ${sum - total}. Reduce a component.` : `short by ${total - sum}. Add it to a component.` }
    }
    if (family === 'secondary_annual') {
      const ia = comps.filter((c) => c.ia).reduce((s, c) => s + Number(c.max || 0), 0)
      const exam = comps.find((c) => !c.ia)
      const sum = ia + Number(exam?.max || 0)
      return { ok: sum === total, sum, text: `Internal assessment ${comps.filter((c) => c.ia).map((c) => c.max).join(' + ')} = ${ia}, plus annual exam ${exam?.max || 0} = ${sum} / ${total}`, problem: sum > total ? `exceeds ${total} by ${sum - total}.` : `short by ${total - sum}.` }
    }
    if (family === 'pre_primary') {
      const bad = (def?.classRows?.[className] || []).filter((r) => Number(r.oral ?? 40) + Number(r.written ?? 60) !== 100).map((r) => r.subject)
      return { ok: bad.length === 0, sum: 100, text: 'Each subject per exam: Oral + Written = 100', problem: `these rows do not add up to 100: ${bad.join(', ')}` }
    }
    if (family === 'senior_progress') {
      const perTerm = (plan.subjectTotal || 200) / Math.max(1, cardTerms.length)
      const bad = Object.entries(def?.schemes || {}).filter(([, sc]) => Number(sc.theory || 0) + Number(sc.practical || 0) !== perTerm).map(([n]) => n)
      return { ok: bad.length === 0, sum: perTerm, text: `Each subject per term: theory + practical = ${perTerm}`, problem: `these schemes do not add up to ${perTerm}: ${bad.join(', ')}` }
    }
    return { ok: true, text: '' }
  }, [comps, plan, family, def, cardTerms])

  // serialise the editable component list back into the template definition
  function writeComps(d, list) {
    if (family === 'performance_profile') {
      d.components = list.map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: Number(c.rawMax ?? c.max), source: { type: c.kind === 'sheet' ? 'sheet' : 'exam', kind: c.key === 'exam' ? 'TERM' : 'PT', termMap: c.termMap } }))
    } else if (family === 'secondary_annual') {
      d.ia = d.ia || { total: 20, components: [] }
      const ia = list.filter((c) => c.ia)
      d.ia.components = ia.map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: c.rawMax != null ? Number(c.rawMax) : undefined, source: c.kind === 'sheet' ? { type: 'sheet', term: c.termMap?.annual } : { type: 'exam', kind: 'PT', agg: 'avg', terms: c.terms } }))
      d.ia.total = ia.reduce((s, c) => s + Number(c.max || 0), 0)
    }
  }
  const slug = (label) => { const base = String(label || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item'; let k = base, n = 2; while (comps.some((c) => c.key === k)) k = `${base}${n++}`; return k }
  function addComp() {
    const label = prompt('Name of the new component as it should print on the card (e.g. Notebook):')
    if (!label || !label.trim()) return
    const key = slug(label.trim())
    const c = family === 'secondary_annual'
      ? { key, label: label.trim(), max: 5, rawMax: 5, kind: 'sheet', ia: true, termMap: { annual: 'AN' } }
      : { key, label: label.trim(), max: 5, rawMax: 5, kind: 'sheet', termMap: Object.fromEntries(cardTerms.map((t) => [t.key, t.key])) }
    // keep the term exam last
    const list = [...comps]; const examIdx = list.findIndex((x) => x.key === 'exam')
    if (examIdx >= 0) list.splice(examIdx, 0, c); else list.push(c)
    upd((d) => writeComps(d, list))
  }
  function removeComp(key) {
    const c = comps.find((x) => x.key === key)
    if (!c || key === 'exam') return
    if (!confirm(`Remove "${c.label}" from the card?\n\nIts generated papers (and any marks in them) are NOT deleted — they simply stop counting. Empty ones can be deleted in the Papers stage.`)) return
    upd((d) => writeComps(d, comps.filter((x) => x.key !== key)))
  }

  function setComp(key, patch) {
    upd((d) => {
      if (family === 'performance_profile') {
        d.components = comps.map((c) => c.key === key ? { ...c, ...patch } : c).map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: Number(c.rawMax), source: { type: c.kind === 'sheet' ? 'sheet' : 'exam', kind: c.key === 'exam' ? 'TERM' : 'PT', termMap: c.termMap } }))
      } else if (family === 'secondary_annual') {
        d.ia = d.ia || { total: 20, components: [] }
        const list = comps.filter((c) => c.ia).map((c) => c.key === key ? { ...c, ...patch } : c)
        d.ia.components = list.map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: c.rawMax != null ? Number(c.rawMax) : undefined, source: c.kind === 'sheet' ? { type: 'sheet', term: c.termMap?.annual } : { type: 'exam', kind: 'PT', agg: 'avg', terms: c.terms } }))
        d.ia.total = list.reduce((s, c) => s + Number(c.max || 0), 0)
        if (key === 'exam') { d.annualExam = { ...(d.annualExam || {}), total: Number(patch.max ?? d.annualExam?.total ?? 80), term: patch.termMap?.annual || d.annualExam?.term || 'AN' } }
      }
    })
  }
  function setCardTermExam(ctKey, examCode) {
    upd((d) => {
      if (family === 'senior_progress' || family === 'pre_primary') d.terms = cardTerms.map((t) => t.key === ctKey ? { key: t.key, label: t.label, examTerm: examCode } : { key: t.key, label: t.label, examTerm: t.examTerm })
    })
  }

  // ── rows ──────────────────────────────────────────────────────────────────
  const rows = def?.classRows?.[className] || []
  const mappedRows = data?.rows || []
  function setRow(i, patch) { upd((d) => { d.classRows = d.classRows || {}; d.classRows[className] = (d.classRows[className] || []).map((r, j) => j === i ? { ...r, ...patch } : r) }) }
  function addRow() { upd((d) => { d.classRows = d.classRows || {}; d.classRows[className] = [...(d.classRows[className] || []), family === 'secondary_annual' ? { subject: 'NEW SUBJECT', locCode: '', written: 80, practical: 0 } : family === 'pre_primary' ? { subject: 'NEW SUBJECT', oral: 40, written: 60 } : { subject: 'NEW SUBJECT' }] }) }
  function removeRow(i) { upd((d) => { d.classRows[className] = d.classRows[className].filter((_, j) => j !== i) }) }
  function moveRow(i, dir) { upd((d) => { const a = d.classRows[className]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]] }) }
  // ── copy this class's rows to other classes on the same template ──────────
  // Rows live on the template (shared by both branches, per session), and sources are subject
  // NAMES, so a copy is branch-independent: each class then matches its own subjects by name.
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTo, setCopyTo] = useState([])
  const copyTargets = useMemo(() => sharedClasses.filter((c) => c !== className).sort(compareClasses), [sharedClasses, className])
  function copyRows() {
    if (!copyTo.length) return
    const isSenior = family === 'senior_progress'
    const what = isSenior ? `${coreOrder.length} core + ${optionalOrder.length} optional` : `${rows.length} row${rows.length === 1 ? '' : 's'}`
    if (!confirm(`Copy ${className}'s ${what} to ${copyTo.join(', ')}?\n\nThis REPLACES the rows those classes have now (marks are not touched). Both branches follow the same rows. Save rules afterwards, then re-sync papers for each class.`)) return
    upd((d) => {
      for (const cls of copyTo) {
        if (isSenior) {
          d.coreOrder = d.coreOrder || {}; d.coreOrder[cls] = [...coreOrder]
          d.optionalOrder = d.optionalOrder || {}; d.optionalOrder[cls] = [...optionalOrder]
        } else {
          d.classRows = d.classRows || {}; d.classRows[cls] = JSON.parse(JSON.stringify(rows))
        }
      }
    })
    setCopyOpen(false); setCopyTo([])
    setFlash(`Rows copied to ${copyTo.join(', ')} — not saved yet. Click Save rules.`)
  }
  // ── copy the component rules to other templates of the same family ─────────
  // Components are template-wide, so the targets are the OTHER templates of this family
  // (e.g. Classes I–V → Classes VI–VIII), each written directly with reportTemplateApi.save.
  const [copyCompOpen, setCopyCompOpen] = useState(false)
  const [copyCompTo, setCopyCompTo] = useState([])
  const compTargets = useMemo(() => (config?.templates || []).filter((t) => t.family === family && t.id !== data?.template?.id).map((t) => ({ id: t.id, name: t.name, classes: Object.entries(config?.classMap || {}).filter(([, id]) => id === t.id).map(([c]) => c).sort(compareClasses) })), [config, family, data])
  async function copyComponents() {
    if (!copyCompTo.length || !def) return
    const names = compTargets.filter((t) => copyCompTo.includes(t.id)).map((t) => `${t.name} (${t.classes.join(', ') || 'no classes'})`)
    const what = family === 'secondary_annual' ? 'internal-assessment components and annual-exam rule' : `${comps.length} components (max marks, exam terms, scaling)`
    if (!confirm(`Copy ${data?.template?.name}'s ${what} to:\n\n${names.join('\n')}\n\nThis REPLACES their component rules and saves immediately (their card rows are untouched). Re-sync papers for their classes afterwards.`)) return
    setBusy(true); setErr('')
    try {
      const { templates } = await reportTemplateApi.list(sessionCode)   // fresh copies — merge only the component keys
      for (const id of copyCompTo) {
        const t = templates.find((x) => x.id === id); if (!t) continue
        const next = { ...(t.definition || {}) }
        if (family === 'secondary_annual') { next.ia = JSON.parse(JSON.stringify(def.ia || { total: 0, components: [] })); next.annualExam = JSON.parse(JSON.stringify(def.annualExam || {})) }
        else { next.components = JSON.parse(JSON.stringify(def.components || [])); if (def.terms) next.terms = JSON.parse(JSON.stringify(def.terms)) }
        await reportTemplateApi.save(id, { definition: next })
      }
      setCopyCompOpen(false); setCopyCompTo([])
      setFlash(`Components copied to ${names.length} template${names.length === 1 ? '' : 's'}. Re-sync papers for their classes.`)
      await refreshConfig()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const copyCompPanel = compTargets.length > 0 && (
    <div style={{ position: 'relative' }}>
      <Btn small onClick={() => setCopyCompOpen((o) => !o)} disabled={dirty} title={dirty ? 'Save rules first — the copy uses the saved rules' : 'Copy these component rules to another template of the same family'}>Copy components to…</Btn>
      {copyCompOpen && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 12, minWidth: 300 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Copy components to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {compTargets.map((t) => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={copyCompTo.includes(t.id)} onChange={(e) => setCopyCompTo((l) => e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id))} style={{ marginTop: 2 }} />
                <span>{t.name}<span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{t.classes.join(', ') || 'no classes bound'}</span></span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0' }}>Replaces their component rules and saves at once. Rows stay as they are. Both branches.</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Btn small onClick={() => { setCopyCompOpen(false); setCopyCompTo([]) }}>Cancel</Btn>
            <Btn small kind="primary" onClick={copyComponents} disabled={!copyCompTo.length || busy}>{busy ? 'Copying…' : 'Copy'}</Btn>
          </div>
        </div>
      )}
    </div>
  )
  const copyPanel = copyTargets.length > 0 && (
    <div style={{ position: 'relative' }}>
      <Btn small onClick={() => setCopyOpen((o) => !o)} title="Copy this class's card rows to other classes on the same template">Copy rows to…</Btn>
      {copyOpen && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 12, minWidth: 240 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Copy {className}'s rows to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {copyTargets.map((c) => (
              <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={copyTo.includes(c)} onChange={(e) => setCopyTo((l) => e.target.checked ? [...l, c] : l.filter((x) => x !== c))} />{c}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0' }}>Replaces their current rows. Applies to both branches.</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Btn small onClick={() => setCopyTo(copyTo.length === copyTargets.length ? [] : copyTargets)}>{copyTo.length === copyTargets.length ? 'None' : 'All'}</Btn>
            <Btn small onClick={() => { setCopyOpen(false); setCopyTo([]) }}>Cancel</Btn>
            <Btn small kind="primary" onClick={copyRows} disabled={!copyTo.length}>Copy</Btn>
          </div>
        </div>
      )}
    </div>
  )
  const schemes = def?.schemes || {}
  const coreOrder = def?.coreOrder?.[className] || []
  // Senior classes: core list + optional list per class; each name has a scheme (theory/practical per term)
  const DEFAULT_OPTIONALS = /Commerce$/.test(className) ? ['PHYSICAL EDUCATION', 'COMPUTER SCIENCE', 'HINDI CORE', 'MATHEMATICS'] : ['PHYSICAL EDUCATION', 'COMPUTER SCIENCE', 'HINDI CORE']
  const optionalOrder = def?.optionalOrder?.[className] || DEFAULT_OPTIONALS
  function setList(which, names) { upd((d) => { d[which] = d[which] || {}; d[which][className] = names }) }
  function addToList(which, current) {
    const name = prompt(`${which === 'coreOrder' ? 'Core' : 'Optional'} subject name as it prints on the card (e.g. HINDI CORE):`)
    const n = (name || '').trim().toUpperCase(); if (!n || current.includes(n)) return
    upd((d) => { d.schemes = d.schemes || {}; if (!d.schemes[n]) d.schemes[n] = { theory: 80, practical: 20 }; d[which] = d[which] || {}; d[which][className] = [...current, n] })
  }
  function moveIn(which, current, i, dir) { const j = i + dir; if (j < 0 || j >= current.length) return; const a = [...current]; [a[i], a[j]] = [a[j], a[i]]; setList(which, a) }
  const seniorRows = (which, current) => current.map((name, i) => {
    const sc = schemes[name] || { theory: 100, practical: 0 }; const m = mappedRows.find((x) => x.subject === name)
    return (
      <tr key={name}>
        <td style={{ ...td, fontWeight: 600 }}>{name}</td>
        <td style={td}><input type="number" value={sc.theory ?? ''} onChange={(e) => upd((d) => { d.schemes = d.schemes || {}; d.schemes[name] = { ...(d.schemes[name] || {}), theory: Number(e.target.value) } })} style={{ ...inp, width: 64 }} /></td>
        <td style={td}><input type="number" value={sc.practical ?? ''} onChange={(e) => upd((d) => { d.schemes = d.schemes || {}; d.schemes[name] = { ...(d.schemes[name] || {}), practical: Number(e.target.value) } })} style={{ ...inp, width: 64 }} /></td>
        <td style={td}>{Number(sc.theory || 0) + Number(sc.practical || 0)}</td>
        <td style={td}>{m ? (m.unmapped ? <Pill tone="red">no subject — create it in Setup</Pill> : <Pill tone="green">{m.mapped.join(', ')}</Pill>) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>save to check</span>}</td>
        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
          <Btn small onClick={() => moveIn(which, current, i, -1)} disabled={i === 0} title="Move up">↑</Btn>{' '}
          <Btn small onClick={() => moveIn(which, current, i, 1)} disabled={i === current.length - 1} title="Move down">↓</Btn>{' '}
          <Btn small kind="danger" onClick={() => setList(which, current.filter((_, j) => j !== i))} title="Remove from this class">✕</Btn>
        </td>
      </tr>
    )
  })
  const unusedSchemes = Object.keys(schemes).filter((n) => !coreOrder.includes(n) && !optionalOrder.includes(n))
  // which class subject feeds which row (explicit sources win over the auto match)
  const claimedBy = useMemo(() => {
    const m = {}
    rows.forEach((r, i) => { const m2 = mappedRows.find((x) => x.subject === r.subject); for (const s of (r.sources || m2?.mapped || [])) (m[s] ||= []).push(i) })
    return m
  }, [rows, mappedRows])
  const unusedSubjects = useMemo(() => classSubjects.filter((s) => !claimedBy[s]), [classSubjects, claimedBy])

  // ── card areas (co-scholastic, graded subjects, discipline) ──
  const [savedOnce, setSavedOnce] = useState(false)
  async function save() {
    setBusy(true); setErr('')
    try {
      await reportTemplateApi.save(data.template.id, { definition: def })
      setFlash('Rules saved.'); setSavedOnce(true)
      await refreshConfig(); load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  async function resync() {
    setBusy(true); setErr('')
    try {
      const r = await examApi.generatePapers(branch, sessionCode, className)
      const per = r.perClass?.[className] || {}
      setFlash(`Papers re-synced for ${className}: ${per.created || 0} created, ${per.adopted || 0} adopted, ${per.existing || 0} already in place.`)
      setSavedOnce(false); await refreshConfig()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (busy && !data) return <Spinner />
  if (!data?.template) return (
    <div style={card}>
      <Note tone="red">{className} has no report-card template bound. Bind one in <b>Setup</b> first.</Note>
      <Btn onClick={() => setStage('setup')}>← Setup</Btn>
    </div>
  )

  const unmapped = mappedRows.filter((r) => r.unmapped).map((r) => r.subject)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      {flash && <Note tone="green">{flash}{savedOnce && <> Papers follow the rules — <button onClick={resync} disabled={busy} style={{ border: 'none', background: 'none', color: 'var(--green-dark)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0, fontWeight: 600 }}>re-sync papers for {className} now</button> so new rows or max-marks changes take effect.</>}</Note>}

      <div style={{ ...card, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-dark)' }}>{data.template.name} <Pill tone="muted">{family.replace('_', ' ')}</Pill></div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
            Shared by: {sharedClasses.join(', ') || className}. Component rules apply to all of them; rows are per class.
            Rounding: <b>half-up</b> (6.5 → 7, 6.4 → 6).
          </div>
        </div>
        <Btn onClick={load} disabled={busy}>Discard</Btn>
        <Btn kind="primary" onClick={save} disabled={!dirty || busy || (arithmetic.sum > (plan?.subjectTotal || 100) && family !== 'senior_progress')} title={arithmetic.ok ? '' : arithmetic.problem}>{busy ? 'Saving…' : 'Save rules'}</Btn>
      </div>

      {classSubjects.length === 0 ? (
        <Note tone="red"><b>{className} has no scholastic subjects in {branch} yet.</b> Add them in <button onClick={() => setStage('setup')} style={{ border: 'none', background: 'none', color: 'var(--crimson)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>Setup</button> (import from the timetable) — the card rows below will then match automatically.</Note>
      ) : unmapped.length > 0 && <Note tone="gold"><b>{unmapped.join(', ')}</b> — these card rows don't match any subject in {className}. Set their sources below (tick the class subjects that feed the row), or rename the row.</Note>}
      {family !== 'senior_progress' && unusedSubjects.length > 0 && <Note tone="muted">Not on the card (no row uses them): <b>{unusedSubjects.join(', ')}</b>. Fine for activities like ECA or Karate; if one is an examined subject, tick it under a row or add a row.</Note>}

      {/* Components — plain-language rules + arithmetic check */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>How a subject's marks are built{family === 'secondary_annual' ? '' : ' for each term column'}</div>
            {!['senior_progress', 'pre_primary'].includes(family) && <div style={{ display: 'flex', gap: 6 }}>{copyCompPanel}<Btn small onClick={addComp} title="Add a sheet component (Notebook, Activity …) — set its max after adding">+ Component</Btn></div>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
            Read each line left to right: what the teacher enters (raw marks, in which exam term) → what it becomes on the card. Rounding is half-up (6.5 → 7).
          </div>
        </div>
        <div style={{ padding: '6px 14px 2px' }}>
          {comps.map((c) => {
            const badge = c.kind === 'sheet' ? ['muted', 'Sheet', 'A small assessment (portfolio, notebook…) the teacher scores per student in Enter Exam Marks; it has no exam date.']
              : c.agg === 'avg' ? ['green', 'Exam paper · averaged', 'The periodic-test papers of the listed terms are averaged (as %), then scaled to the card marks.']
              : c.split ? ['green', 'Exam paper · theory + practical', 'One paper per term with a theory and a practical part; the split per subject is set in the schemes below.']
              : ['green', 'Exam paper', 'A scheduled paper in the date sheet; the subject teacher enters marks per student out of the raw max.']
            const scaled = !c.split && c.rawMax != null && Number(c.rawMax) !== Number(c.max)
            const fixedCard = c.split || (c.key === 'exam' && family === 'secondary_annual')
            return (
              <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 12, alignItems: 'start', padding: '10px 0', borderBottom: '1px solid var(--gray-50)' }}>
                <div>
                  <input value={c.label} onChange={(e) => setComp(c.key, { label: e.target.value })} disabled={['senior_progress', 'pre_primary'].includes(family)} style={{ ...inp, width: '100%', fontWeight: 600 }} />
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Pill tone={badge[0]} title={badge[2]}>{badge[1]}</Pill>
                    {!['senior_progress', 'pre_primary'].includes(family) && c.key !== 'exam' && <button onClick={() => removeComp(c.key)} title="Remove this component from the card" style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕ remove</button>}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 2.1, color: 'var(--text)' }}>
                  {c.perRow ? (
                    <>One <b>{c.label}</b> paper per subject in each exam; its max is set per subject in the rows below (Oral 40 + Written 60, or Written 100 alone).
                      {cardTerms.map((t) => <span key={t.key} style={{ display: 'inline-block', marginLeft: 10 }}>{t.label} ← <select value={c.termMap?.[t.key] || ''} onChange={(e) => setCardTermExam(t.key, e.target.value)} style={{ ...inp, padding: '2px 6px' }}>{EXAM_CODES.map((x) => <option key={x} value={x}>{x} · {termName(x)}</option>)}</select></span>)}
                    </>
                  ) : c.split ? (
                    <>Office enters theory and practical marks out of the subject's scheme (below); the total goes on the card as is.
                      {cardTerms.map((t) => <span key={t.key} style={{ display: 'inline-block', marginLeft: 10 }}>{t.label} column ← <select value={c.termMap?.[t.key] || ''} onChange={(e) => setCardTermExam(t.key, e.target.value)} style={{ ...inp, padding: '2px 6px' }}>{EXAM_CODES.map((x) => <option key={x} value={x}>{x} · {termName(x)}</option>)}</select></span>)}
                    </>
                  ) : c.agg === 'avg' ? (
                    <>Office enters the periodic test out of <b><input type="number" value={c.rawMax ?? ''} onChange={(e) => setComp(c.key, { rawMax: e.target.value })} style={{ ...inp, width: 60, padding: '2px 6px' }} /></b> in {(c.terms || []).map((t) => <Pill key={t} tone="muted">{t} · {termName(t)}</Pill>)}; the average of those tests becomes <b>/<input type="number" value={c.max ?? ''} onChange={(e) => setComp(c.key, { max: e.target.value })} style={{ ...inp, width: 56, padding: '2px 6px' }} /></b> on the card.</>
                  ) : (
                    <>Office enters marks out of {fixedCard ? <b title="Each row sets its own written + practical max below">the row's written + practical</b> : <b><input type="number" value={c.rawMax ?? ''} onChange={(e) => setComp(c.key, { rawMax: e.target.value })} style={{ ...inp, width: 60, padding: '2px 6px' }} /></b>}
                      {family === 'secondary_annual' ? (
                        <> in <select value={c.termMap?.annual || 'AN'} onChange={(e) => setComp(c.key, { termMap: { annual: e.target.value } })} style={{ ...inp, padding: '2px 6px' }}>{EXAM_CODES.map((x) => <option key={x} value={x}>{x} · {termName(x)}</option>)}</select></>
                      ) : cardTerms.map((t) => (
                        <span key={t.key}> {t.key === cardTerms[0].key ? 'in' : 'and'} <select value={c.termMap?.[t.key] || ''} onChange={(e) => setComp(c.key, { termMap: { ...c.termMap, [t.key]: e.target.value } })} style={{ ...inp, padding: '2px 6px' }}>{EXAM_CODES.map((x) => <option key={x} value={x}>{x} · {termName(x)}</option>)}</select> <span style={{ color: 'var(--text-muted)' }}>for the {t.label} column</span></span>
                      ))}
                      ; {fixedCard ? <>it goes on the card as <b>written + practical</b> from the row (below).</> : <>it {scaled ? 'is scaled to' : 'goes on the card as'} <b>/<input type="number" value={c.max ?? ''} onChange={(e) => setComp(c.key, { max: e.target.value })} style={{ ...inp, width: 56, padding: '2px 6px' }} /></b>{scaled ? ' on the card' : ''}.</>}
                      {scaled && <span style={{ color: 'var(--text-muted)' }}> &nbsp;e.g. {Math.round(Number(c.rawMax) * 0.675)}/{c.rawMax} → {Math.floor(Math.round(Number(c.rawMax) * 0.675) * Number(c.max) / Number(c.rawMax) + 0.5)}/{c.max}</span>}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {/* arithmetic check */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--gray-100)', background: arithmetic.ok ? 'var(--green-light)' : 'var(--crimson-light)', fontSize: 12.5, color: arithmetic.ok ? 'var(--green-dark)' : 'var(--crimson)' }}>
          <b>{arithmetic.text}</b>{!arithmetic.ok && <> — {arithmetic.problem}</>}
          <div style={{ fontSize: 11, marginTop: 2, color: arithmetic.ok ? 'var(--green-dark)' : 'var(--crimson)', opacity: 0.85 }}>
            Composite rows (e.g. SCIENCE = Physics + Chemistry + Biology) add their members' raw marks together first and are then scaled to the same {plan.subjectTotal || 100} — a composite never exceeds a single subject.
          </div>
        </div>
      </div>

      {/* Rows */}
      {family !== 'senior_progress' ? (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Card rows for {className} — and which class subjects feed each</div>
            <div style={{ display: 'flex', gap: 6 }}>{copyPanel}<Btn small onClick={addRow}>+ Row</Btn></div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}></th><th style={th}>Row on card</th>{family === 'secondary_annual' && <><th style={th}>LoC code</th><th style={th}>Written</th><th style={th}>Practical</th><th style={th}>Skill</th><th style={th}>Additional</th></>}{family === 'pre_primary' && <><th style={th}>Oral</th><th style={th}>Written</th></>}<th style={th}>Fed by (class subjects)</th><th style={th}></th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const m = mappedRows.find((x) => x.subject === r.subject)
              const auto = m?.mapped || []
              const chosen = r.sources || null
              return (
                <tr key={i} style={{ background: m?.unmapped ? 'var(--gold-light)' : 'transparent' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><button onClick={() => moveRow(i, -1)} style={arrow}>↑</button><button onClick={() => moveRow(i, 1)} style={arrow}>↓</button></td>
                  <td style={td}><input value={r.subject} onChange={(e) => setRow(i, { subject: e.target.value.toUpperCase() })} style={{ ...inp, width: 190, fontWeight: 600 }} /></td>
                  {family === 'pre_primary' && <>
                    <td style={td}><input type="number" value={r.oral ?? 40} onChange={(e) => setRow(i, { oral: Number(e.target.value) })} style={{ ...inp, width: 60 }} title="0 = no oral paper" /></td>
                    <td style={td}><input type="number" value={r.written ?? 60} onChange={(e) => setRow(i, { written: Number(e.target.value) })} style={{ ...inp, width: 60 }} /></td>
                  </>}
                  {family === 'secondary_annual' && <>
                    <td style={td}><input value={r.locCode || ''} onChange={(e) => setRow(i, { locCode: e.target.value })} style={{ ...inp, width: 56 }} /></td>
                    <td style={td}><input type="number" value={r.written ?? 80} onChange={(e) => setRow(i, { written: Number(e.target.value) })} style={{ ...inp, width: 60 }} /></td>
                    <td style={td}><input type="number" value={r.practical ?? 0} onChange={(e) => setRow(i, { practical: Number(e.target.value) })} style={{ ...inp, width: 60 }} /></td>
                    <td style={td}><input type="checkbox" checked={!!r.skill} onChange={(e) => setRow(i, e.target.checked ? { skill: true, written: r.written ?? 50, practical: r.practical || 50 } : { skill: false })} title="Skill subject (AI, IT …): no internal assessment — one theory + practical paper in the half-yearly exam and one in the annual exam. The card row is the annual exam; the half-yearly prints beside it." /></td>
                    <td style={td}><input type="checkbox" checked={!!r.additional} onChange={(e) => setRow(i, { additional: e.target.checked, countsInAggregate: !e.target.checked })} title="Not counted in the grand total" /></td>
                  </>}
                  <td style={td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {classSubjects.map((s) => {
                        const on = chosen ? chosen.includes(s) : auto.includes(s)
                        const elsewhere = !on && (claimedBy[s] || []).some((j) => j !== i)
                        return <button key={s} onClick={() => { const cur = chosen || auto; setRow(i, { sources: on ? cur.filter((x) => x !== s) : [...cur, s] }) }}
                          title={elsewhere ? `already feeds ${rows[claimedBy[s][0]]?.subject}` : ''}
                          style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10.5, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--green)' : 'var(--gray-200)'), background: on ? 'var(--green)' : 'var(--white)', color: on ? 'white' : 'var(--text-muted)', opacity: elsewhere ? 0.4 : 1 }}>{s}</button>
                      })}
                    </div>
                    {chosen && <button onClick={() => setRow(i, { sources: undefined })} style={{ ...arrow, fontSize: 10, marginTop: 3 }}>reset to auto</button>}
                    {(chosen || auto).length > 1 && <div style={{ fontSize: 10.5, color: 'var(--green-dark)', marginTop: 3 }}>Composite: {(chosen || auto).join(' + ')} — raw marks are added together, then scaled to /{plan.subjectTotal || 100} like any single subject.</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}><Btn small kind="danger" onClick={() => removeRow(i)}>✕</Btn></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Card rows for {className} — core subjects, in print order</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Theory / practical max per term. Science path from SMS drops Biology (PCM) or Mathematics (PCB) for that student.</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>{copyPanel}<Btn small onClick={() => addToList('coreOrder', coreOrder)}>+ Core subject</Btn></div>
          </div>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Subject</th><th style={th}>Theory</th><th style={th}>Practical</th><th style={th}>Total / term</th><th style={th}>Matches class subject</th><th style={th}></th></tr></thead>
            <tbody>{seniorRows('coreOrder', coreOrder)}{coreOrder.length === 0 && <tr><td colSpan={6} style={{ ...td, color: 'var(--text-muted)' }}>No core subjects yet — add them.</td></tr>}</tbody>
          </table></div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderTop: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Optional subjects — one per student</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Each student's pick comes from their SMS record (Optional subject). A student's card prints the core plus that one row; other optionals stay off it.</div>
            </div>
            <Btn small onClick={() => addToList('optionalOrder', optionalOrder)}>+ Optional subject</Btn>
          </div>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{seniorRows('optionalOrder', optionalOrder)}{optionalOrder.length === 0 && <tr><td colSpan={6} style={{ ...td, color: 'var(--text-muted)' }}>No optional subjects for this class.</td></tr>}</tbody>
          </table></div>
          {unusedSchemes.length > 0 && <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--text-muted)' }}>Schemes on this template not used by {className}: {unusedSchemes.join(' · ')} — add one above to put it on this class's card.</div>}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={() => setStage('papers')}>Papers →</Btn>
      </div>
    </div>
  )
}

const arrow = { border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 3px', fontSize: 12 }
const termName = (c) => ({ T1: 'Term 1 (PT-1)', HY: 'Half Yearly', T2: 'Term 2 (PT-2)', AN: 'Annual' }[c] || c)
