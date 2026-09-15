import React, { useState, useEffect, useMemo } from 'react'
import { examApi, cardEntriesApi } from '../../lib/api'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'
import { COMP, valsFromGrid, groupsOf, exportSheetPDF, exportSheetXLSX, loadImage } from './entrySheets.js'

/* Stage 5 — Crosslist. Two views of the same class:
     · Raw   — one exam term, every paper summed per subject (as entered)
     · Card  — one card (T1 / Final / Annual / HY …), the engine's normalised
               subject totals + rank, exactly what will print
     · Sheets — marks ENTRY sheets for one term (blank, for marking on paper;
               or with the current entries, for checking)
   Exports: branded landscape PDF + XLSX. */

const cellText = (c) => (!c || !c.entered ? '—' : c.absent ? 'AB' : String(c.obtained))

/* Printer-friendly: black text, thin black grid, pale header band. Several tables → one document,
   one table per page (used by the subject-wise crosslist). */
async function exportPDF({ title, subtitle, head, body, fileName, tables }) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const [banner, crest] = await Promise.all([loadImage('/banner-light.png', 480), loadImage('/crest.png', 96)])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  const list = tables || [{ title, subtitle, head, body }]
  list.forEach((t, idx) => {
    if (idx > 0) doc.addPage()
    let y = 10
    if (banner) { const bw = 62, bh = (banner.h / banner.w) * bw; if (crest) { const ch = 12, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) } doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh); y += bh + 2 }
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0); doc.text(t.title, pageW / 2, y + 4, { align: 'center' })
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(0); doc.text(t.subtitle, pageW / 2, y + 9, { align: 'center' }); y += 13
    autoTable(doc, { startY: y, head: [t.head], body: t.body, margin: { left: 8, right: 8 }, theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.6, halign: 'center', textColor: 0, lineColor: 0, lineWidth: 0.2 },
      headStyles: { fillColor: [232, 232, 232], textColor: 0, fontStyle: 'bold', fontSize: 8.5, lineColor: 0, lineWidth: 0.3 },
      alternateRowStyles: { fillColor: 255 }, columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 46, halign: 'left' }, ...(t.columnStyles || {}) } })
  })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0); doc.text(`Generated ${new Date().toLocaleDateString('en-IN')} · AB = absent, — = not entered`, 8, doc.internal.pageSize.getHeight() - 5); doc.text(`Page ${p} of ${pages}`, pageW - 8, doc.internal.pageSize.getHeight() - 5, { align: 'right' }) }
  doc.save(fileName + '.pdf')
}
async function exportXLSX({ title, subtitle, head, body, fileName, sheet, tables }) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const t of (tables || [{ title, subtitle, head, body, sheet }])) {
    const ws = XLSX.utils.aoa_to_sheet([[t.title], [t.subtitle], [], t.head, ...t.body])
    ws['!cols'] = t.head.map((h, i) => ({ wch: i === 1 ? 26 : Math.max(8, Math.min(14, String(h).length + 2)) }))
    XLSX.utils.book_append_sheet(wb, ws, String(t.sheet || sheet).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  }
  XLSX.writeFile(wb, fileName + '.xlsx')
}

export default function CrosslistStage({ branch, sessionCode, className, config }) {
  const [mode, setMode] = useState('card')
  const [subjectId, setSubjectId] = useState('')   // subject-wise view: '' = every subject
  const [termId, setTermId] = useState('')
  const [cardKey, setCardKey] = useState('')
  const [section, setSection] = useState('')
  const [raw, setRaw] = useState(null)
  const [cards, setCards] = useState(null)
  const [grid, setGrid] = useState(null)
  const [pack, setPack] = useState(null)          // graded areas: { students, areas, grades, meta }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const terms = config?.terms || []
  // default to the first term that has typed papers for this class (pre-primary has none under T1/T2)
  const byTerm = config?.paperCounts?.[className]?.byTerm || {}
  const firstWithPapers = terms.find((t) => byTerm[t.id]) || terms[0]
  const termLabel = (t) => `${t.name}${byTerm[t.id] ? '' : ' · no papers'}`
  useEffect(() => { if (!termId && firstWithPapers) setTermId(firstWithPapers.id) }, [terms, config]) // eslint-disable-line

  // ── rules ↔ papers sync gate: nothing downloads while the papers lag the rules ──
  const [sync, setSync] = useState(null)      // { synced, missing[], stale[], changed[] } | null while loading
  const [syncing, setSyncing] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const checkSync = () => examApi.paperSyncStatus(branch, sessionCode, className).then(setSync).catch((e) => setSync({ synced: false, reason: e.message, missing: [], stale: [], changed: [] }))
  useEffect(() => { setSync(null); checkSync() }, [branch, sessionCode, className]) // eslint-disable-line
  const syncIssues = sync && !sync.synced ? [...(sync.reason ? [sync.reason] : []), ...sync.missing.map((m) => `missing: ${m}`), ...sync.changed.map((c) => `max changed: ${c}`), ...sync.stale.map((x) => `no longer in the rules: ${x.label}${x.marks ? ` (${x.marks} marks entered)` : ''}`)] : []
  async function syncNow() {
    setSyncing(true); setErr('')
    try {
      const r = await examApi.generatePapers(branch, sessionCode, className)
      const staleWithMarks = (sync?.stale || []).filter((x) => x.marks > 0)
      const fresh = await examApi.paperSyncStatus(branch, sessionCode, className)
      setSync(fresh); setReloadTick((n) => n + 1)
      if (!fresh.synced && staleWithMarks.length) setErr(`Papers regenerated (${r.created} created, ${r.adopted} adopted), but ${staleWithMarks.length} old paper${staleWithMarks.length === 1 ? '' : 's'} still carr${staleWithMarks.length === 1 ? 'ies' : 'y'} marks and cannot be removed automatically: ${staleWithMarks.map((x) => x.label).join(', ')}. Move or clear those marks in Papers, then sync again.`)
      return fresh.synced
    } catch (e) { setErr(e.message); return false }
    finally { setSyncing(false) }
  }
  /** Runs `download` only when papers match the rules; otherwise asks to sync first. */
  async function guarded(download) {
    let s = sync
    if (!s) { s = await examApi.paperSyncStatus(branch, sessionCode, className).catch(() => null); setSync(s) }
    if (s?.synced) return download()
    const ok = window.confirm(`The scoring rules have changed since the papers were generated, so this download would not match the card.\n\n${syncIssues.slice(0, 6).join('\n')}${syncIssues.length > 6 ? `\n… and ${syncIssues.length - 6} more` : ''}\n\nSync the papers with the rules now?`)
    if (!ok) return
    if (await syncNow()) return download()
  }

  useEffect(() => {
    if (mode === 'card' && cards && cards.cardKey === cardKey && cards._section === section && cards._tick === reloadTick) return // server echoed the default key — no second fetch
    setErr(''); setBusy(true)
    const p = mode === 'raw'
      ? (termId ? examApi.crosslist(branch, termId, className, section || undefined).then(setRaw) : Promise.resolve())
      : mode === 'graded'
        ? (termId ? cardEntriesApi.load(branch, sessionCode, className, termId, section || undefined).then(setPack) : Promise.resolve())
      : mode === 'sheets' || mode === 'subject'
        ? (termId ? examApi.classGrid(branch, sessionCode, className, termId, section || undefined).then(setGrid) : Promise.resolve())
        : examApi.classCards(branch, sessionCode, className, cardKey || undefined, section || undefined).then((d) => { setCards({ ...d, _section: section, _tick: reloadTick }); if (!cardKey) setCardKey(d.cardKey) })
    p.catch((e) => { setErr(e.message); if (mode === 'raw') setRaw(null); else if (mode === 'graded') setPack(null); else if (mode === 'sheets' || mode === 'subject') setGrid(null); else setCards(null) }).finally(() => setBusy(false))
  }, [mode, termId, cardKey, section, branch, sessionCode, className, reloadTick]) // eslint-disable-line

  const sections = useMemo(() => [...new Set(((mode === 'raw' ? raw?.students : mode === 'graded' ? pack?.students : (mode === 'sheets' || mode === 'subject') ? grid?.students : cards?.rows) || []).map((r) => r.section).filter(Boolean))].sort(), [raw, cards, grid, mode])
  const sheetArgs = (withMarks) => grid && { data: grid, groups: groupsOf(grid), vals: valsFromGrid(grid), withMarks, meta: { term: grid.term?.name, className, section, branch, session: sessionCode } }
  const meta = `${className}${section ? ' - ' + section : ''}  ·  ${branch} branch  ·  Session ${sessionCode}`
  const fname = (kind) => `crosslist-${kind}-${branch}-${className.replace(/\s+/g, '-')}${section ? '-' + section : ''}`

  // ── export payloads ──
  const rawExport = raw && {
    title: `MARKS CROSSLIST — ${(raw.term?.name || '').toUpperCase()} (raw)`, subtitle: meta,
    head: ['Roll', 'Student', ...raw.subjects.map((s) => `${s.name} (${s.maxMarks})`), 'Total', '%', 'Rank'],
    body: raw.students.map((r) => [r.rollNumber || '—', r.name, ...raw.subjects.map((s) => cellText(r.marks[s.id])), r.hasAny ? `${r.total}/${r.maxTotal}` : '—', r.percent != null ? r.percent.toFixed(1) : '—', r.rank ?? '—']),
    fileName: fname((raw.term?.name || 'term').replace(/\s+/g, '-')), sheet: className,
  }
  const subjectsInCards = cards ? [...new Set(cards.rows.flatMap((r) => r.subjects.map((s) => s.subject)))] : []
  const cardExport = cards && {
    title: `MARKS CROSSLIST — ${(cards.cardKeys.find((k) => k.key === cards.cardKey)?.label || cards.cardKey).toUpperCase()} (as on card)`, subtitle: meta,
    head: ['Roll', 'Student', ...subjectsInCards, 'Total', '%', 'Grade', 'Rank', 'Complete'],
    body: cards.rows.map((r) => [r.roll || '—', r.name, ...subjectsInCards.map((s) => { const x = r.subjects.find((y) => y.subject === s); return !x || !x.max ? '—' : `${x.obtained}/${x.max}` }), r.overall.max ? `${r.overall.obtained}/${r.overall.max}` : '—', r.overall.pct != null ? r.overall.pct.toFixed(1) : '—', r.overall.grade || '—', r.rank ?? '—', r.ok ? 'yes' : `no (${r.missing.length})`]),
    fileName: fname(cards.cardKey), sheet: className,
  }
  // ── subject-wise: one table per subject, every paper of the term as a column ──
  const subjectTables = useMemo(() => {
    if (!grid) return []
    const byKey = new Map(grid.marks.map((m) => [`${m.student_id}|${m.paper_id}`, m]))
    const cellOf = (s, p) => {
      if (grid.applicable && !(grid.applicable[s.id] || []).includes(p.subjectId)) return 'n/a'
      const m = byKey.get(`${s.id}|${p.id}`); if (!m) return '—'
      if (m.is_absent) return 'AB'
      if (p.hasPractical) return m.theory_obtained == null && m.practical_obtained == null ? '—' : `${Number(m.theory_obtained || 0)} + ${Number(m.practical_obtained || 0)}`
      return m.marks_obtained == null ? '—' : String(Number(m.marks_obtained))
    }
    const numOf = (s, p) => { const m = byKey.get(`${s.id}|${p.id}`); if (!m || m.is_absent) return m?.is_absent ? 0 : null; return p.hasPractical ? Number(m.theory_obtained || 0) + Number(m.practical_obtained || 0) : (m.marks_obtained == null ? null : Number(m.marks_obtained)) }
    return grid.subjects.filter((sub) => !subjectId || sub.id === subjectId).map((sub) => {
      const papers = grid.papers.filter((p) => p.subjectId === sub.id)
      const maxTotal = papers.reduce((a, p) => a + (p.hasPractical ? Number(p.theoryMax || 0) + Number(p.practicalMax || 0) : Number(p.max || 0)), 0)
      const head = ['Roll', 'Student', ...papers.map((p) => `${COMP[p.componentKey] || p.name} /${p.hasPractical ? `${p.theoryMax}+${p.practicalMax}` : p.max}`), `Total /${maxTotal}`]
      const body = grid.students.map((s) => { const vals = papers.map((p) => numOf(s, p)); const any = vals.some((v) => v != null); return [s.roll || '—', s.name, ...papers.map((p) => cellOf(s, p)), any ? String(vals.reduce((a, v) => a + (v || 0), 0)) : '—'] })
      return { subject: sub, papers, title: `SUBJECT CROSSLIST — ${sub.name.toUpperCase()} · ${(grid.term?.name || '').toUpperCase()}`, subtitle: `${meta}${sub.teacher ? '  ·  ' + sub.teacher : ''}`, head, body, sheet: sub.name }
    })
  }, [grid, subjectId, meta])
  const subjectExport = subjectTables.length ? { tables: subjectTables, fileName: fname(`${(grid?.term?.name || 'term').replace(/\s+/g, '-')}-${subjectId ? subjectTables[0].subject.name.replace(/\s+/g, '-') : 'all-subjects'}`), sheet: className } : null

  // ── graded areas (co-scholastic + graded subjects + discipline + remarks): crosslist and blank entry sheet ──
  const tplDef = useMemo(() => (config?.templates || []).find((t) => t.id === config?.classMap?.[className])?.definition || {}, [config, className])
  const termObj = terms.find((t) => t.id === termId)
  const isLastTerm = !!termObj && terms.every((t) => (t.sort_order ?? 0) <= (termObj.sort_order ?? 0))
  const gradedTable = useMemo(() => {
    if (!pack) return null
    const areas = [...(pack.areas || []).filter((a) => a.subject_code === 'RCG'), ...(pack.areas || []).filter((a) => a.subject_code === 'RCA')]
    const scaleOf = (a) => ((a.subject_code === 'RCG' ? tplDef.gradedSubjects?.scale : tplDef.coScholastic?.scale) || ['A', 'B', 'C']).join('/')
    const discScale = (tplDef.discipline?.scale || ['A', 'B', 'C']).join('/')
    const head = ['Roll', 'Student', ...areas.map((a) => `${a.subject_name} (${scaleOf(a)})`), `Discipline (${discScale})`, 'Remarks', ...(isLastTerm ? ['Ht (cm)', 'Wt (kg)'] : [])]
    const rowFor = (s, withGrades) => {
      const g = pack.grades?.[s.id] || {}, m = pack.meta?.[s.id] || {}
      return [s.roll_number || '—', s.full_name, ...areas.map((a) => (withGrades ? (g[a.id] || '') : '')), withGrades ? (m.discipline || '') : '', withGrades ? (m.remarks || '') : '', ...(isLastTerm ? [withGrades ? (m.heightCm ?? '') : '', withGrades ? (m.weightKg ?? '') : ''] : [])]
    }
    const rows = (withGrades) => (pack.students || []).map((s) => rowFor(s, withGrades))
    const n = head.length
    const columnStyles = { [n - (isLastTerm ? 3 : 1)]: { cellWidth: 70, halign: 'left' } }   // Remarks column wide
    const base = (withGrades) => ({ title: `GRADED AREAS — ${(termObj?.name || '').toUpperCase()}${withGrades ? '' : ' · ENTRY SHEET'}`, subtitle: `${meta}  ·  ${withGrades ? 'as entered' : 'blank — write the grade letter in each box'}`, head, body: rows(withGrades), sheet: className, columnStyles })
    return { areas, head, filled: base(true), blank: base(false), entered: (pack.students || []).filter((s) => areas.some((a) => pack.grades?.[s.id]?.[a.id])).length }
  }, [pack, tplDef, isLastTerm, meta, termObj])
  const gradedExport = gradedTable && { ...gradedTable.filled, fileName: fname(`graded-${(termObj?.name || 'term').replace(/\s+/g, '-')}`) }
  const gradedBlank = gradedTable && { ...gradedTable.blank, fileName: fname(`graded-${(termObj?.name || 'term').replace(/\s+/g, '-')}-blank`) }

  const exp = mode === 'raw' ? rawExport : mode === 'subject' ? subjectExport : mode === 'graded' ? gradedExport : cardExport

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><span style={lbl}>View</span>
          <div style={{ display: 'inline-flex', border: '1px solid var(--gray-200)', borderRadius: 99, overflow: 'hidden' }}>
            {[['card', 'As on card'], ['raw', 'Raw per term'], ['subject', 'Subject-wise'], ['graded', 'Graded areas'], ['sheets', 'Entry sheets']].map(([k, l]) => <button key={k} onClick={() => setMode(k)} style={{ padding: '6px 14px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: mode === k ? 'var(--text)' : 'var(--white)', color: mode === k ? 'var(--white)' : 'var(--text-muted)' }}>{l}</button>)}
          </div></div>
        {mode === 'subject' && grid && <div><span style={lbl}>Subject</span><select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={inp}><option value="">All subjects (one page each)</option>{grid.subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}
        {mode === 'raw' || mode === 'sheets' || mode === 'subject' || mode === 'graded' ? (
          <div><span style={lbl}>Term</span><select value={termId} onChange={(e) => setTermId(e.target.value)} style={inp}>{terms.map((t) => <option key={t.id} value={t.id}>{termLabel(t)}</option>)}</select></div>
        ) : (
          <div><span style={lbl}>Card</span><select value={cardKey} onChange={(e) => setCardKey(e.target.value)} style={inp}>{(cards?.cardKeys || []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></div>
        )}
        {sections.length > 1 && <div><span style={lbl}>Section</span><select value={section} onChange={(e) => setSection(e.target.value)} style={inp}><option value="">All</option>{sections.map((s) => <option key={s}>{s}</option>)}</select></div>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {mode === 'graded' ? (<>
            <Btn onClick={() => guarded(() => exportPDF(gradedBlank))} disabled={!gradedBlank || busy || syncing} title="Empty boxes for every area, discipline and remarks — for the class teacher to fill on paper">Blank sheet (PDF)</Btn>
            <Btn onClick={() => guarded(() => exportXLSX(gradedBlank))} disabled={!gradedBlank || busy || syncing}>Blank sheet (Excel)</Btn>
            <Btn onClick={() => guarded(() => exportPDF(gradedExport))} disabled={!gradedExport || busy || syncing} title="Grades as entered so far">With grades (PDF)</Btn>
            <Btn onClick={() => guarded(() => exportXLSX(gradedExport))} disabled={!gradedExport || busy || syncing}>With grades (Excel)</Btn>
          </>) : mode === 'sheets' ? (<>
            <Btn onClick={() => guarded(() => exportSheetPDF(sheetArgs(false)))} disabled={!grid?.papers?.length || busy || syncing} title="Student list with empty boxes for every paper of this term — for marking on paper">Blank sheet (PDF)</Btn>
            <Btn onClick={() => guarded(() => exportSheetXLSX(sheetArgs(false)))} disabled={!grid?.papers?.length || busy || syncing} title="Same list as an Excel file">Blank sheet (Excel)</Btn>
            <Btn onClick={() => guarded(() => exportSheetPDF(sheetArgs(true)))} disabled={!grid?.papers?.length || busy || syncing} title="Current entries, for checking against the answer sheets">With marks (PDF)</Btn>
          </>) : (<>
            <Btn onClick={() => guarded(() => exportPDF(exp))} disabled={!exp || busy || syncing}>PDF</Btn>
            <Btn onClick={() => guarded(() => exportXLSX(exp))} disabled={!exp || busy || syncing}>Excel</Btn>
          </>)}
        </div>
      </div>

      {sync && !sync.synced && (
        <Note tone="gold">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <b>Papers are out of step with the scoring rules</b> — downloads are held until they match. {syncIssues.length} difference{syncIssues.length === 1 ? '' : 's'}:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{syncIssues.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}{syncIssues.length > 8 && <li>… and {syncIssues.length - 8} more</li>}</ul>
            </div>
            <Btn kind="primary" onClick={syncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync papers with rules'}</Btn>
          </div>
        </Note>
      )}
      {sync?.synced && <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: -6 }}>✓ Papers match the scoring rules ({sync.papers} papers).{sync.notes?.length ? <span style={{ color: 'var(--text-muted)' }}> Note: {sync.notes.join('; ')} — marks are scaled from the paper's own max.</span> : null}</div>}

      {mode === 'graded' && !busy && pack && gradedTable && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'baseline', gap: 10 }}><div style={{ fontSize: 13, fontWeight: 600 }}>Graded areas · {termObj?.name}</div><div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{gradedTable.areas.length} area{gradedTable.areas.length === 1 ? '' : 's'} · {gradedTable.entered} of {pack.students?.length || 0} students have grades · entered under Marks entry → Card entries</div></div>
          {gradedTable.areas.length === 0 ? <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>This class's template has no co-scholastic areas or graded subjects. Add them in Setup → Card areas.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead><tr>{gradedTable.head.map((h, i) => <th key={i} style={{ ...th, textAlign: i < 2 || /^Remarks/.test(h) ? 'left' : 'center' }}>{h}</th>)}</tr></thead>
              <tbody>{gradedTable.filled.body.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>{r.map((c, j) => <td key={j} style={{ ...td, textAlign: j < 2 || j === gradedTable.head.findIndex((h) => /^Remarks/.test(h)) ? 'left' : 'center', color: c === '' ? 'var(--gray-400)' : 'var(--text)', fontWeight: j === 1 ? 500 : (j > 1 && c && !/^Remarks/.test(gradedTable.head[j]) ? 600 : 400), whiteSpace: j === 1 ? 'nowrap' : 'normal' }}>{c === '' ? '—' : c}</td>)}</tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {mode === 'subject' && !busy && grid && subjectTables.map((t) => (
        <div key={t.subject.id} style={{ ...card, padding: 0, overflow: 'auto' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'baseline', gap: 10 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{t.subject.name}</div><div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{grid.term?.name}{t.subject.teacher ? ` · ${t.subject.teacher}` : ''} · {t.papers.length} paper{t.papers.length === 1 ? '' : 's'}</div></div>
          {t.papers.length === 0 ? <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No papers for this subject in {grid.term?.name}.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr>{t.head.map((h, i) => <th key={i} style={{ ...th, textAlign: i < 2 ? 'left' : 'center' }}>{h}</th>)}</tr></thead>
              <tbody>{t.body.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>{r.map((c, j) => <td key={j} style={{ ...td, textAlign: j < 2 ? 'left' : 'center', color: c === '—' || c === 'n/a' ? 'var(--gray-400)' : c === 'AB' ? 'var(--crimson)' : 'var(--text)', fontWeight: j === r.length - 1 ? 600 : (j === 1 ? 500 : 400), whiteSpace: j === 1 ? 'nowrap' : 'normal' }}>{c}</td>)}</tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ))}

      {mode === 'sheets' && !busy && grid && (
        <div style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Entry sheet · {grid.term?.name} · {className}{section ? ' - ' + section : ''}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{grid.students.length} students × {grid.papers.length} papers. One column per paper, raw max in the heading; AB for absent. Type the marks back in under Marks entry → Class grid.</div>
          {grid.papers.length === 0 ? <Note tone="gold">No papers for this term yet — generate them in Papers.</Note> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {groupsOf(grid).map((g) => <span key={g.subject?.id} style={{ border: '1px solid var(--gray-200)', borderRadius: 99, padding: '3px 10px', fontSize: 11.5 }}><b>{g.subject?.name}</b> · {g.papers.map((p) => `${COMP[p.componentKey] || p.name} /${p.hasPractical ? `${p.theoryMax}+${p.practicalMax}` : p.max}`).join(' · ')}</span>)}
            </div>
          )}
          {grid.applicable && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>Optional subjects a student does not take are printed as <b>n/a</b>.</div>}
        </div>
      )}

      {busy ? <Spinner /> : mode === 'raw' ? (raw && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead><tr><th style={th}>Roll</th><th style={th}>Student</th>{raw.subjects.map((s) => <th key={s.id} style={{ ...th, textAlign: 'center' }}>{s.name}<br /><span style={{ fontWeight: 500 }}>/{s.maxMarks}</span></th>)}<th style={{ ...th, textAlign: 'center' }}>Total</th><th style={{ ...th, textAlign: 'center' }}>%</th><th style={{ ...th, textAlign: 'center' }}>Rank</th></tr></thead>
            <tbody>{raw.students.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                <td style={{ ...td, color: 'var(--text-muted)' }}>{r.rollNumber || '—'}</td><td style={{ ...td, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.name}</td>
                {raw.subjects.map((s) => { const c = r.marks[s.id]; return <td key={s.id} style={{ ...td, textAlign: 'center', color: !c?.entered ? 'var(--gray-400)' : c.absent ? 'var(--crimson)' : 'var(--text)' }}>{cellText(c)}</td> })}
                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.hasAny ? `${r.total}/${r.maxTotal}` : '—'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{r.percent != null ? r.percent.toFixed(1) : '—'}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.rank ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )) : mode !== 'card' ? null : (cards && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead><tr><th style={th}>Roll</th><th style={th}>Student</th>{subjectsInCards.map((s) => <th key={s} style={{ ...th, textAlign: 'center' }}>{s}</th>)}<th style={{ ...th, textAlign: 'center' }}>Total</th><th style={{ ...th, textAlign: 'center' }}>%</th><th style={{ ...th, textAlign: 'center' }}>Grade</th><th style={{ ...th, textAlign: 'center' }}>Rank</th><th style={th}></th></tr></thead>
            <tbody>{cards.rows.map((r, i) => (
              <tr key={r.studentId} style={{ background: i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                <td style={{ ...td, color: 'var(--text-muted)' }}>{r.roll || '—'}</td><td style={{ ...td, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.name}</td>
                {subjectsInCards.map((s) => { const x = r.subjects.find((y) => y.subject === s); return <td key={s} style={{ ...td, textAlign: 'center', color: x?.max ? 'var(--text)' : 'var(--gray-400)' }}>{x?.max ? <>{x.obtained}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/{x.max}</span></> : '—'}</td> })}
                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.overall.max ? `${r.overall.obtained}/${r.overall.max}` : '—'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{r.overall.pct != null ? r.overall.pct.toFixed(1) : '—'}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 600, color: 'var(--green)' }}>{r.overall.grade || '—'}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.rank ?? '—'}</td>
                <td style={td}>{r.ok ? <Pill tone="green">complete</Pill> : <Pill tone="red" title={r.missing.slice(0, 8).map((m) => `${m.row}${m.term ? ' · ' + m.term : ''}${m.component ? ' · ' + m.component : ''}: ${m.reason}`).join('\n')}>{r.missing.length} missing</Pill>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
