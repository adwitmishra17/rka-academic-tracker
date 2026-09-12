import React, { useState, useEffect, useMemo } from 'react'
import { examApi, reportTemplateApi } from '../../lib/api'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'

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
  const plan = data?.plan
  const sharedClasses = useMemo(() => Object.entries(config?.classMap || {}).filter(([, id]) => id === data?.template?.id).map(([c]) => c), [config, data])
  const classSubjects = data?.subjects || []
  const cardTerms = plan?.cardTerms || []

  function upd(mut) { setDef((d) => { const n = JSON.parse(JSON.stringify(d)); mut(n); return n }); setDirty(true) }

  // ── components (performance_profile) ──────────────────────────────────────
  const comps = useMemo(() => {
    if (!def || !plan) return []
    if (family === 'performance_profile') {
      // ensure def.components carries everything the plan derived (defaults materialised so edits stick)
      return plan.components.map((c) => ({ key: c.key, label: c.label, max: c.max, rawMax: c.rawMax, kind: c.kind, termMap: c.termMap }))
    }
    if (family === 'secondary_annual') return plan.components
    return plan.components
  }, [def, plan, family])

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
      d.components = list.map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: Number(c.rawMax ?? c.max), source: { type: c.kind === 'sheet' ? 'sheet' : c.kind === 'monthlyAvg' ? 'monthlyAvg' : 'exam', kind: c.key === 'exam' ? 'TERM' : 'PT', termMap: c.termMap } }))
    } else if (family === 'secondary_annual') {
      d.ia = d.ia || { total: 20, components: [] }
      const ia = list.filter((c) => c.ia)
      d.ia.components = ia.map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: c.rawMax != null ? Number(c.rawMax) : undefined, source: c.kind === 'monthlyAvg' ? { type: 'monthlyAvg' } : c.kind === 'sheet' ? { type: 'sheet', term: c.termMap?.annual } : { type: 'exam', kind: 'PT', agg: 'avg', terms: c.terms } }))
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
        d.components = comps.map((c) => c.key === key ? { ...c, ...patch } : c).map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: Number(c.rawMax), source: { type: c.kind === 'sheet' ? 'sheet' : c.kind === 'monthlyAvg' ? 'monthlyAvg' : 'exam', kind: c.key === 'exam' ? 'TERM' : 'PT', termMap: c.termMap } }))
      } else if (family === 'secondary_annual') {
        d.ia = d.ia || { total: 20, components: [] }
        const list = comps.filter((c) => c.ia).map((c) => c.key === key ? { ...c, ...patch } : c)
        d.ia.components = list.map((c) => ({ key: c.key, label: c.label, max: Number(c.max), rawMax: c.rawMax != null ? Number(c.rawMax) : undefined, source: c.kind === 'monthlyAvg' ? { type: 'monthlyAvg' } : c.kind === 'sheet' ? { type: 'sheet', term: c.termMap?.annual } : { type: 'exam', kind: 'PT', agg: 'avg', terms: c.terms } }))
        d.ia.total = list.reduce((s, c) => s + Number(c.max || 0), 0)
        if (key === 'exam') { d.annualExam = { ...(d.annualExam || {}), total: Number(patch.max ?? d.annualExam?.total ?? 80), term: patch.termMap?.annual || d.annualExam?.term || 'AN' } }
      }
    })
  }
  function setCardTermExam(ctKey, examCode) {
    upd((d) => {
      if (family === 'senior_progress') d.terms = cardTerms.map((t) => t.key === ctKey ? { ...t, examTerm: examCode } : { key: t.key, label: t.label, examTerm: t.examTerm })
    })
  }

  // ── rows ──────────────────────────────────────────────────────────────────
  const rows = def?.classRows?.[className] || []
  const mappedRows = data?.rows || []
  function setRow(i, patch) { upd((d) => { d.classRows = d.classRows || {}; d.classRows[className] = (d.classRows[className] || []).map((r, j) => j === i ? { ...r, ...patch } : r) }) }
  function addRow() { upd((d) => { d.classRows = d.classRows || {}; d.classRows[className] = [...(d.classRows[className] || []), family === 'secondary_annual' ? { subject: 'NEW SUBJECT', locCode: '', written: 80, practical: 0 } : { subject: 'NEW SUBJECT' }] }) }
  function removeRow(i) { upd((d) => { d.classRows[className] = d.classRows[className].filter((_, j) => j !== i) }) }
  function moveRow(i, dir) { upd((d) => { const a = d.classRows[className]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]] }) }
  const schemes = def?.schemes || {}
  const coreOrder = def?.coreOrder?.[className] || []
  // which class subject feeds which row (explicit sources win over the auto match)
  const claimedBy = useMemo(() => {
    const m = {}
    rows.forEach((r, i) => { const m2 = mappedRows.find((x) => x.subject === r.subject); for (const s of (r.sources || m2?.mapped || [])) (m[s] ||= []).push(i) })
    return m
  }, [rows, mappedRows])
  const unusedSubjects = useMemo(() => classSubjects.filter((s) => !claimedBy[s]), [classSubjects, claimedBy])

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
            {family !== 'senior_progress' && <Btn small onClick={addComp} title="Add a sheet component (Notebook, Activity …) — set its max after adding">+ Component</Btn>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
            Read each line left to right: what the teacher enters (raw marks, in which exam term) → what it becomes on the card. Rounding is half-up (6.5 → 7).
          </div>
        </div>
        <div style={{ padding: '6px 14px 2px' }}>
          {comps.map((c) => {
            const badge = c.kind === 'monthlyAvg' ? ['gold', 'Monthly-test average', 'Taken automatically from Tests & Marks (monthly tests) — nothing to enter here.']
              : c.kind === 'sheet' ? ['muted', 'Sheet', 'A small assessment (portfolio, notebook…) the teacher scores per student in Enter Exam Marks; it has no exam date.']
              : c.agg === 'avg' ? ['green', 'Exam paper · averaged', 'The periodic-test papers of the listed terms are averaged (as %), then scaled to the card marks.']
              : c.split ? ['green', 'Exam paper · theory + practical', 'One paper per term with a theory and a practical part; the split per subject is set in the schemes below.']
              : ['green', 'Exam paper', 'A scheduled paper in the date sheet; the subject teacher enters marks per student out of the raw max.']
            const scaled = c.kind !== 'monthlyAvg' && !c.split && c.rawMax != null && Number(c.rawMax) !== Number(c.max)
            const fixedCard = c.split || (c.key === 'exam' && family === 'secondary_annual')
            return (
              <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 12, alignItems: 'start', padding: '10px 0', borderBottom: '1px solid var(--gray-50)' }}>
                <div>
                  <input value={c.label} onChange={(e) => setComp(c.key, { label: e.target.value })} disabled={family === 'senior_progress'} style={{ ...inp, width: '100%', fontWeight: 600 }} />
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Pill tone={badge[0]} title={badge[2]}>{badge[1]}</Pill>
                    {family !== 'senior_progress' && c.key !== 'exam' && <button onClick={() => removeComp(c.key)} title="Remove this component from the card" style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕ remove</button>}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 2.1, color: 'var(--text)' }}>
                  {c.kind === 'monthlyAvg' ? (
                    <>Average % of the class's monthly tests for the subject, scaled to <b>/<input type="number" value={c.max ?? ''} onChange={(e) => setComp(c.key, { max: e.target.value })} style={{ ...inp, width: 56, padding: '2px 6px' }} /></b> on the card. Nothing to enter.</>
                  ) : c.split ? (
                    <>Teacher enters theory and practical marks out of the subject's scheme (below); the total goes on the card as is.
                      {cardTerms.map((t) => <span key={t.key} style={{ display: 'inline-block', marginLeft: 10 }}>{t.label} column ← <select value={c.termMap?.[t.key] || ''} onChange={(e) => setCardTermExam(t.key, e.target.value)} style={{ ...inp, padding: '2px 6px' }}>{EXAM_CODES.map((x) => <option key={x} value={x}>{x} · {termName(x)}</option>)}</select></span>)}
                    </>
                  ) : c.agg === 'avg' ? (
                    <>Teacher enters the periodic test out of <b><input type="number" value={c.rawMax ?? ''} onChange={(e) => setComp(c.key, { rawMax: e.target.value })} style={{ ...inp, width: 60, padding: '2px 6px' }} /></b> in {(c.terms || []).map((t) => <Pill key={t} tone="muted">{t} · {termName(t)}</Pill>)}; the average of those tests becomes <b>/<input type="number" value={c.max ?? ''} onChange={(e) => setComp(c.key, { max: e.target.value })} style={{ ...inp, width: 56, padding: '2px 6px' }} /></b> on the card.</>
                  ) : (
                    <>Teacher enters marks out of <b><input type="number" value={c.rawMax ?? ''} onChange={(e) => setComp(c.key, { rawMax: e.target.value })} style={{ ...inp, width: 60, padding: '2px 6px' }} /></b>
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
            <Btn small onClick={addRow}>+ Row</Btn>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}></th><th style={th}>Row on card</th>{family === 'secondary_annual' && <><th style={th}>LoC code</th><th style={th}>Written</th><th style={th}>Practical</th><th style={th}>Additional</th></>}<th style={th}>Fed by (class subjects)</th><th style={th}></th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const m = mappedRows.find((x) => x.subject === r.subject)
              const auto = m?.mapped || []
              const chosen = r.sources || null
              return (
                <tr key={i} style={{ background: m?.unmapped ? 'var(--gold-light)' : 'transparent' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><button onClick={() => moveRow(i, -1)} style={arrow}>↑</button><button onClick={() => moveRow(i, 1)} style={arrow}>↓</button></td>
                  <td style={td}><input value={r.subject} onChange={(e) => setRow(i, { subject: e.target.value.toUpperCase() })} style={{ ...inp, width: 190, fontWeight: 600 }} /></td>
                  {family === 'secondary_annual' && <>
                    <td style={td}><input value={r.locCode || ''} onChange={(e) => setRow(i, { locCode: e.target.value })} style={{ ...inp, width: 56 }} /></td>
                    <td style={td}><input type="number" value={r.written ?? 80} onChange={(e) => setRow(i, { written: Number(e.target.value) })} style={{ ...inp, width: 60 }} /></td>
                    <td style={td}><input type="number" value={r.practical ?? 0} onChange={(e) => setRow(i, { practical: Number(e.target.value) })} style={{ ...inp, width: 60 }} /></td>
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
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', fontSize: 13, fontWeight: 600 }}>Subject schemes (theory / practical max per term) · rows resolve per student from stream + optional subject</div>
          <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--text-muted)' }}>Core order for {className}: {coreOrder.join(' · ') || '—'} (edit in Card Designer). Science path PCM drops Biology, PCB drops Mathematics.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Subject</th><th style={th}>Theory</th><th style={th}>Practical</th><th style={th}>Total / term</th><th style={th}>Matches class subject</th></tr></thead>
            <tbody>{Object.entries(schemes).map(([name, sc]) => {
              const m = mappedRows.find((x) => x.subject === name)
              return (
                <tr key={name}>
                  <td style={{ ...td, fontWeight: 600 }}>{name}</td>
                  <td style={td}><input type="number" value={sc.theory ?? ''} onChange={(e) => upd((d) => { d.schemes[name].theory = Number(e.target.value) })} style={{ ...inp, width: 64 }} /></td>
                  <td style={td}><input type="number" value={sc.practical ?? ''} onChange={(e) => upd((d) => { d.schemes[name].practical = Number(e.target.value) })} style={{ ...inp, width: 64 }} /></td>
                  <td style={td}>{Number(sc.theory || 0) + Number(sc.practical || 0)}</td>
                  <td style={td}>{m ? (m.unmapped ? <Pill tone="red">no subject</Pill> : <Pill tone="green">{m.mapped.join(', ')}</Pill>) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>not in this class's core</span>}</td>
                </tr>
              )
            })}</tbody>
          </table>
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
