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
  function setRow(i, patch) { upd((d) => { d.classRows = d.classRows || {}; d.classRows[className] = (d.classRows[className] || []).map((r, j) => j === i ? { ...r, ...patch } : r) }) }
  function addRow() { upd((d) => { d.classRows = d.classRows || {}; d.classRows[className] = [...(d.classRows[className] || []), family === 'secondary_annual' ? { subject: 'NEW SUBJECT', locCode: '', written: 80, practical: 0 } : { subject: 'NEW SUBJECT' }] }) }
  function removeRow(i) { upd((d) => { d.classRows[className] = d.classRows[className].filter((_, j) => j !== i) }) }
  function moveRow(i, dir) { upd((d) => { const a = d.classRows[className]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]] }) }
  const schemes = def?.schemes || {}
  const coreOrder = def?.coreOrder?.[className] || []

  async function save() {
    setBusy(true); setErr('')
    try {
      await reportTemplateApi.save(data.template.id, { definition: def })
      setFlash('Rules saved — regenerate papers if max marks or term mapping changed'); setTimeout(() => setFlash(''), 4000)
      await refreshConfig(); load()
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

  const mappedRows = data.rows || []
  const unmapped = mappedRows.filter((r) => r.unmapped).map((r) => r.subject)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      {flash && <Note tone="green">{flash}</Note>}

      <div style={{ ...card, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-dark)' }}>{data.template.name} <Pill tone="muted">{family.replace('_', ' ')}</Pill></div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
            Shared by: {sharedClasses.join(', ') || className}. Component rules apply to all of them; rows are per class.
            Rounding: <b>half-up</b> (6.5 → 7, 6.4 → 6).
          </div>
        </div>
        <Btn onClick={load} disabled={busy}>Discard</Btn>
        <Btn kind="primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save rules'}</Btn>
      </div>

      {unmapped.length > 0 && <Note tone="gold"><b>{unmapped.join(', ')}</b> — these card rows don't match any subject in {className}. Set their sources below (tick the class subjects that feed the row), or rename the row.</Note>}

      {/* Card terms + components */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', fontSize: 13, fontWeight: 600 }}>Components — what makes a subject's marks on the card</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Component</th><th style={th}>Source</th><th style={th}>Raw paper max</th><th style={th}>On the card</th>
            {family === 'secondary_annual' ? <th style={th}>Paper term(s)</th> : cardTerms.map((t) => <th key={t.key} style={th}>{t.label} ← exam term</th>)}
          </tr></thead>
          <tbody>
            {comps.map((c) => (
              <tr key={c.key}>
                <td style={{ ...td, fontWeight: 600 }}>
                  <input value={c.label} onChange={(e) => setComp(c.key, { label: e.target.value })} style={{ ...inp, width: 170 }} disabled={family === 'senior_progress'} />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>key: {c.key}</div>
                </td>
                <td style={td}>
                  <Pill tone={c.kind === 'monthlyAvg' ? 'gold' : c.kind === 'sheet' ? 'muted' : 'green'}>{c.kind === 'monthlyAvg' ? 'monthly-test average' : c.kind === 'sheet' ? 'sheet (office/teacher enters)' : c.agg === 'avg' ? 'exam paper · average of PTs' : c.split ? 'exam paper · theory + practical' : 'exam paper'}</Pill>
                </td>
                <td style={td}>{c.kind === 'monthlyAvg' || c.split ? <span style={{ color: 'var(--text-muted)' }}>{c.split ? 'per subject scheme' : '% of each test'}</span> : c.key === 'exam' && family === 'secondary_annual' ? <span style={{ color: 'var(--text-muted)' }}>per row (written + practical)</span> : <input type="number" value={c.rawMax ?? ''} onChange={(e) => setComp(c.key, { rawMax: e.target.value })} style={{ ...inp, width: 70 }} />}</td>
                <td style={td}>{c.split ? <span style={{ color: 'var(--text-muted)' }}>theory + practical</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>/<input type="number" value={c.max ?? ''} onChange={(e) => setComp(c.key, { max: e.target.value })} style={{ ...inp, width: 64 }} disabled={c.key === 'exam' && family === 'secondary_annual'} /></span>}</td>
                {family === 'secondary_annual' ? (
                  <td style={td}>{c.agg === 'avg' ? <span>{(c.terms || []).map((t) => <Pill key={t} tone="muted">{t}</Pill>)} <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>averaged</span></span> : c.kind === 'monthlyAvg' ? <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Tests &amp; Marks (monthly)</span> : (
                    <select value={c.termMap?.annual || 'AN'} onChange={(e) => setComp(c.key, { termMap: { annual: e.target.value } })} style={inp}>{EXAM_CODES.map((x) => <option key={x}>{x}</option>)}</select>
                  )}</td>
                ) : cardTerms.map((t) => (
                  <td key={t.key} style={td}>
                    {c.kind === 'monthlyAvg' ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                      <select value={c.termMap?.[t.key] || ''} onChange={(e) => family === 'senior_progress' ? setCardTermExam(t.key, e.target.value) : setComp(c.key, { termMap: { ...c.termMap, [t.key]: e.target.value } })} style={inp}>
                        {EXAM_CODES.map((x) => <option key={x} value={x}>{x} · {termName(x)}</option>)}
                      </select>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--gray-100)' }}>
          A component's paper is entered against its exam term at the raw max (e.g. PA-1 /40 under Term 1) and lands on the card scaled to "on the card" (…/10). Periodic tests: T1 feeds the Half-Yearly card column, T2 feeds the Annual one.
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
                        return <button key={s} onClick={() => { const cur = chosen || auto; setRow(i, { sources: on ? cur.filter((x) => x !== s) : [...cur, s] }) }}
                          style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10.5, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--green)' : 'var(--gray-200)'), background: on ? 'var(--green)' : 'var(--white)', color: on ? 'white' : 'var(--text-muted)' }}>{s}</button>
                      })}
                    </div>
                    {chosen && <button onClick={() => setRow(i, { sources: undefined })} style={{ ...arrow, fontSize: 10, marginTop: 3 }}>reset to auto</button>}
                    {!chosen && auto.length > 1 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>composite — papers of all ticked subjects are summed, then scaled</div>}
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
