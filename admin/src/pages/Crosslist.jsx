import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { useClasses } from '../hooks/useClasses'
import { examApi } from '../lib/api'

// =========================================================================
// Marks Crosslist — the consolidated class marks sheet for one term:
// students × subjects with totals, % and rank. Same data as the SMS
// Examinations → Crosslist screen (both read the SMS DB via this app's
// server). Exports: branded PDF (landscape) + .xlsx.
// =========================================================================

const cellText = (c) => (!c || !c.entered ? '—' : c.absent ? 'AB' : String(c.obtained))

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      resolve({ data: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function exportPDF(data, meta) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const [banner, crest] = await Promise.all([loadImage('/banner-light.png'), loadImage('/crest.png')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 10
  if (banner) {
    const bw = 62, bh = (banner.h / banner.w) * bw
    if (crest) { const ch = 12, cw = (crest.w / crest.h) * ch; doc.addImage(crest.data, 'PNG', pageW / 2 - bw / 2 - cw - 4, y + (bh - ch) / 2, cw, ch) }
    doc.addImage(banner.data, 'PNG', pageW / 2 - bw / 2, y, bw, bh)
    y += bh + 2
  }
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(26, 74, 46)
  doc.text(`MARKS CROSSLIST — ${(data.term?.name || '').toUpperCase()}`, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90)
  doc.text([`${meta.className}${meta.section ? ' - ' + meta.section : ''}`, `${meta.branchCode} branch`, `Session ${data.term?.session_code || ''}`].join('  ·  '), pageW / 2, y + 8.5, { align: 'center' })
  y += 12
  autoTable(doc, {
    startY: y,
    head: [['Roll', 'Student', ...data.subjects.map((s) => `${s.name}\n(${s.maxMarks})`), 'Total', '%', 'Rank']],
    body: data.students.map((r) => [
      r.rollNumber || '—', r.name,
      ...data.subjects.map((s) => cellText(r.marks[s.id])),
      r.hasAny ? `${r.total}/${r.maxTotal}` : '—',
      r.percent != null ? r.percent.toFixed(1) : '—',
      r.rank ?? '—',
    ]),
    margin: { left: 8, right: 8 },
    styles: { font: 'helvetica', fontSize: 7.4, cellPadding: 1.2, halign: 'center' },
    headStyles: { fillColor: [26, 74, 46], textColor: 255, fontSize: 7 },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles: { 0: { cellWidth: 11 }, 1: { cellWidth: 42, halign: 'left' } },
  })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(150)
    doc.text(`Generated ${new Date().toLocaleDateString('en-IN')} · ${data.students.length} students · AB = absent, — = not entered`, 8, doc.internal.pageSize.getHeight() - 5)
    doc.text(`Page ${p} of ${pages}`, pageW - 8, doc.internal.pageSize.getHeight() - 5, { align: 'right' })
  }
  doc.save(`crosslist-${meta.branchCode}-${meta.className.replace(/\s+/g, '-')}${meta.section ? '-' + meta.section : ''}-${(data.term?.name || '').replace(/\s+/g, '-')}.pdf`)
}

async function exportXLSX(data, meta) {
  const XLSX = await import('xlsx')
  const header = ['Roll No', 'Student Name', 'Admission No', ...data.subjects.map((s) => `${s.name} (${s.maxMarks})`), 'Total', 'Max', 'Percent', 'Rank']
  const rows = data.students.map((r) => [
    r.rollNumber || '', r.name, r.admissionNo,
    ...data.subjects.map((s) => { const c = r.marks[s.id]; return !c || !c.entered ? '' : c.absent ? 'AB' : c.obtained }),
    r.hasAny ? r.total : '', r.hasAny ? r.maxTotal : '',
    r.percent != null ? Number(r.percent.toFixed(2)) : '', r.rank ?? '',
  ])
  const ws = XLSX.utils.aoa_to_sheet([
    ['Radhakrishna Academy — Marks Crosslist'],
    [`${data.term?.name || ''} · ${meta.className}${meta.section ? ' - ' + meta.section : ''} · ${meta.branchCode} branch · Session ${data.term?.session_code || ''}`],
    [], header, ...rows,
  ])
  ws['!cols'] = [{ wch: 7 }, { wch: 26 }, { wch: 12 }, ...data.subjects.map(() => ({ wch: 11 })), { wch: 7 }, { wch: 7 }, { wch: 8 }, { wch: 6 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, meta.className.slice(0, 25))
  XLSX.writeFile(wb, `crosslist-${meta.branchCode}-${meta.className.replace(/\s+/g, '-')}${meta.section ? '-' + meta.section : ''}-${(data.term?.name || '').replace(/\s+/g, '-')}.xlsx`)
}

export default function Crosslist() {
  const { effectiveBranches } = useAuth()
  const { classes } = useClasses()
  const branchCodes = effectiveBranches && effectiveBranches.length ? effectiveBranches : ['MAIN']
  const [branchCode, setBranchCode] = useState(branchCodes[0])
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [className, setClassName] = useState('')
  const [section, setSection] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(null)

  useEffect(() => {
    examApi.terms(branchCode).then((r) => setTerms(r.terms || [])).catch(() => setTerms([]))
  }, [branchCode])
  useEffect(() => { setData(null) }, [branchCode, termId, className, section])

  async function build() {
    setLoading(true); setError('')
    try { setData(await examApi.crosslist(branchCode, termId, className, section || undefined)) }
    catch (e) { setError(e.message || String(e)); setData(null) }
    finally { setLoading(false) }
  }

  async function doExport(kind) {
    setExporting(kind)
    try { kind === 'pdf' ? await exportPDF(data, { branchCode, className, section }) : await exportXLSX(data, { branchCode, className, section }) }
    catch (e) { setError(e.message || String(e)) }
    finally { setExporting(null) }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a4a2e', margin: 0 }}>Marks Crosslist</h1>
          <p style={{ fontSize: 13, color: '#777', margin: '4px 0 0' }}>Class-wise consolidated marks for a term — totals, percentage and rank</p>
        </div>
        {data && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => doExport('pdf')} disabled={!!exporting} style={btn}>{exporting === 'pdf' ? '…' : 'Download PDF'}</button>
            <button onClick={() => doExport('xlsx')} disabled={!!exporting} style={btn}>{exporting === 'xlsx' ? '…' : 'Download Excel'}</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16, background: '#fff', border: '1px solid #e2e0d6', borderRadius: 10, padding: 14 }}>
        <Picker label="Branch" value={branchCode} onChange={setBranchCode} options={branchCodes} />
        <Picker label="Term / test" value={termId} onChange={setTermId}
          options={terms.map((t) => ({ value: t.id, label: t.name }))} placeholder="— Pick —" />
        <Picker label="Class" value={className} onChange={setClassName} options={(classes || []).map((c) => c.name || c)} placeholder="— Pick —" />
        <Picker label="Section (optional)" value={section} onChange={setSection} options={['A', 'B', 'C', 'D']} placeholder="All" />
        <button onClick={build} disabled={loading || !termId || !className} style={{ ...btn, background: '#1a4a2e', color: '#fff' }}>
          {loading ? 'Building…' : 'Build crosslist'}
        </button>
      </div>

      {error && <div style={{ color: '#b3261e', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {data && (
        <div style={{ background: '#fff', border: '1px solid #e2e0d6', borderRadius: 10, padding: 14, overflowX: 'auto' }}>
          <div style={{ fontSize: 13, color: '#777', marginBottom: 10 }}>
            {data.term.name} · {className}{section ? ` - ${section}` : ''} · {data.students.length} students · AB = absent · — = not entered
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e0d6' }}>
                <th style={th}>Roll</th>
                <th style={{ ...th, textAlign: 'left' }}>Student</th>
                {data.subjects.map((s) => <th key={s.id} style={th}>{s.name}<div style={{ fontSize: 9.5, color: '#999', fontWeight: 500 }}>/{s.maxMarks}</div></th>)}
                <th style={th}>Total</th><th style={th}>%</th><th style={th}>Rank</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{r.rollNumber || '—'}</td>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                  {data.subjects.map((s) => {
                    const c = r.marks[s.id]
                    return <td key={s.id} style={{ ...td, color: !c || !c.entered ? '#bbb' : c.absent ? '#b3261e' : '#222', fontWeight: c && c.entered && !c.absent ? 600 : 400 }}>{cellText(c)}</td>
                  })}
                  <td style={{ ...td, fontWeight: 700 }}>{r.hasAny ? `${r.total}/${r.maxTotal}` : '—'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.percent != null ? r.percent.toFixed(1) : '—'}</td>
                  <td style={{ ...td, fontWeight: 700, color: r.rank <= 3 ? '#1a4a2e' : '#222' }}>{r.rank ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Picker({ label, value, onChange, options, placeholder }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#666', minWidth: 140 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d9d6cb', fontSize: 13, background: '#fff' }}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value
          const l = typeof o === 'string' ? o : o.label
          return <option key={v} value={v}>{l}</option>
        })}
      </select>
    </label>
  )
}

const btn = { padding: '9px 16px', borderRadius: 8, border: '1px solid #d9d6cb', background: '#fff', color: '#1a4a2e', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const th = { padding: '7px 8px', fontSize: 11, fontWeight: 700, color: '#666', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', textAlign: 'center' }
