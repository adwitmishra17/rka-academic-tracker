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
const fileBase = (meta, withMarks) => `marks-sheet-${meta.branch}-${meta.className.replace(/\s+/g, '-')}${meta.section ? '-' + meta.section : ''}-${(meta.term || '').replace(/\s+/g, '-')}${withMarks ? '' : '-blank'}`

export async function exportSheetPDF({ data, groups, vals, withMarks, meta }) {
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
  doc.save(fileBase(meta, withMarks) + '.pdf')
}
export async function exportSheetXLSX({ data, groups, vals, withMarks, meta }) {
  const XLSX = await import('xlsx')
  const head = ['Roll', 'Student', 'Adm no.', ...sheetHead(groups)]
  const ws = XLSX.utils.aoa_to_sheet([[`Radhakrishna Academy — Marks entry sheet`], [`${meta.term} · ${meta.className}${meta.section ? ' - ' + meta.section : ''} · ${meta.branch} branch · Session ${meta.session}`], [], head, ...sheetRows(data, groups, vals, withMarks)])
  ws['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 10 }, ...groups.flatMap((g) => g.papers.map(() => ({ wch: 16 })))]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, meta.className.slice(0, 25)); XLSX.writeFile(wb, fileBase(meta, withMarks) + '.xlsx')
}
