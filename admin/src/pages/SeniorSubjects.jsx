// ============================================================================
// admin/src/pages/SeniorSubjects.jsx
//
// Class 11 & 12 subject report. Two downloads from one load:
//   1. Optional subjects — each senior student and the elective they opted.
//   2. All subjects — each student's full resolved subject list (class core
//      − science-path drop + optional), the same set the exam cards use.
//
// Sources (both the SMS database, via the admin backend):
//   students  →  /api/students        (optionalSubject, sciencePath)
//   catalogue →  /api/exam/subjects   (per class, per branch)
// Mirrors the SMS portal's "Senior subjects" report.
// ============================================================================

import React, { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../App'
import { apiGet, examApi } from '../lib/api'
import { SENIOR_CLASSES, isSeniorClass, resolveSubjects } from '../lib/seniorSubjects'
import { exportOptionalPDF, exportAllSubjectsPDF } from '../lib/seniorSubjectsPdf'

const inputStyle = { padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:14, fontFamily:'var(--font-body)', color:'var(--text)', outline:'none', background:'var(--white)' }
const btnGhost = { padding:'9px 15px', background:'var(--white)', color:'var(--green-dark)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', display:'inline-flex', alignItems:'center', gap:6 }
const btnPrimary = { ...btnGhost, background:'var(--green)', color:'white', border:'1px solid var(--green)' }
const dlLabel = { fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' }
const th = { textAlign:'left', padding:'10px 12px', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', background:'var(--gray-50)', whiteSpace:'nowrap', borderBottom:'1px solid var(--gray-200)' }
const td = { padding:'10px 12px', fontSize:13, color:'var(--text)', verticalAlign:'top', borderBottom:'1px solid var(--gray-100)' }

function defaultSession() {
  const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String(y + 1).slice(2)}`
}

const hasStream = (c) => /Science|Commerce|Humanities/.test(String(c || ''))

// Worklist status: what the office still needs to set in SMS student-edit.
function statusOf(r) {
  if (r.needsStream) return { label: 'Set stream', color: 'var(--crimson)' }
  if (!r.optionalSubject) return { label: 'Set optional', color: 'var(--gold-dark)' }
  return { label: 'Complete', color: 'var(--green-dark)' }
}

function downloadCsv(filename, rows, columns) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.get(r))).join(','))].join('\r\n')
  const blob = new Blob(['﻿', csv], { type:'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}

export default function SeniorSubjects() {
  const { currentBranch, effectiveBranches } = useAuth()

  const [sessions, setSessions]     = useState([])
  const [sessionCode, setSessionCode] = useState('')
  const [className, setClassName]   = useState('')   // '' = all six senior classes
  const [rows, setRows]             = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [exporting, setExporting]   = useState(null)

  useEffect(() => {
    examApi.sessions()
      .then(({ sessions: s, current }) => { setSessions(s || []); setSessionCode((c) => c || current || defaultSession()) })
      .catch(() => setSessionCode((c) => c || defaultSession()))
  }, [])

  const branchCodes = currentBranch ? [currentBranch] : (effectiveBranches || [])
  const branchLabel = currentBranch || 'all branches'

  async function load() {
    if (!sessionCode || !branchCodes.length) return
    setLoading(true); setError(''); setRows(null)
    try {
      // Senior students across the caller's branch scope.
      const studentResults = await Promise.all(branchCodes.map((b) => apiGet('/api/students', { branchCode: b })))
      let students = studentResults.flatMap((r) => r.students || []).filter((s) => s.isActive && isSeniorClass(s.className))
      if (className) students = students.filter((s) => s.className === className)

      // Subject catalogue per (branch, class), with a class-level union fallback.
      const classesNeeded = className ? [className] : SENIOR_CLASSES
      const cat = new Map()
      await Promise.all(branchCodes.flatMap((b) => classesNeeded.map(async (c) => {
        try {
          const { subjects } = await examApi.subjects(b, sessionCode, c)
          cat.set(`${b}|${c}`, subjects || [])
          cat.set(c, (cat.get(c) || []).concat(subjects || []))
        } catch { /* class not set up for this branch — skip */ }
      })))

      const resolved = students.map((s) => ({
        ...s,
        needsStream: !hasStream(s.className),
        subjects: resolveSubjects(s, cat.get(`${s.branchCode}|${s.className}`) || cat.get(s.className) || []),
      })).sort((a, b) =>
        (a.className || '').localeCompare(b.className || '')
        || (a.section || '').localeCompare(b.section || '')
        || Number(a.rollNumber || 0) - Number(b.rollNumber || 0)
        || (a.fullName || '').localeCompare(b.fullName || ''))

      setRows(resolved)
    } catch (e) {
      setError(e.message || String(e))
    } finally { setLoading(false) }
  }

  const optionalCounts = useMemo(() => {
    const m = new Map()
    for (const r of (rows || [])) { const k = r.optionalSubject || '— none —'; m.set(k, (m.get(k) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const summary = useMemo(() => {
    let complete = 0, noOpt = 0, noStream = 0
    for (const r of (rows || [])) { if (r.needsStream) noStream++; else if (!r.optionalSubject) noOpt++; else complete++ }
    return { complete, noOpt, noStream }
  }, [rows])

  const fileBase = `senior-subjects-${(currentBranch || 'all').toLowerCase()}-${className ? className.replace(/\s+/g, '-') : 'class-11-12'}-${new Date().toISOString().slice(0, 10)}`

  function downloadOptional() {
    if (!rows?.length) return
    downloadCsv(`${fileBase}-optional.csv`, rows, [
      { label:'Student Name',    get:(r) => r.fullName },
      { label:'Admission No',    get:(r) => r.admissionNo },
      { label:'Class',           get:(r) => r.className },
      { label:'Section',         get:(r) => r.section || '' },
      { label:'Roll No',         get:(r) => r.rollNumber || '' },
      { label:'Science Path',    get:(r) => r.sciencePath || '' },
      { label:'Optional Subject', get:(r) => r.optionalSubject || '' },
      { label:'Status',          get:(r) => statusOf(r).label },
    ])
  }
  function downloadAll() {
    if (!rows?.length) return
    downloadCsv(`${fileBase}-all.csv`, rows, [
      { label:'Student Name',    get:(r) => r.fullName },
      { label:'Admission No',    get:(r) => r.admissionNo },
      { label:'Class',           get:(r) => r.className },
      { label:'Section',         get:(r) => r.section || '' },
      { label:'Roll No',         get:(r) => r.rollNumber || '' },
      { label:'Science Path',    get:(r) => r.sciencePath || '' },
      { label:'Optional Subject', get:(r) => r.optionalSubject || '' },
      { label:'No. of Subjects', get:(r) => r.subjects.length },
      { label:'Subjects',        get:(r) => r.subjects.join('; ') },
      { label:'Status',          get:(r) => statusOf(r).label },
    ])
  }
  async function downloadPDF(kind) {
    if (!rows?.length) return
    setExporting(kind)
    try {
      const meta = { branch: currentBranch || '', className, session: sessionCode }
      if (kind === 'optional-pdf') await exportOptionalPDF(rows, meta)
      else await exportAllSubjectsPDF(rows, meta)
    } catch (e) { setError(e.message || String(e)) }
    finally { setExporting(null) }
  }

  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
          <div>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Senior Subjects</h1>
            <p style={{ fontSize:14, color:'var(--text-muted)' }}>Class 11 & 12 — optional subjects opted, and each student’s full subject list</p>
            <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
          </div>
          {rows?.length > 0 && (
            <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={dlLabel}>Optional</span>
                <button onClick={downloadOptional} style={btnGhost}>CSV</button>
                <button onClick={() => downloadPDF('optional-pdf')} style={btnGhost} disabled={!!exporting}>{exporting === 'optional-pdf' ? '…' : 'PDF'}</button>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={dlLabel}>All subjects</span>
                <button onClick={downloadAll} style={btnGhost}>CSV</button>
                <button onClick={() => downloadPDF('all-pdf')} style={btnGhost} disabled={!!exporting}>{exporting === 'all-pdf' ? '…' : 'PDF'}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:18, flexWrap:'wrap', alignItems:'center' }}>
        <select value={sessionCode} onChange={(e) => { setSessionCode(e.target.value); setRows(null) }} style={inputStyle}>
          {[...new Set([sessionCode, ...sessions, defaultSession()])].filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={className} onChange={(e) => { setClassName(e.target.value); setRows(null) }} style={inputStyle}>
          <option value="">All Class 11 & 12</option>
          {SENIOR_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={load} disabled={loading} style={{ ...btnPrimary, opacity:loading ? 0.6 : 1 }}>
          {loading ? 'Loading…' : 'Show subjects'}
        </button>
        <span style={{ fontSize:12.5, color:'var(--text-muted)' }}>{branchLabel}</span>
      </div>

      {error && (
        <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-md)', padding:'12px 16px', marginBottom:18, color:'var(--crimson)', fontSize:13 }}>
          {error}
        </div>
      )}

      {rows && (
        <>
          {/* Optional distribution */}
          <div style={{ background:'var(--white)', border:'1px solid var(--gray-100)', borderRadius:'var(--radius-lg)', padding:'16px 18px', marginBottom:16 }}>
            <div style={{ fontSize:12.5, color:'var(--text-muted)', marginBottom:10 }}>
              {rows.length} students in {className || 'Class 11 & 12'} · {sessionCode}
            </div>
            {(summary.noOpt > 0 || summary.noStream > 0) && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 11px', borderRadius:999, background:'var(--green-light)', border:'1px solid rgba(26,74,46,0.2)', fontSize:12.5, color:'var(--green-dark)' }}>Complete <b>{summary.complete}</b></span>
                {summary.noOpt > 0 && <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 11px', borderRadius:999, background:'var(--gold-light)', border:'1px solid rgba(201,162,39,0.35)', fontSize:12.5, color:'var(--gold-dark)' }}>Set optional in SMS <b>{summary.noOpt}</b></span>}
                {summary.noStream > 0 && <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 11px', borderRadius:999, background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.2)', fontSize:12.5, color:'var(--crimson)' }}>Set stream in SMS <b>{summary.noStream}</b></span>}
              </div>
            )}
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {optionalCounts.map(([name, n]) => (
                <span key={name} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 11px', borderRadius:999, background:'var(--gray-50)', border:'1px solid var(--gray-200)', fontSize:12.5, color:'var(--text)' }}>
                  {name} <b style={{ color:'var(--green-dark)' }}>{n}</b>
                </span>
              ))}
              {rows.length === 0 && <span style={{ color:'var(--text-muted)', fontSize:13 }}>No senior students match.</span>}
            </div>
          </div>

          {rows.length > 0 && (
            <div style={{ background:'var(--white)', border:'1px solid var(--gray-100)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>#</th>
                      <th style={th}>Student</th>
                      <th style={th}>Adm. No</th>
                      <th style={th}>Class</th>
                      <th style={th}>Path</th>
                      <th style={th}>Optional</th>
                      <th style={th}>All subjects</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id || i}>
                        <td style={{ ...td, color:'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ ...td, fontWeight:600 }}>{r.fullName}</td>
                        <td style={td}>{r.admissionNo}</td>
                        <td style={{ ...td, color:r.needsStream ? 'var(--crimson)' : 'var(--text)' }}>{r.className}{r.section ? '-' + r.section : ''}</td>
                        <td style={td}>{r.sciencePath || '—'}</td>
                        <td style={{ ...td, fontWeight:600, color:'var(--green-dark)' }}>{r.optionalSubject || '—'}</td>
                        <td style={{ ...td, color:'var(--text-muted)' }}>
                          {r.subjects.length ? <>{r.subjects.join(', ')} <span style={{ color:'var(--gray-400)' }}>({r.subjects.length})</span></> : '—'}
                        </td>
                        <td style={{ ...td, fontSize:11.5, fontWeight:600, color:statusOf(r).color, whiteSpace:'nowrap' }}>{statusOf(r).label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
