// =========================================================================
// datesheetPdf.js — combined band date-sheet PDF (Date × Class grid) with a
// verification QR.
//
// Same letterhead as the marks sheets (crest + wordmark + Skolix). Rows are
// exam dates; columns are the band's classes; each cell is that class's subject
// that day. A QR bottom-left opens the public verification page (the live
// schedule) so a printed sheet can be confirmed genuine.
//
// rows = [{ subject, classes:[{className,...}], examDate, startTime, endTime }] (dated);
// meta = { branch, bandLabel, classes:[className], session, termName, verifyUrl }.
// =========================================================================

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

const shortClass = (c) => String(c).replace(/^Class\s*/i, '')
const dayName = (d) => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) } catch { return '' } }
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) } catch { return String(d || '') } }
function fmtTime(t) { if (!t) return ''; const [h, m] = String(t).split(':'); const H = Number(h); const ap = H >= 12 ? 'PM' : 'AM'; const h12 = ((H + 11) % 12) + 1; return `${h12}:${m} ${ap}` }

export async function exportDatesheetPDF(rows, meta) {
  const [{ default: jsPDF }, { default: autoTable }, QR] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('qrcode'),
  ])
  const [banner, crest, skolix] = await Promise.all([
    loadImage('/banner-light.png', 480), loadImage('/crest.png', 96), loadImage('/skolix-lockup.png', 540),
  ])
  const qrData = meta.verifyUrl ? await QR.toDataURL(meta.verifyUrl, { margin: 1, width: 260, errorCorrectionLevel: 'M' }).catch(() => null) : null

  const bandClasses = meta.classes || []
  // Pivot: date → { time, byClass:{ className: [subjects] } }
  const byDate = new Map()
  for (const r of rows) {
    if (!r.examDate) continue
    const d = byDate.get(r.examDate) || { time: '', byClass: {}, times: new Set() }
    const tr = [fmtTime(r.startTime), fmtTime(r.endTime)].filter(Boolean).join('–')
    if (tr) d.times.add(tr)
    for (const c of (r.classes || [])) { (d.byClass[c.className] ||= []).push(r.subject) }
    byDate.set(r.examDate, d)
  }
  const dates = [...byDate.keys()].sort((a, b) => String(a).localeCompare(String(b)))

  const landscape = bandClasses.length > 3
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = 9
  if (banner) {
    const bw = 54, bh = (banner.h / banner.w) * bw
    if (crest) { const ch = 11, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) }
    doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh)
    if (skolix) { const lh = 8, lw = (skolix.w / skolix.h) * lh; doc.addImage(skolix.data, 'PNG', pageW - 12 - lw, y + (bh - lh) / 2, lw, lh) }
    y += bh + 2
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(26, 74, 46)
    doc.text('Radhakrishna Academy', pageW / 2, y + 5, { align: 'center' }); y += 10
  }
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(26, 74, 46)
  doc.text(`EXAMINATION DATE SHEET — ${(meta.bandLabel || '').toUpperCase()}`, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(90)
  doc.text([meta.termName || 'Exam', `Session ${meta.session || ''}`, `${meta.branch || ''} branch`].filter(Boolean).join('  ·  '), pageW / 2, y + 9, { align: 'center' })
  doc.setDrawColor(26, 74, 46).setLineWidth(0.5)
  doc.line(12, y + 12, pageW - 12, y + 12)

  const head = [['Date', 'Day', 'Time', ...bandClasses.map(shortClass)]]
  const body = dates.map((d) => {
    const cell = byDate.get(d)
    const time = [...cell.times].join(' / ') || '—'
    return [fmtDate(d), dayName(d), time, ...bandClasses.map((c) => (cell.byClass[c] || []).join(', ') || '—')]
  })
  const usable = pageW - 24
  const fixed = 22 + 14 + 26
  const colW = Math.max(14, (usable - fixed) / Math.max(1, bandClasses.length))
  const columnStyles = { 0: { cellWidth: 22 }, 1: { cellWidth: 14 }, 2: { cellWidth: 26 } }
  bandClasses.forEach((_, i) => { columnStyles[3 + i] = { cellWidth: colW } })

  autoTable(doc, {
    startY: y + 16,
    head, body, theme: 'grid',
    margin: { left: 12, right: 12 },
    styles: { font: 'helvetica', fontSize: bandClasses.length > 8 ? 7.5 : 9, cellPadding: 2, valign: 'middle', overflow: 'linebreak', textColor: 20, lineColor: 210, lineWidth: 0.2 },
    headStyles: { fillColor: [26, 74, 46], textColor: 255, fontStyle: 'bold', fontSize: bandClasses.length > 8 ? 7.5 : 8.5, halign: 'center' },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles,
  })

  let qy = doc.lastAutoTable.finalY + 10
  if (qy > pageH - 40) { doc.addPage(); qy = 18 }
  if (qrData) {
    const size = 28
    doc.addImage(qrData, 'PNG', 12, qy, size, size)
    doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(26, 74, 46)
    doc.text('Scan to verify this date sheet', 12 + size + 6, qy + 7)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110)
    doc.text(doc.splitTextToSize('Opens the official schedule from the school\'s live system. If the printed dates differ, treat this copy as unofficial.', pageW - 12 - (12 + size + 6)), 12 + size + 6, qy + 12)
  }
  doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(140)
  doc.text('Dates are subject to change; changes will be communicated by the school.', 12, pageH - 7)
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(150)
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN')}`, pageW - 12, pageH - 7, { align: 'right' })

  const stem = ['datesheet', meta.branch || 'branch', (meta.bandLabel || 'band').replace(/[^a-z0-9]+/gi, '-'), (meta.termName || 'exam').replace(/\s+/g, '-'), new Date().toISOString().slice(0, 10)].join('-')
  doc.save(`${stem}.pdf`)
}
