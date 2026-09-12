import React, { useState, useEffect, useMemo, useRef } from 'react'
import { examApi } from '../../lib/api'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'
import CardEntries from '../CardEntries'
import StatusStage from './StatusStage.jsx'

/* Stage 4 — Marks (office-only entry, Tracker-driven).
     Class grid   one term, every student × every paper of every subject
     Card entries co-scholastic grades, discipline, remarks (class-teacher pack, entered by the office)
     Progress     the completeness matrix
   Writes go through POST /api/exam/marks with source='manual'. */

const isAB = (v) => ['AB', 'A'].includes(String(v ?? '').trim().toUpperCase())
const numOrNull = (v) => (v === '' || v == null || isAB(v) ? null : Number(v))
const COMP = { pt: 'PT', portfolio: 'Portfolio', se: 'Sub. Enr.', notebook: 'Notebook', exam: 'Exam', oral: 'Oral', written: 'Written' }

// ── Entry sheets (for marking on paper, then typing in) ──
function sheetHead(groups) { return groups.flatMap((g) => g.papers.map((p) => `${g.subject.name} · ${COMP[p.componentKey] || p.name} /${p.hasPractical ? `${p.theoryMax}+${p.practicalMax}` : p.max}`)) }
function sheetRows(data, groups, vals, withMarks) {
  return data.students.map((s) => [s.roll || '', s.name, s.admissionNo || '', ...groups.flatMap((g) => g.papers.map((p) => {
    if (data.applicable && !(data.applicable[s.id] || []).includes(p.subjectId)) return 'n/a'
    if (!withMarks) return ''
    const c = vals[`${s.id}|${p.id}`] || {}
    return p.hasPractical ? [c.th, c.pr].filter((x) => x !== '' && x != null).join(' + ') : (c.v ?? '')
  }))])
}
function loadImage(src) {
  return new Promise((resolve) => { const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; cv.getContext('2d').drawImage(img, 0, 0); resolve({ data: cv.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight }) }; img.onerror = () => resolve(null); img.src = src })
}
async function exportSheetPDF({ data, groups, vals, withMarks, meta }) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const [banner, crest] = await Promise.all([loadImage('/banner-light.png'), loadImage('/crest.png')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 8
  if (banner) { const bw = 56, bh = (banner.h / banner.w) * bw; if (crest) { const ch = 11, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) } doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh); y += bh + 2 }
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(26, 74, 46); doc.text(`MARKS ENTRY SHEET — ${(meta.term || '').toUpperCase()}`, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90); doc.text(`${meta.className}${meta.section ? ' - ' + meta.section : ''}  ·  ${meta.branch} branch  ·  Session ${meta.session}  ·  ${withMarks ? 'current entries' : 'blank — enter raw marks, AB for absent'}`, pageW / 2, y + 8.5, { align: 'center' }); y += 12
  autoTable(doc, { startY: y, head: [['Roll', 'Student', 'Adm no.', ...sheetHead(groups)]], body: sheetRows(data, groups, vals, withMarks), margin: { left: 6, right: 6 }, styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.4, halign: 'center', minCellHeight: 6.5 }, headStyles: { fillColor: [26, 74, 46], textColor: 255, fontSize: 6.5 }, alternateRowStyles: { fillColor: [246, 250, 247] }, columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 44, halign: 'left' }, 2: { cellWidth: 14 } } })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(150); doc.text(`Printed ${new Date().toLocaleDateString('en-IN')} · ${data.students.length} students · Teacher signature: ____________________`, 6, doc.internal.pageSize.getHeight() - 5); doc.text(`Page ${p} of ${pages}`, pageW - 6, doc.internal.pageSize.getHeight() - 5, { align: 'right' }) }
  doc.save(`marks-sheet-${meta.branch}-${meta.className.replace(/\s+/g, '-')}${meta.section ? '-' + meta.section : ''}-${(meta.term || '').replace(/\s+/g, '-')}${withMarks ? '' : '-blank'}.pdf`)
}
async function exportSheetXLSX({ data, groups, vals, withMarks, meta }) {
  const XLSX = await import('xlsx')
  const head = ['Roll', 'Student', 'Adm no.', ...sheetHead(groups)]
  const ws = XLSX.utils.aoa_to_sheet([[`Radhakrishna Academy — Marks entry sheet`], [`${meta.term} · ${meta.className}${meta.section ? ' - ' + meta.section : ''} · ${meta.branch} branch · Session ${meta.session}`], [], head, ...sheetRows(data, groups, vals, withMarks)])
  ws['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 10 }, ...groups.flatMap((g) => g.papers.map(() => ({ wch: 16 })))]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, meta.className.slice(0, 25)); XLSX.writeFile(wb, `marks-sheet-${meta.branch}-${meta.className.replace(/\s+/g, '-')}${meta.section ? '-' + meta.section : ''}-${(meta.term || '').replace(/\s+/g, '-')}${withMarks ? '' : '-blank'}.xlsx`)
}

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
      const v = {}
      const byKey = new Map(d.marks.map((m) => [`${m.student_id}|${m.paper_id}`, m]))
      for (const s of d.students) for (const p of d.papers) {
        const m = byKey.get(`${s.id}|${p.id}`)
        v[`${s.id}|${p.id}`] = { v: m ? (m.is_absent ? 'AB' : (m.marks_obtained == null ? '' : String(Number(m.marks_obtained)))) : '', th: m?.theory_obtained == null ? '' : String(Number(m.theory_obtained)), pr: m?.practical_obtained == null ? '' : String(Number(m.practical_obtained)), src: m?.source || null }
      }
      setVals(v); setDirty(new Set())
    }).catch((e) => setErr(e.message)).finally(() => setBusy(''))
  }
  useEffect(load, [branch, sessionCode, className, termId, section]) // eslint-disable-line

  const papers = useMemo(() => (data?.papers || []).filter((p) => !only || p.componentKey === only), [data, only])
  const groups = useMemo(() => {
    const g = []
    for (const p of papers) { const s = (data?.subjects || []).find((x) => x.id === p.subjectId); const last = g[g.length - 1]; if (last && last.subject.id === p.subjectId) last.papers.push(p); else g.push({ subject: s, papers: [p] }) }
    return g
  }, [papers, data])
  const compKeys = useMemo(() => [...new Set((data?.papers || []).map((p) => p.componentKey))], [data])
  const sections = useMemo(() => [...new Set((data?.students || []).map((s) => s.section).filter(Boolean))].sort(), [data])

  function clamp(v, max) { if (v === '' || isAB(v)) return isAB(v) ? 'AB' : ''; const n = Number(v); if (Number.isNaN(n)) return ''; return String(Math.min(Math.max(n, 0), max > 0 ? max : Infinity)) }
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
          {data && papers.length > 0 && (() => {
            const meta = { term: data.term?.name, className, section, branch, session: sessionCode }
            const args = (withMarks) => ({ data, groups, vals, withMarks, meta })
            return (<>
              <Btn onClick={() => exportSheetPDF(args(false))} title="Student list with empty boxes for every paper of this term — for marking on paper">Blank sheet (PDF)</Btn>
              <Btn onClick={() => exportSheetXLSX(args(false))} title="Same list as an Excel file">Blank sheet (Excel)</Btn>
              <Btn onClick={() => exportSheetPDF(args(true))} title="Current entries, for checking against the answer sheets">With marks (PDF)</Btn>
            </>)
          })()}
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
                                <input data-cell={`${ri}:${ci}`} value={c.th} placeholder="Th" onKeyDown={(e) => onKey(e, ri, ci)} onChange={(e) => set(s.id, p, { th: clamp(e.target.value, p.theoryMax) })} style={{ ...cellStyle, width: 46, color: isAB(c.th) ? 'var(--crimson)' : 'var(--text)', fontWeight: isAB(c.th) ? 700 : 400 }} />
                                <input value={c.pr} placeholder="Pr" disabled={isAB(c.th)} onChange={(e) => set(s.id, p, { pr: clamp(e.target.value, p.practicalMax) })} style={{ ...cellStyle, width: 46 }} />
                              </span>
                            ) : (
                              <input data-cell={`${ri}:${ci}`} value={c.v} onKeyDown={(e) => onKey(e, ri, ci)} onChange={(e) => set(s.id, p, { v: clamp(e.target.value, p.max) })} style={{ ...cellStyle, color: isAB(c.v) ? 'var(--crimson)' : 'var(--text)', fontWeight: isAB(c.v) ? 700 : 400 }} />
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
