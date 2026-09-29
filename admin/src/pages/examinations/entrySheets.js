// Marks entry sheets (blank / with marks) built from a class-grid payload.
// Used by the Crosslist stage; the grid itself no longer carries the buttons.
//
// A paper split into theory + practical (80+20, 70+30, 50+50 …) gets TWO
// boxes on paper — Th and Pr, the same two boxes the Marks-entry class grid
// has — so each part is marked on its own instead of one combined figure.

export const isAB = (v) => ['AB', 'A'].includes(String(v ?? '').trim().toUpperCase())
// pt is deliberately absent: periodic-test papers carry their own name (PA-1 / PA-2), which the grids and sheets show
export const COMP = { portfolio: 'Portfolio', se: 'Sub. Enr.', notebook: 'Notebook', exam: 'Exam', oral: 'Oral', written: 'Written' }

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

export const PART = { th: 'Th', pr: 'Pr' }

/** One entry column per paper; a theory + practical paper gets two (Th, Pr). */
export function entryColumns(groups) {
  return groups.flatMap((g) => g.papers.flatMap((p) => {
    const base = { subject: g.subject, paper: p, multi: g.papers.length > 1 }
    return p.hasPractical
      ? [{ ...base, part: 'th', max: p.theoryMax }, { ...base, part: 'pr', max: p.practicalMax }]
      : [{ ...base, part: null, max: p.max }]
  }))
}
const spanOf = (g) => g.papers.reduce((n, p) => n + (p.hasPractical ? 2 : 1), 0)

const compName = (p, short) => { const c = COMP[p.componentKey] || p.name; return short ? ({ Portfolio: 'Portf.', 'Sub. Enr.': 'S. Enr.' }[c] || c) : c }
/** Column heading. Two lines for the PDF, where the subject name sits in the row
 *  above (a subject whose only paper is split just needs Th / Pr under it);
 *  `flat` = one line with the component always named (Excel, subject sheets). */
export function entryLabel(col, { short = false, flat = false } = {}) {
  const comp = compName(col.paper, short)
  const part = col.part ? PART[col.part] : ''
  if (flat) return `${comp}${part ? ' ' + part : ''} /${col.max}`
  return `${col.part && !col.multi ? part : `${comp}${part ? ' ' + part : ''}`}\n/${col.max}`
}

/** A cell: n/a (subject not taken), blank, or what was entered for that part. */
function entryCell(col, s, data, vals, withMarks) {
  if (data.applicable && !(data.applicable[s.id] || []).includes(col.paper.subjectId)) return 'n/a'
  if (!withMarks) return ''
  const c = vals[`${s.id}|${col.paper.id}`] || {}
  if (!col.part) return c.v ?? ''
  if (isAB(c.v) || isAB(c.th)) return 'AB'          // absent for the paper = both parts
  return (col.part === 'th' ? c.th : c.pr) ?? ''
}

/** flat one-row header (Excel) */
function sheetHead(groups) { return entryColumns(groups).map((c) => `${c.subject?.name || ''} · ${entryLabel(c, { flat: true })}`) }
/** two-row header for the PDF: subject spanning its boxes, then part + max */
function sheetHead2(groups, cols) {
  const short = cols.length > 14
  const row1 = [{ content: 'Roll', rowSpan: 2 }, { content: 'Student', rowSpan: 2 }, { content: 'Adm no.', rowSpan: 2 }, ...groups.map((g) => ({ content: g.subject?.name || '', colSpan: spanOf(g) }))]
  const row2 = cols.map((c) => ({ content: entryLabel(c, { short }) }))
  return [row1, row2]
}
function sheetRows(data, cols, vals, withMarks) {
  return data.students.map((s) => [s.roll || '', s.name, s.admissionNo || '', ...cols.map((c) => entryCell(c, s, data, vals, withMarks))])
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
  const [banner, crest, skolix] = await Promise.all([loadImage('/banner-light.png?v=3', 480), loadImage('/crest.png', 96), loadImage('/skolix-lockup.png', 540)])
  const cols = entryColumns(groups), nCols = cols.length, split = cols.some((c) => c.part)
  // narrow sheets (Term 1 / Term 2: one box per subject) print portrait so ~45 students fit a page
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: nCols + 3 <= 14 ? 'portrait' : 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 8
  if (banner) { const bw = 56, bh = (banner.h / banner.w) * bw; if (crest) { const ch = 11, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) } doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh); if (skolix) { const lh = 8.5, lw = (skolix.w / skolix.h) * lh; doc.addImage(skolix.data, 'PNG', pageW - 6 - lw, y + (bh - lh) / 2, lw, lh) }; y += bh + 2 }
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0); doc.text(`MARKS ENTRY SHEET — ${(meta.term || '').toUpperCase()}`, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(0); doc.text(`${meta.className}${meta.section ? ' - ' + meta.section : ''}  ·  ${meta.branch} branch  ·  Session ${meta.session}  ·  ${withMarks ? 'current entries' : 'blank — enter raw marks, AB for absent'}`, pageW / 2, y + 8.5, { align: 'center' }); y += 12
  if (split) { doc.setFontSize(8.5); doc.text('Th = theory, Pr = practical / internal assessment — write each part in its own box', pageW / 2, y + 0.5, { align: 'center' }); y += 4 }
  const fixed = 9 + 40 + 16, paperW = Math.max(8, Math.min(22, (pageW - 12 - fixed) / Math.max(1, nCols)))
  const columnStyles = { 0: { cellWidth: 9 }, 1: { cellWidth: 40, halign: 'left' }, 2: { cellWidth: 16 } }
  for (let i = 0; i < nCols; i++) columnStyles[3 + i] = { cellWidth: paperW }
  // a heavier rule between subjects, so each Th | Pr pair reads as one block
  const edges = new Set([3]); { let ci = 3; for (const g of groups) { ci += spanOf(g); edges.add(ci) } }
  autoTable(doc, { startY: y, head: sheetHead2(groups, cols), body: sheetRows(data, cols, vals, withMarks), margin: { left: 6, right: 6 }, theme: 'grid', styles: { font: 'helvetica', fontSize: nCols > 14 ? 7 : 8.5, cellPadding: 1.2, halign: 'center', valign: 'middle', minCellHeight: withMarks ? 6 : 7, textColor: 0, lineColor: 0, lineWidth: 0.2 }, headStyles: { fillColor: [232, 232, 232], textColor: 0, fontStyle: 'bold', fontSize: nCols > 14 ? 6.5 : 7.5, lineColor: 0, lineWidth: 0.3, cellPadding: { top: 1, bottom: 1, left: 0.6, right: 0.6 } }, alternateRowStyles: { fillColor: 255 }, columnStyles,
    // subject names that would split mid-word ("Mathematic / s") shrink to fit their column instead
    didParseCell: (d) => {
      if (d.section !== 'head' || d.row.index !== 0 || d.column.index < 3) return
      const avail = paperW * (d.cell.colSpan || 1) - 1.4
      const longest = String(d.cell.raw?.content ?? d.cell.raw ?? '').split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), '')
      if (!longest) return
      doc.setFont('helvetica', 'bold')
      let fs = d.cell.styles.fontSize
      const width = (f) => doc.getStringUnitWidth(longest) * f / doc.internal.scaleFactor
      while (fs > 5.5 && width(fs) > avail) fs -= 0.25
      d.cell.styles.fontSize = fs
    },
    didDrawCell: (d) => {
      const i = d.column.index, span = d.cell.colSpan || 1
      doc.setDrawColor(0); doc.setLineWidth(0.6)
      if (edges.has(i)) doc.line(d.cell.x, d.cell.y, d.cell.x, d.cell.y + d.cell.height)
      if (edges.has(i + span)) doc.line(d.cell.x + d.cell.width, d.cell.y, d.cell.x + d.cell.width, d.cell.y + d.cell.height)
    } })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0); const ph = doc.internal.pageSize.getHeight(); doc.text(`Printed ${new Date().toLocaleDateString('en-IN')} · ${data.students.length} students · Teacher signature: ____________________`, 6, ph - 5); doc.text(`Page ${p} of ${pages}`, pageW - 6, ph - 5, { align: 'right' }) }
  doc.save(fileBase(meta, withMarks) + '.pdf')
}
export async function exportSheetXLSX({ data, groups, vals, withMarks, meta }) {
  const XLSX = await import('xlsx')
  const cols = entryColumns(groups)
  const head = ['Roll', 'Student', 'Adm no.', ...sheetHead(groups)]
  const note = cols.some((c) => c.part) ? 'Th = theory, Pr = practical / internal assessment — one column each' : ''
  const ws = XLSX.utils.aoa_to_sheet([[`Radhakrishna Academy — Marks entry sheet`], [`${meta.term} · ${meta.className}${meta.section ? ' - ' + meta.section : ''} · ${meta.branch} branch · Session ${meta.session}`], [note], head, ...sheetRows(data, cols, vals, withMarks)])
  ws['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 10 }, ...cols.map(() => ({ wch: 16 }))]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, meta.className.slice(0, 25)); XLSX.writeFile(wb, fileBase(meta, withMarks) + '.xlsx')
}
