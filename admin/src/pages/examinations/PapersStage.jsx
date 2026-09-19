import React, { useState, useEffect, useMemo } from 'react'
import { examApi } from '../../lib/api'
import { card, th, td, Btn, Note, Spinner } from './ui.jsx'

/* Stage 3 — Papers. One typed paper per (subject, exam term, component),
   generated from the scoring rules. Read-only overview: which papers exist
   and how far marks entry has got on each. Nothing to edit here — maxes come
   from the rules, marks are entered in Marks entry. Leftover papers (off the
   card, or pre-rules free text) are listed separately and can be deleted. */


export default function PapersStage({ branch, sessionCode, className, refreshConfig, setStage }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')

  const load = () => {
    setBusy('load'); setErr('')
    examApi.classPapers(branch, sessionCode, className).then(setData).catch((e) => setErr(e.message)).finally(() => setBusy(''))
  }
  useEffect(load, [branch, sessionCode, className]) // eslint-disable-line

  async function generate(all) {
    setBusy('gen'); setErr('')
    try {
      const r = await examApi.generatePapers(branch, sessionCode, all ? undefined : className)
      const skipped = r.skipped?.length ? ` · skipped: ${r.skipped.map((s) => `${s.className} (${s.reason})`).join(', ')}` : ''
      const kept = all ? [] : (r.perClass?.[className]?.leftoverKept || [])
      setFlash(`Created ${r.created}, adopted ${r.adopted} existing papers, ${r.existing} already in place${r.removed ? `, ${r.removed} stale empty paper${r.removed === 1 ? '' : 's'} removed` : ''}${r.leftoverRemoved ? `, ${r.leftoverRemoved} empty leftover paper${r.leftoverRemoved === 1 ? '' : 's'} removed` : ''}${r.renamed ? `, ${r.renamed} renamed to the rule's name` : ''}${kept.length ? ` · kept ${kept.length} leftover${kept.length === 1 ? '' : 's'} with marks` : ''}${skipped}`)
      setTimeout(() => setFlash(''), 8000)
      await refreshConfig(); load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }
  async function del(p) {
    const s = (data?.subjects || []).find((x) => x.id === p.subject_id)
    const msg = p.marks
      ? `Delete "${p.paper_name}" (${s?.subject_name || ''}) AND its ${p.marks} entered mark${p.marks === 1 ? '' : 's'}?\n\nThis cannot be undone. Nothing on the card uses this paper.`
      : `Delete "${p.paper_name}" (${s?.subject_name || ''})? It has no marks.`
    if (!confirm(msg)) return
    setBusy(p.id)
    try { await examApi.deletePaper(p.id, !!p.marks); load() } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const terms = data?.terms || []
  const roster = data?.roster || 0
  const termOf = useMemo(() => Object.fromEntries(terms.map((t) => [t.id, t])), [terms])
  const onCardIds = data?.onCard ? new Set(data.onCard) : null
  const subjects = (data?.subjects || []).filter((s) => (s.kind || 'scholastic') === 'scholastic').filter((s) => !onCardIds || onCardIds.has(s.id))
  const typed = (data?.papers || []).filter((p) => p.component_key && (!onCardIds || onCardIds.has(p.subject_id)))
  const leftover = (data?.papers || []).filter((p) => !p.component_key || (onCardIds && !onCardIds.has(p.subject_id)))
  const leftoverWithMarks = leftover.filter((p) => p.marks > 0).length
  // only terms that have at least one paper get a column
  const cols = terms.filter((t) => typed.some((p) => p.term_id === t.id))
  const done = typed.filter((p) => roster && p.marks >= roster).length
  const started = typed.filter((p) => p.marks > 0 && (!roster || p.marks < roster)).length

  if (busy === 'load' && !data) return <Spinner />

  const chip = (p) => {
    const pct = roster ? Math.min(100, Math.round(100 * p.marks / roster)) : 0
    const tone = !p.marks ? 'none' : pct >= 100 ? 'done' : 'part'
    const colour = tone === 'done' ? 'var(--green)' : tone === 'part' ? 'var(--gold-dark)' : 'var(--gray-300)'
    const max = p.has_practical ? `${Number(p.theory_max)}+${Number(p.practical_max)}` : `/${Number(p.max_marks)}`
    const notOnCard = Number(p.card_max) === 0
    return (
      <div key={p.id} title={`${p.paper_name} · raw max ${Number(p.max_marks)}${notOnCard ? ' · recorded only, not on the card' : p.card_max != null && Number(p.card_max) !== Number(p.max_marks) ? ` → /${Number(p.card_max)} on the card` : ''}\n${p.marks} of ${roster} students entered`}
        style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, background: 'var(--gray-50)', fontSize: 12 }}>
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.paper_name} <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{max}</span>{notOnCard && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> · not on card</span>}</span>
        <span style={{ height: 5, borderRadius: 3, background: 'var(--gray-100)', overflow: 'hidden', minWidth: 40 }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: colour }} /></span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: tone === 'done' ? 'var(--green-dark)' : tone === 'part' ? 'var(--gold-dark)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.marks}<span style={{ color: 'var(--text-muted)' }}>/{roster}</span></span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      {flash && <Note tone="green">{flash}</Note>}

      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-dark)' }}>Papers · {className}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
            {data?.template ? <>Template: <b>{data.template.name}</b> · {typed.length} papers · {roster} students · <span style={{ color: 'var(--green-dark)' }}>{done} fully entered</span>{started ? <>, {started} in progress</> : null}{leftover.length ? <> · {leftover.length} leftover{leftoverWithMarks ? ` (${leftoverWithMarks} with marks)` : ''}</> : null}</> : <span style={{ color: 'var(--crimson)' }}>No template bound — bind one in Setup.</span>}
          </div>
        </div>
        <Btn onClick={() => generate(true)} disabled={!!busy} title="Every class with a template, this branch + session">Generate for all classes</Btn>
        <Btn kind="primary" onClick={() => generate(false)} disabled={!!busy || !data?.template}>{busy === 'gen' ? 'Generating…' : typed.length ? 'Re-sync with rules' : 'Generate papers from rules'}</Btn>
      </div>

      {!terms.length && <Note tone="red">No terms for {branch} · {sessionCode}. Initialise them in Setup first.</Note>}

      {data?.template && typed.length === 0 && terms.length > 0 && (
        <Note tone="gold">Nothing generated yet. Generating creates one paper per subject × term × component from the scoring rules, and <b>adopts</b> any existing free-text paper in the same slot (the one carrying the most marks wins), so entered marks are never lost.</Note>
      )}

      {typed.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>On the card · {subjects.length} subject{subjects.length === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Exactly what the scoring rules generate. Each bar is how many students have marks; maxes come from the rules, marks are entered under Marks entry.</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              <span><i style={{ display: 'inline-block', width: 10, height: 5, borderRadius: 3, background: 'var(--green)', marginRight: 4 }} />complete</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 5, borderRadius: 3, background: 'var(--gold-dark)', marginRight: 4 }} />in progress</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 5, borderRadius: 3, background: 'var(--gray-300)', marginRight: 4 }} />not started</span>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr><th style={{ ...th, width: 170 }}>Subject</th>{cols.map((t) => <th key={t.id} style={th}>{t.name} <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>({t.short_code})</span></th>)}</tr></thead>
            <tbody>{subjects.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{s.subject_name}<div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 400 }}>{s.assigned_teacher_name || s.assigned_teacher_email || '— no teacher —'}</div></td>
                {cols.map((t) => {
                  const ps = typed.filter((p) => p.subject_id === s.id && p.term_id === t.id).sort((a, b) => (a.component_key === 'exam') - (b.component_key === 'exam') || a.paper_name.localeCompare(b.paper_name))
                  return <td key={t.id} style={{ ...td, verticalAlign: 'top' }}>{ps.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{ps.map(chip)}</div> : <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>—</span>}</td>
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {leftover.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Leftover papers — not on the card · {leftover.length}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>Papers of subjects no card row uses (e.g. Physics when the card row is Science) and free-text papers from before the rules. The card and the crosslists ignore them. A re-sync deletes the empty ones; ones with marks stay until you delete them here — that removes the marks too.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {leftover.map((p) => {
              const s = (data?.subjects || []).find((x) => x.id === p.subject_id)
              return (
                <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--gray-200)', borderRadius: 99, padding: '3px 10px', fontSize: 11.5 }}>
                  <b>{s?.subject_name}</b> · {termOf[p.term_id]?.short_code} · {p.paper_name} /{Number(p.max_marks)} · <span style={{ color: p.marks ? 'var(--green)' : 'var(--text-muted)' }}>{p.marks} marks</span>
                  <button onClick={() => del(p)} disabled={busy === p.id} title={p.marks ? `Delete this paper and its ${p.marks} marks` : 'Delete (no marks)'} style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 11 }}>✕</button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={() => setStage('rules')}>← Rules</Btn>
        <Btn onClick={() => setStage('status')}>Marks entry →</Btn>
      </div>
    </div>
  )
}
