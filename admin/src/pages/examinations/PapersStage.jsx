import React, { useState, useEffect, useMemo } from 'react'
import { examApi } from '../../lib/api'
import { inp, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'

/* Stage 3 — Papers. One typed paper per (subject, exam term, component),
   generated from the scoring rules. The office sets dates here (date
   sheet); teachers pick from these in the PWA and never name papers.
   Legacy free-text papers (pre-rules) are listed for cleanup. */

export default function PapersStage({ branch, sessionCode, className, refreshConfig, setStage }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [edit, setEdit] = useState({})   // paperId → { examDate, maxMarks, passingMarks }

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
      setFlash(`Created ${r.created}, adopted ${r.adopted} existing papers, ${r.existing} already in place${skipped}`)
      setTimeout(() => setFlash(''), 6000)
      await refreshConfig(); load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }
  async function savePaper(p) {
    const d = edit[p.id]; if (!d) return
    setBusy(p.id)
    try {
      const patch = {}
      if (d.examDate !== undefined) patch.examDate = d.examDate
      if (d.passingMarks !== undefined) patch.passingMarks = d.passingMarks
      if (d.maxMarks !== undefined && !p.marks) patch.maxMarks = Number(d.maxMarks)
      await examApi.savePaper(p.id, patch)
      setEdit((x) => { const n = { ...x }; delete n[p.id]; return n }); load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }
  async function del(p) {
    if (!confirm(`Delete "${p.paper_name}"? Only possible while it has no marks.`)) return
    setBusy(p.id)
    try { await examApi.deletePaper(p.id); load() } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const terms = data?.terms || []
  const termOf = useMemo(() => Object.fromEntries(terms.map((t) => [t.id, t])), [terms])
  const subjects = (data?.subjects || []).filter((s) => (s.kind || 'scholastic') === 'scholastic')
  const typed = (data?.papers || []).filter((p) => p.component_key)
  const legacy = (data?.papers || []).filter((p) => !p.component_key)
  const byTermCode = useMemo(() => {
    const codes = terms.map((t) => t.short_code)
    return { codes, cols: codes.map((c) => ({ code: c, name: terms.find((t) => t.short_code === c)?.name })) }
  }, [terms])

  if (busy === 'load' && !data) return <Spinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      {flash && <Note tone="green">{flash}</Note>}

      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-dark)' }}>Papers · {className}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
            {data?.template ? <>Template: <b>{data.template.name}</b> · {typed.length} typed papers{legacy.length ? ` · ${legacy.length} legacy` : ''}</> : <span style={{ color: 'var(--crimson)' }}>No template bound — bind one in Setup.</span>}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={th}>Subject</th>{byTermCode.cols.map((c) => <th key={c.code} style={th}>{c.name} <span style={{ fontWeight: 500 }}>({c.code})</span></th>)}</tr></thead>
            <tbody>{subjects.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.subject_name}<div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 400 }}>{s.assigned_teacher_name || s.assigned_teacher_email || '— no teacher —'}</div></td>
                {byTermCode.cols.map((c) => {
                  const ps = typed.filter((p) => p.subject_id === s.id && termOf[p.term_id]?.short_code === c.code)
                  return (
                    <td key={c.code} style={{ ...td, verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {ps.map((p) => {
                          const e = edit[p.id]
                          return (
                            <div key={p.id} style={{ border: '1px solid var(--gray-100)', borderRadius: 10, padding: '5px 8px', background: e ? 'var(--gold-light)' : 'var(--gray-50)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Pill tone={p.component_key === 'exam' ? 'green' : p.component_key === 'pt' ? 'ink' : 'muted'}>{p.component_key}</Pill>
                                <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{p.paper_name}</span>
                                <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }} title="raw max → on the card">/{Number(p.max_marks)} → /{p.card_max != null ? Number(p.card_max) : Number(p.max_marks)}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                <input type="date" value={e?.examDate !== undefined ? e.examDate : (p.exam_date || '')} onChange={(ev) => setEdit((x) => ({ ...x, [p.id]: { ...x[p.id], examDate: ev.target.value } }))} style={{ ...inp, padding: '3px 6px', fontSize: 11 }} />
                                {!p.marks && <input type="number" title="raw max (editable until marks exist)" value={e?.maxMarks !== undefined ? e.maxMarks : Number(p.max_marks)} onChange={(ev) => setEdit((x) => ({ ...x, [p.id]: { ...x[p.id], maxMarks: ev.target.value } }))} style={{ ...inp, padding: '3px 6px', fontSize: 11, width: 56 }} />}
                                <span style={{ fontSize: 10.5, color: p.marks ? 'var(--green)' : 'var(--text-muted)' }}>{p.marks} marks</span>
                                {e ? <Btn small kind="primary" onClick={() => savePaper(p)} disabled={busy === p.id}>Save</Btn> : (!p.marks && <button onClick={() => del(p)} title="Delete (no marks)" style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 11 }}>✕</button>)}
                              </div>
                            </div>
                          )
                        })}
                        {!ps.length && <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {legacy.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Legacy papers (free-text, not on any card) · {legacy.length}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>Left over from before typed papers. Ones with marks are kept for reference (still visible in the raw crosslist); empty ones can be deleted.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {legacy.map((p) => {
              const s = (data?.subjects || []).find((x) => x.id === p.subject_id)
              return (
                <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--gray-200)', borderRadius: 99, padding: '3px 10px', fontSize: 11.5 }}>
                  <b>{s?.subject_name}</b> · {termOf[p.term_id]?.short_code} · {p.paper_name} /{Number(p.max_marks)} · <span style={{ color: p.marks ? 'var(--green)' : 'var(--text-muted)' }}>{p.marks} marks</span>
                  {!p.marks && <button onClick={() => del(p)} style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 11 }}>✕</button>}
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
