// Marks entry sheets (blank / with marks) built from a class-grid payload.
// Used by the Crosslist stage; the grid itself no longer carries the buttons.

export const isAB = (v) => ['AB', 'A'].includes(String(v ?? '').trim().toUpperCase())
export const COMP = { pt: 'PT', portfolio: 'Portfolio', se: 'Sub. Enr.', notebook: 'Notebook', exam: 'Exam', oral: 'Oral', written: 'Written' }

/** class-grid marks → editable cell values keyed `${studentId}|${paperId}` */
export function valsFromGrid(d) {
  const v = {}
  const byKey = new Map(d.marks.map((m) => [`${m.student_id}|${m.paper_id}`, m]))
  for (const s of d.students) for (const p of d.papers) {
    const m = byKey.get(`${s.id}|${p.id}`)
    v[`${s.id}|${p.id}`] = { v: m ? (m.is_absent ? 'AB' : (m.marks_obtained == null ? '' : String(Number(m.marks_obtained)))) : '', th: m?.theory_obtained == null ? '' : String(Number(m.theory_obtained)), pr: m?.practical_obtained == null ? '' : String(Number(m.practical_obtained)), src: m?.source || null }
  }
  return v
}
/** papers grouped by subject, in grid order */
export function groupsOf(d, papers = d?.papers || []) {
  const g = []
  for (const p of papers) { const s = (d?.subjects || []).find((x) => x.id === p.subjectId); const last = g[g.length - 1]; if (last && last.subject.id === p.subjectId) last.papers.push(p); else g.push({ subject: s, papers: [p] }) }
  return g
}

const paperLabel = (p, short) => { const c = COMP[p.componentKey] || p.name; const l = short ? ({ Portfolio: 'Portf.', 'Sub. Enr.': 'S. Enr.' }[c] || c) : c; return `${l}\n/${p.hasPractical ? `${p.theoryMax}+${p.practicalMax}` : p.max}` }
/** flat one-row header (Excel) */
function sheetHead(groups) { return groups.flatMap((g) => g.papers.map((p) => `${g.subject.name} · ${paperLabel(p, false).replace('\n', ' ')}`)) }
/** two-row header for the PDF: subject spanning its papers, then paper + max */
function sheetHead2(groups) {
  const n = groups.reduce((s, g) => s + g.papers.length, 0), short = n > 14
  const row1 = [{ content: 'Roll', rowSpan: 2 }, { content: 'Student', rowSpan: 2 }, { content: 'Adm no.', rowSpan: 2 }, ...groups.map((g) => ({ content: g.subject?.name || '', colSpan: g.papers.length }))]
  const row2 = groups.flatMap((g) => g.papers.map((p) => ({ content: paperLabel(p, short) })))
  return [row1, row2]
}
function sheetRows(data, groups, vals, withMarks) {
  return data.students.map((s) => [s.roll || '', s.name, s.admissionNo || '', ...groups.flatMap((g) => g.papers.map((p) => {
    if (data.applicable && !(data.applicable[s.id] || []).includes(p.subjectId)) return 'n/a'
    if (!withMarks) return ''
    const c = vals[`${s.id}|${p.id}`] || {}
    return p.hasPractical ? [c.th, c.pr].filter((x) => x !== '' && x != null).join(' + ') : (c.v ?? '')
  }))])
}
/** Header image as a data URL, downscaled to maxW px: jsPDF stores PNGs as raw
 *  pixels, so the 1578 px crest alone would add ~10 MB to every export. */
export function loadImage(src, maxW = 400) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, maxW / img.naturalWidth), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve({ data: cv.toDataURL('image/png'), w, h })
    }
    img.onerror = () => resolve(null); img.src = src
  })
}
const fileBase = (meta, withMarks) => `marks-sheet-${meta.branch}-${meta.className.replace(/\s+/g, '-')}${meta.section ? '-' + meta.section : ''}-${(meta.term || '').replace(/\s+/g, '-')}${withMarks ? '' : '-blank'}`

export async function exportSheetPDF({ data, groups, vals, withMarks, meta }) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const [banner, crest] = await Promise.all([loadImage('/banner-light.png', 480), loadImage('/crest.png', 96)])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 8
  if (banner) { const bw = 56, bh = (banner.h / banner.w) * bw; if (crest) { const ch = 11, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) } doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh); y += bh + 2 }
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0); doc.text(`MARKS ENTRY SHEET — ${(meta.term || '').toUpperCase()}`, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(0); doc.text(`${meta.className}${meta.section ? ' - ' + meta.section : ''}  ·  ${meta.branch} branch  ·  Session ${meta.session}  ·  ${withMarks ? 'current entries' : 'blank — enter raw marks, AB for absent'}`, pageW / 2, y + 8.5, { align: 'center' }); y += 12
  const nPapers = groups.reduce((s, g) => s + g.papers.length, 0)
  const fixed = 9 + 40 + 16, paperW = Math.max(8, (pageW - 12 - fixed) / Math.max(1, nPapers))
  const columnStyles = { 0: { cellWidth: 9 }, 1: { cellWidth: 40, halign: 'left' }, 2: { cellWidth: 16 } }
  for (let i = 0; i < nPapers; i++) columnStyles[3 + i] = { cellWidth: paperW }
  autoTable(doc, { startY: y, head: sheetHead2(groups), body: sheetRows(data, groups, vals, withMarks), margin: { left: 6, right: 6 }, theme: 'grid', styles: { font: 'helvetica', fontSize: nPapers > 14 ? 7 : 8.5, cellPadding: 1.2, halign: 'center', valign: 'middle', minCellHeight: withMarks ? 6 : 8, textColor: 0, lineColor: 0, lineWidth: 0.2 }, headStyles: { fillColor: [232, 232, 232], textColor: 0, fontStyle: 'bold', fontSize: nPapers > 14 ? 6.5 : 7.5, lineColor: 0, lineWidth: 0.3, cellPadding: 1 }, alternateRowStyles: { fillColor: 255 }, columnStyles })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0); doc.text(`Printed ${new Date().toLocaleDateString('en-IN')} · ${data.students.length} students · Teacher signature: ____________________`, 6, doc.internal.pageSize.getHeight() - 5); doc.text(`Page ${p} of ${pages}`, pageW - 6, doc.internal.pageSize.getHeight() - 5, { align: 'right' }) }
  doc.save(fileBase(meta, withMarks) + '.pdf')
}
export async function exportSheetXLSX({ data, groups, vals, withMarks, meta }) {
  const XLSX = await import('xlsx')
  const head = ['Roll', 'Student', 'Adm no.', ...sheetHead(groups)]
  const ws = XLSX.utils.aoa_to_sheet([[`Radhakrishna Academy — Marks entry sheet`], [`${meta.term} · ${meta.className}${meta.section ? ' - ' + meta.section : ''} · ${meta.branch} branch · Session ${meta.session}`], [], head, ...sheetRows(data, groups, vals, withMarks)])
  ws['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 10 }, ...groups.flatMap((g) => g.papers.map(() => ({ wch: 16 })))]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, meta.className.slice(0, 25)); XLSX.writeFile(wb, fileBase(meta, withMarks) + '.xlsx')
}
