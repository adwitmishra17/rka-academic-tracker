// =========================================================================
// datesheetPdf.js — branded exam date-sheet PDF with a verification QR.
//
// Same letterhead as the marks sheets (crest + wordmark + Skolix), the exam
// timetable table, and a QR bottom-right that opens the public verification
// page (the LIVE schedule) so a printed sheet can be confirmed genuine.
//
// rows = [{ subject, examDate, startTime, endTime, venue }] (sorted);
// meta = { branch, className, session, termName, verifyUrl }.
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

const dayName = (d) => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) } catch { return '' } }
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) } catch { return String(d || '') } }
function fmtTime(t) { if (!t) return ''; const [h, m] = String(t).split(':'); const H = Number(h); const ap = H >= 12 ? 'PM' : 'AM'; const h12 = ((H + 11) % 12) + 1; return `${h12}:${m} ${ap}` }
const timeRange = (r) => [fmtTime(r.startTime), fmtTime(r.endTime)].filter(Boolean).join(' – ') || '—'

export async function exportDatesheetPDF(rows, meta) {
  const [{ default: jsPDF }, { default: autoTable }, QR] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('qrcode'),
  ])
  const [banner, crest, skolix] = await Promise.all([
    loadImage('/banner-light.png', 480), loadImage('/crest.png', 96), loadImage('/skolix-lockup.png', 540),
  ])
  const qrData = meta.verifyUrl ? await QR.toDataURL(meta.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).catch(() => null) : null

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = 10
  if (banner) {
    const bw = 58, bh = (banner.h / banner.w) * bw
    if (crest) { const ch = 12, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) }
    doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh)
    if (skolix) { const lh = 8.5, lw = (skolix.w / skolix.h) * lh; doc.addImage(skolix.data, 'PNG', pageW - 12 - lw, y + (bh - lh) / 2, lw, lh) }
    y += bh + 2
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(26, 74, 46)
    doc.text('Radhakrishna Academy', pageW / 2, y + 5, { align: 'center' }); y += 10
  }
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(26, 74, 46)
  doc.text('EXAMINATION DATE SHEET', pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(90)
  doc.text([meta.className || 'Class', meta.termName || 'Exam', `Session ${meta.session || ''}`, `${meta.branch || ''} branch`].filter(Boolean).join('  ·  '), pageW / 2, y + 9, { align: 'center' })
  doc.setDrawColor(26, 74, 46).setLineWidth(0.5)
  doc.line(14, y + 12, pageW - 14, y + 12)

  autoTable(doc, {
    startY: y + 16,
    head: [['Date', 'Day', 'Subject', 'Time', 'Venue']],
    body: rows.map((r) => [fmtDate(r.examDate), dayName(r.examDate), r.subject, timeRange(r), r.venue || '—']),
    margin: { left: 14, right: 14 },
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 2.4, valign: 'middle' },
    headStyles: { fillColor: [26, 74, 46], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 26 }, 3: { cellWidth: 34 } },
  })

  // Verification QR, bottom-left, with instructions to its right.
  let qy = doc.lastAutoTable.finalY + 12
  if (qy > pageH - 42) { doc.addPage(); qy = 20 }
  if (qrData) {
    const size = 30
    doc.addImage(qrData, 'PNG', 14, qy, size, size)
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(26, 74, 46)
    doc.text('Scan to verify this date sheet', 14 + size + 6, qy + 8)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(110)
    doc.text(doc.splitTextToSize('Opens the official schedule from the school\'s live system. If the printed dates differ from the page, treat this copy as unofficial.', pageW - 14 - (14 + size + 6)), 14 + size + 6, qy + 13)
  }

  doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(140)
  doc.text('Dates are subject to change; changes will be communicated by the school.', 14, pageH - 8)
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(150)
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN')}`, pageW - 14, pageH - 8, { align: 'right' })

  const stem = ['datesheet', meta.branch || 'branch', (meta.className || 'class').replace(/\s+/g, '-'), (meta.termName || 'exam').replace(/\s+/g, '-'), new Date().toISOString().slice(0, 10)].join('-')
  doc.save(`${stem}.pdf`)
}
