import React, { useState, useEffect, useMemo } from 'react'
import { examApi } from '../../lib/api'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner } from './ui.jsx'

/* Stage 5 — Crosslist. Two views of the same class:
     · Raw   — one exam term, every paper summed per subject (as entered)
     · Card  — one card (T1 / Final / Annual / HY …), the engine's normalised
               subject totals + rank, exactly what will print
   Exports: branded landscape PDF + XLSX for both. */

const cellText = (c) => (!c || !c.entered ? '—' : c.absent ? 'AB' : String(c.obtained))

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => { const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; cv.getContext('2d').drawImage(img, 0, 0); resolve({ data: cv.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight }) }
    img.onerror = () => resolve(null)
    img.src = src
  })
}
async function exportPDF({ title, subtitle, head, body, fileName }) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const [banner, crest] = await Promise.all([loadImage('/banner-light.png'), loadImage('/crest.png')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 10
  if (banner) { const bw = 62, bh = (banner.h / banner.w) * bw; if (crest) { const ch = 12, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) } doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh); y += bh + 2 }
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(26, 74, 46); doc.text(title, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90); doc.text(subtitle, pageW / 2, y + 8.5, { align: 'center' }); y += 12
  autoTable(doc, { startY: y, head: [head], body, margin: { left: 8, right: 8 }, styles: { font: 'helvetica', fontSize: 7.4, cellPadding: 1.2, halign: 'center' }, headStyles: { fillColor: [26, 74, 46], textColor: 255, fontSize: 7 }, alternateRowStyles: { fillColor: [246, 250, 247] }, columnStyles: { 0: { cellWidth: 11 }, 1: { cellWidth: 42, halign: 'left' } } })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(150); doc.text(`Generated ${new Date().toLocaleDateString('en-IN')} · ${body.length} students · AB = absent, — = not entered`, 8, doc.internal.pageSize.getHeight() - 5); doc.text(`Page ${p} of ${pages}`, pageW - 8, doc.internal.pageSize.getHeight() - 5, { align: 'right' }) }
  doc.save(fileName + '.pdf')
}
async function exportXLSX({ title, subtitle, head, body, fileName, sheet }) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([[title], [subtitle], [], head, ...body])
  ws['!cols'] = head.map((h, i) => ({ wch: i === 1 ? 26 : Math.max(8, Math.min(14, String(h).length + 2)) }))
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 25)); XLSX.writeFile(wb, fileName + '.xlsx')
}

export default function CrosslistStage({ branch, sessionCode, className, config }) {
  const [mode, setMode] = useState('card')
  const [termId, setTermId] = useState('')
  const [cardKey, setCardKey] = useState('')
  const [section, setSection] = useState('')
  const [raw, setRaw] = useState(null)
  const [cards, setCards] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const terms = config?.terms || []
  useEffect(() => { if (!termId && terms.length) setTermId(terms[0].id) }, [terms]) // eslint-disable-line

  useEffect(() => {
    if (mode === 'card' && cards && cards.cardKey === cardKey && cards._section === section) return // server echoed the default key — no second fetch
    setErr(''); setBusy(true)
    const p = mode === 'raw'
      ? (termId ? examApi.crosslist(branch, termId, className, section || undefined).then(setRaw) : Promise.resolve())
      : examApi.classCards(branch, sessionCode, className, cardKey || undefined, section || undefined).then((d) => { setCards({ ...d, _section: section }); if (!cardKey) setCardKey(d.cardKey) })
    p.catch((e) => { setErr(e.message); if (mode === 'raw') setRaw(null); else setCards(null) }).finally(() => setBusy(false))
  }, [mode, termId, cardKey, section, branch, sessionCode, className]) // eslint-disable-line

  const sections = useMemo(() => [...new Set(((mode === 'raw' ? raw?.students : cards?.rows) || []).map((r) => r.section).filter(Boolean))].sort(), [raw, cards, mode])
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
  const exp = mode === 'raw' ? rawExport : cardExport

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><span style={lbl}>View</span>
          <div style={{ display: 'inline-flex', border: '1px solid var(--gray-200)', borderRadius: 99, overflow: 'hidden' }}>
            {[['card', 'As on card'], ['raw', 'Raw per term']].map(([k, l]) => <button key={k} onClick={() => setMode(k)} style={{ padding: '6px 14px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: mode === k ? 'var(--text)' : 'var(--white)', color: mode === k ? 'var(--white)' : 'var(--text-muted)' }}>{l}</button>)}
          </div></div>
        {mode === 'raw' ? (
          <div><span style={lbl}>Term</span><select value={termId} onChange={(e) => setTermId(e.target.value)} style={inp}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        ) : (
          <div><span style={lbl}>Card</span><select value={cardKey} onChange={(e) => setCardKey(e.target.value)} style={inp}>{(cards?.cardKeys || []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></div>
        )}
        {sections.length > 1 && <div><span style={lbl}>Section</span><select value={section} onChange={(e) => setSection(e.target.value)} style={inp}><option value="">All</option>{sections.map((s) => <option key={s}>{s}</option>)}</select></div>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Btn onClick={() => exportPDF(exp)} disabled={!exp || busy}>PDF</Btn>
          <Btn onClick={() => exportXLSX(exp)} disabled={!exp || busy}>Excel</Btn>
        </div>
      </div>

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
      )) : (cards && (
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
