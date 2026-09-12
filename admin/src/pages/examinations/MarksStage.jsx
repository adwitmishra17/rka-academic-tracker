import React, { useState, useEffect, useMemo, useRef } from 'react'
import { examApi } from '../../lib/api'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'
import CardEntries from '../CardEntries'
import StatusStage from './StatusStage.jsx'
import { isAB, COMP, valsFromGrid, groupsOf } from './entrySheets.js'

/* Stage 4 — Marks (office-only entry, Tracker-driven).
     Class grid   one term, every student × every paper of every subject
     Card entries co-scholastic grades, discipline, remarks (class-teacher pack, entered by the office)
     Progress     the completeness matrix
   Writes go through POST /api/exam/marks with source='manual'. */

const numOrNull = (v) => (v === '' || v == null || isAB(v) ? null : Number(v))

export default function MarksStage(props) {
  const [tab, setTab] = useState('grid')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'inline-flex', border: '1px solid var(--gray-200)', borderRadius: 99, overflow: 'hidden', alignSelf: 'flex-start', background: 'var(--white)' }}>
        {[['grid', 'Class grid'], ['card', 'Card entries'], ['progress', 'Progress']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 16px', border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: tab === k ? 'var(--text)' : 'transparent', color: tab === k ? 'var(--white)' : 'var(--text-muted)' }}>{l}</button>
        ))}
      </div>
      {tab === 'grid' && <ClassGrid {...props} />}
      {tab === 'card' && <CardEntriesTab {...props} />}
      {tab === 'progress' && <StatusStage {...props} />}
    </div>
  )
}

function CardEntriesTab({ branch, sessionCode, className, config }) {
  const terms = config?.terms || []
  const [termId, setTermId] = useState('')
  useEffect(() => { if (!termId && terms.length) setTermId(terms[0].id) }, [terms]) // eslint-disable-line
  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--gray-100)' }}>
        <div><span style={lbl}>Term</span><select value={termId} onChange={(e) => setTermId(e.target.value)} style={inp}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', paddingBottom: 8 }}>Co-scholastic area grades, discipline and remarks are per term; achievement, height and weight are per session.</div>
      </div>
      {termId && <CardEntries key={termId} embedded ctx={{ branch, sessionCode, className, termId }} />}
    </div>
  )
}

function ClassGrid({ branch, sessionCode, className, config }) {
  const terms = config?.terms || []
  const [termId, setTermId] = useState('')
  const [section, setSection] = useState('')
  const [only, setOnly] = useState('')          // component filter
  const [data, setData] = useState(null)
  const [vals, setVals] = useState({})           // `${sid}|${pid}` → { v, th, pr }
  const [dirty, setDirty] = useState(new Set())
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const gridRef = useRef(null)
  useEffect(() => { if (!termId && terms.length) setTermId(terms[0].id) }, [terms]) // eslint-disable-line

  const load = () => {
    if (!termId) return
    setBusy('load'); setErr('')
    examApi.classGrid(branch, sessionCode, className, termId, section || undefined).then((d) => {
      setData(d)
      setVals(valsFromGrid(d)); setDirty(new Set())
    }).catch((e) => setErr(e.message)).finally(() => setBusy(''))
  }
  useEffect(load, [branch, sessionCode, className, termId, section]) // eslint-disable-line

  const papers = useMemo(() => (data?.papers || []).filter((p) => !only || p.componentKey === only), [data, only])
  const groups = useMemo(() => groupsOf(data, papers), [papers, data])
  const compKeys = useMemo(() => [...new Set((data?.papers || []).map((p) => p.componentKey))], [data])
  const sections = useMemo(() => [...new Set((data?.students || []).map((s) => s.section).filter(Boolean))].sort(), [data])

  // Keep what is being typed: "A" is a half-typed "AB", so leave it (blur turns it into AB); anything starting AB is AB.
  function clamp(v, max) {
    const t = String(v ?? '').trim().toUpperCase()
    if (t === '') return ''
    if (t === 'A') return 'A'
    if (t.startsWith('AB')) return 'AB'
    const n = Number(t); if (Number.isNaN(n)) return ''
    return String(Math.min(Math.max(n, 0), max > 0 ? max : Infinity))
  }
  const tidyAB = (v) => (isAB(v) ? 'AB' : v)
  function set(sid, p, patch) {
    const k = `${sid}|${p.id}`
    setVals((x) => ({ ...x, [k]: { ...x[k], ...patch } })); setDirty((d) => new Set([...d, k]))
  }
  // Enter / arrows move down the column like a spreadsheet
  function onKey(e, rowIdx, colIdx) {
    const next = e.key === 'Enter' || e.key === 'ArrowDown' ? [rowIdx + 1, colIdx] : e.key === 'ArrowUp' ? [rowIdx - 1, colIdx] : null
    if (!next) return
    e.preventDefault()
    const el = gridRef.current?.querySelector(`[data-cell="${next[0]}:${next[1]}"]`); if (el) { el.focus(); el.select?.() }
  }
  function markAbsent(sid, on) {
    for (const p of papers) { const k = `${sid}|${p.id}`; const cur = vals[k] || {}; if (on && cur.v === '' && cur.th === '') set(sid, p, p.hasPractical ? { th: 'AB' } : { v: 'AB' }); if (!on && (isAB(cur.v) || isAB(cur.th))) set(sid, p, { v: '', th: '' }) }
  }
  async function save() {
    if (!dirty.size) return
    setBusy('save'); setErr('')
    try {
      const rows = []
      for (const k of dirty) {
        const [sid, pid] = k.split('|'); const p = data.papers.find((x) => x.id === pid); const c = vals[k]
        if (p.hasPractical) rows.push({ paperId: pid, studentId: sid, isAbsent: isAB(c.th), theoryObtained: numOrNull(c.th), practicalObtained: numOrNull(c.pr) })
        else rows.push({ paperId: pid, studentId: sid, isAbsent: isAB(c.v), marksObtained: numOrNull(c.v) })
      }
      const { saved } = await examApi.saveMarks(rows)
      setVals((x) => { const n = { ...x }; for (const k of dirty) n[k] = { ...n[k], src: 'manual' }; return n })
      setDirty(new Set()); setFlash(`Saved ${saved} entries`); setTimeout(() => setFlash(''), 2500)
    } catch (e) { setErr('Save failed: ' + (e.message || e)) }
    setBusy('')
  }

  const cellStyle = { ...inp, width: 58, textAlign: 'center', padding: '5px 4px', fontSize: 12.5 }
  let colIdx = 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {err && <Note tone="red">{err}</Note>}
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><span style={lbl}>Term</span><select value={termId} onChange={(e) => setTermId(e.target.value)} style={inp}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        {sections.length > 1 && <div><span style={lbl}>Section</span><select value={section} onChange={(e) => setSection(e.target.value)} style={inp}><option value="">All</option>{sections.map((s) => <option key={s}>{s}</option>)}</select></div>}
        {compKeys.length > 1 && <div><span style={lbl}>Show</span><select value={only} onChange={(e) => setOnly(e.target.value)} style={inp}><option value="">All papers</option>{compKeys.map((k) => <option key={k} value={k}>{COMP[k] || k} only</option>)}</select></div>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {flash && <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>{flash}</span>}
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Entry sheets (blank / with marks) are under <b>Crosslist</b>.</span>
          <Btn kind="primary" onClick={save} disabled={busy === 'save' || dirty.size === 0}>{busy === 'save' ? 'Saving…' : `Save ${dirty.size ? dirty.size + ' change' + (dirty.size === 1 ? '' : 's') : ''}`}</Btn>
        </div>
      </div>

      {busy === 'load' && !data ? <Spinner /> : data && (
        papers.length === 0 ? <Note tone="gold">No papers for {data.term?.name} yet — generate them in <b>Papers</b>.</Note> : (
          <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: '70vh' }} ref={gridRef}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 420 + papers.length * 70 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                <tr>
                  <th style={{ ...th, position: 'sticky', left: 0, zIndex: 4, background: 'var(--gray-50)' }} rowSpan={2}>Roll · Student</th>
                  {groups.map((g) => <th key={g.subject.id} colSpan={g.papers.length} style={{ ...th, textAlign: 'center', borderLeft: '1px solid var(--gray-200)' }} title={g.subject.teacher ? `Subject teacher: ${g.subject.teacher}` : ''}>{g.subject.name}</th>)}
                  <th style={{ ...th, textAlign: 'center' }} rowSpan={2}>Absent<br /><span style={{ fontWeight: 400 }}>all</span></th>
                </tr>
                <tr>
                  {groups.flatMap((g) => g.papers.map((p, i) => (
                    <th key={p.id} style={{ ...th, textAlign: 'center', fontSize: 9.5, borderLeft: i === 0 ? '1px solid var(--gray-200)' : 'none', whiteSpace: 'nowrap' }} title={`${p.name} · entered /${p.max}${p.cardMax != null && p.cardMax !== p.max ? ` → /${p.cardMax} on the card` : ''}`}>
                      {COMP[p.componentKey] || p.name}<br /><span style={{ fontWeight: 500 }}>{p.hasPractical ? `${p.theoryMax}+${p.practicalMax}` : `/${p.max}`}</span>
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {data.students.map((s, ri) => {
                  const allAbs = papers.length > 0 && papers.every((p) => { const c = vals[`${s.id}|${p.id}`] || {}; return p.hasPractical ? isAB(c.th) : isAB(c.v) })
                  colIdx = 0
                  return (
                    <tr key={s.id} style={{ background: allAbs ? 'var(--crimson-light)' : ri % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                      <td style={{ ...td, position: 'sticky', left: 0, zIndex: 2, background: 'inherit', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 6 }}>{s.roll || '—'}</span>{s.name}{!section && s.section ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {s.section}</span> : null}
                      </td>
                      {groups.flatMap((g) => g.papers.map((p, i) => {
                        const k = `${s.id}|${p.id}`; const c = vals[k] || { v: '', th: '', pr: '' }
                        const isDirty = dirty.has(k); const ci = colIdx++
                        const bg = isDirty ? 'var(--gold-light)' : 'transparent'
                        if (data.applicable && !(data.applicable[s.id] || []).includes(p.subjectId)) {
                          return <td key={p.id} style={{ ...td, padding: 3, textAlign: 'center', borderLeft: i === 0 ? '1px solid var(--gray-100)' : 'none', color: 'var(--gray-400)', fontSize: 11 }} title="Not this student's subject (set in SMS: optional subject / science path)">n/a</td>
                        }
                        return (
                          <td key={p.id} style={{ ...td, padding: 3, textAlign: 'center', borderLeft: i === 0 ? '1px solid var(--gray-100)' : 'none', background: bg }} title={c.src ? `entered by ${c.src === 'manual' ? 'office' : 'teacher'}` : ''}>
                            {p.hasPractical ? (
                              <span style={{ display: 'inline-flex', gap: 3 }}>
                                <input data-cell={`${ri}:${ci}`} value={c.th} placeholder="Th" onKeyDown={(e) => onKey(e, ri, ci)} onChange={(e) => set(s.id, p, { th: clamp(e.target.value, p.theoryMax) })} onBlur={(e) => { if (e.target.value !== tidyAB(e.target.value)) set(s.id, p, { th: 'AB' }) }} style={{ ...cellStyle, width: 46, color: isAB(c.th) ? 'var(--crimson)' : 'var(--text)', fontWeight: isAB(c.th) ? 700 : 400 }} />
                                <input value={c.pr} placeholder="Pr" disabled={isAB(c.th)} onChange={(e) => set(s.id, p, { pr: clamp(e.target.value, p.practicalMax) })} style={{ ...cellStyle, width: 46 }} />
                              </span>
                            ) : (
                              <input data-cell={`${ri}:${ci}`} value={c.v} onKeyDown={(e) => onKey(e, ri, ci)} onChange={(e) => set(s.id, p, { v: clamp(e.target.value, p.max) })} onBlur={(e) => { if (e.target.value !== tidyAB(e.target.value)) set(s.id, p, { v: 'AB' }) }} style={{ ...cellStyle, color: isAB(c.v) ? 'var(--crimson)' : 'var(--text)', fontWeight: isAB(c.v) ? 700 : 400 }} />
                            )}
                          </td>
                        )
                      }))}
                      <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={allAbs} onChange={(e) => markAbsent(s.id, e.target.checked)} style={{ accentColor: 'var(--crimson)' }} title="Fills AB into this student's empty boxes" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {data?.hiddenSubjects?.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Not on the card, so not entered here: {data.hiddenSubjects.join(', ')}.</div>}
      {data?.applicable && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Cells marked <b>n/a</b> are subjects that student does not take — the optional subject and PCM / PCB path come from the student's SMS record.</div>}
      {data && papers.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          Type the raw marks as on the answer sheet (the card scales them). <b>AB</b> = absent for that paper. Enter or ↓ moves down the column. Changed cells turn gold until saved. {data.students.length} students · {papers.length} papers.
        </div>
      )}
    </div>
  )
}
