// =========================================================================
// seniorSubjectsPdf.js — branded PDF exports for the Senior Subjects report.
//
// Same letterhead as the marks-entry sheets (crest + wordmark, green rule):
//   exportOptionalPDF    — Class 11 & 12, the elective each opted (portrait)
//   exportAllSubjectsPDF — each student's full resolved subject list (landscape)
//
// rows = the page's resolved rows (camelCase student + `subjects` + `needsStream`);
// meta = { branch, className, session }. A missing optional / stream shows in
// the Status column so the PDF is a usable worklist too.
// =========================================================================

// Header image as a downscaled data URL (jsPDF stores PNGs raw — the full-res
// crest alone would bloat every file by megabytes).
function loadImage(src, maxW = 400) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, maxW / img.naturalWidth)
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h
      cv.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve({ data: cv.toDataURL('image/png'), w, h })
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function statusLabel(r) {
  if (r.needsStream) return 'Set stream'
  if (!r.optionalSubject) return 'Set optional'
  return 'Complete'
}

const scopeLine = (meta) => [
  meta.className || 'Class 11 & 12',
  meta.branch ? `${meta.branch} branch` : 'All branches',
  `Session ${meta.session}`,
].join('  ·  ')

const fileStem = (meta, kind) => [
  'senior-subjects',
  (meta.branch || 'all-branches'),
  meta.className ? meta.className.replace(/\s+/g, '-') : 'class-11-12',
  kind,
  new Date().toISOString().slice(0, 10),
].join('-')

async function brandedDoc(orientation, title, meta) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const [banner, crest, skolix] = await Promise.all([loadImage('/banner-light.png', 480), loadImage('/crest.png', 96), loadImage('/skolix-lockup.png', 540)])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 10
  if (banner) {
    const bw = 58, bh = (banner.h / banner.w) * bw
    if (crest) { const ch = 12, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) }
    doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh)
    // Skolix lockup, top-right — matches the marks-sheet / class-list PDFs.
    if (skolix) { const lh = 8.5, lw = (skolix.w / skolix.h) * lh; doc.addImage(skolix.data, 'PNG', pageW - 12 - lw, y + (bh - lh) / 2, lw, lh) }
    y += bh + 2
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(26, 74, 46)
    doc.text('Radhakrishna Academy', pageW / 2, y + 5, { align: 'center' })
    y += 10
  }
  doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(26, 74, 46)
  doc.text(title, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90)
  doc.text(scopeLine(meta), pageW / 2, y + 9, { align: 'center' })
  doc.setDrawColor(26, 74, 46).setLineWidth(0.5)
  doc.line(14, y + 12, pageW - 14, y + 12)
  return { doc, autoTable, pageW, startY: y + 16 }
}

function footer(doc, pageW, count) {
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(150)
    doc.text(`Generated ${new Date().toLocaleDateString('en-IN')} · ${count} students`, 14, doc.internal.pageSize.getHeight() - 7)
    doc.text(`Page ${p} of ${pages}`, pageW - 14, doc.internal.pageSize.getHeight() - 7, { align: 'right' })
  }
}

const cls = (r) => `${r.className}${r.section ? ' - ' + r.section : ''}`
const HEAD_STYLES = { fillColor: [26, 74, 46], textColor: 255, fontStyle: 'bold' }
const ALT = { fillColor: [246, 250, 247] }

export async function exportOptionalPDF(rows, meta) {
  const { doc, autoTable, pageW, startY } = await brandedDoc('portrait', 'OPTIONAL SUBJECTS — CLASS 11 & 12', meta)
  autoTable(doc, {
    startY,
    head: [['#', 'Student', 'Adm. No', 'Class', 'Path', 'Optional', 'Status']],
    body: rows.map((r, i) => [i + 1, r.fullName, r.admissionNo, cls(r), r.sciencePath || '—', r.optionalSubject || '—', statusLabel(r)]),
    margin: { left: 14, right: 14 },
    styles: { font: 'helvetica', fontSize: 8.8, cellPadding: 1.8, valign: 'middle' },
    headStyles: HEAD_STYLES,
    alternateRowStyles: ALT,
    columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 24 }, 3: { cellWidth: 34 }, 4: { cellWidth: 16 }, 5: { cellWidth: 34 }, 6: { cellWidth: 20 } },
  })
  footer(doc, pageW, rows.length)
  doc.save(`${fileStem(meta, 'optional')}.pdf`)
}

export async function exportAllSubjectsPDF(rows, meta) {
  const { doc, autoTable, pageW, startY } = await brandedDoc('landscape', 'SUBJECTS OPTED — CLASS 11 & 12', meta)
  autoTable(doc, {
    startY,
    head: [['#', 'Student', 'Adm. No', 'Class', 'Optional', 'Subjects', 'Status']],
    body: rows.map((r, i) => [i + 1, r.fullName, r.admissionNo, cls(r), r.optionalSubject || '—', r.subjects.join(', ') || '—', statusLabel(r)]),
    margin: { left: 12, right: 12 },
    styles: { font: 'helvetica', fontSize: 8.6, cellPadding: 1.7, valign: 'middle' },
    headStyles: HEAD_STYLES,
    alternateRowStyles: ALT,
    columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 44 }, 2: { cellWidth: 22 }, 3: { cellWidth: 34 }, 4: { cellWidth: 28 }, 6: { cellWidth: 20 } },
  })
  footer(doc, pageW, rows.length)
  doc.save(`${fileStem(meta, 'all-subjects')}.pdf`)
}
