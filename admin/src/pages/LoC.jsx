import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { examApi, locApi } from '../lib/api'
import { EXAM_CLASSES, STATUSES, CWSN_CATEGORIES, toCsv } from '../lib/locConstants'

/* Board Candidates — CBSE List of Candidates (Tracker mirror of SMS LoC). */

const card = { background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }
const sel = { padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, color:'var(--text)', background:'var(--white)', outline:'none', minWidth:120 }
const th = { textAlign:'left', padding:'9px 10px', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--gray-100)' }
const td = { padding:'8px 10px', fontSize:13, borderBottom:'1px solid var(--gray-50)' }
const ghost = { padding:'5px 10px', background:'var(--white)', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:12, cursor:'pointer' }
const primary = { padding:'8px 16px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer' }
const field = { width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, outline:'none' }
const overlay = { position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }
const modal = { background:'var(--white)', borderRadius:14, padding:20, width:'min(680px,100%)', maxHeight:'88vh', overflowY:'auto', border:'1px solid var(--gray-100)' }
const STATUS_COLOR = { draft:'#777', submitted:'#1e40af', finalised:'#0a7d3a', withdrawn:'var(--crimson)' }

export default function LoC() {
  const { allowedBranches = [], currentBranch } = useAuth()
  const [branchCode, setBranch] = useState(currentBranch || allowedBranches[0] || '')
  const [sessions, setSessions] = useState([])
  const [sessionCode, setSession] = useState('')
  const [examClass, setExamClass] = useState('12')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [enrolOpen, setEnrolOpen] = useState(false)
  const [eligible, setEligible] = useState([])
  const [picked, setPicked] = useState(new Set())
  const [enrolling, setEnrolling] = useState(false)

  const [editing, setEditing] = useState(null)   // candidate row
  const [form, setForm] = useState({})
  const [subjOptions, setSubjOptions] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { examApi.sessions().then(({ sessions }) => { setSessions(sessions); if (sessions[0]) setSession(s => s || sessions[0]) }).catch(e => setError(e.message)) }, [])

  function load() {
    setRows([])
    if (!branchCode || !sessionCode) return
    setLoading(true); setError(null)
    locApi.list({ branchCode, sessionCode, examClass, status: status || undefined, q: q || undefined })
      .then(({ candidates }) => setRows(candidates)).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [branchCode, sessionCode, examClass, status]) // eslint-disable-line

  async function openEnrol() {
    setError(null)
    try { const { students } = await locApi.eligible(branchCode, sessionCode, examClass); setEligible(students); setPicked(new Set()); setEnrolOpen(true) }
    catch (e) { setError(e.message) }
  }
  async function doEnrol() {
    setEnrolling(true); setError(null)
    try {
      for (const sid of picked) await locApi.enrol(sid, sessionCode, examClass)
      setEnrolOpen(false); load()
    } catch (e) { setError(e.message) } finally { setEnrolling(false) }
  }

  async function openEdit(row) {
    setEditing(row)
    setForm({
      candidate_name: row.candidate_name || '', father_name: row.father_name || '', mother_name: row.mother_name || '',
      date_of_birth: row.date_of_birth || '', gender: row.gender || '', nationality: row.nationality || 'Indian',
      category: row.category || '', religion: row.religion || '', aadhaar_no: row.aadhaar_no || '', apaar_id: row.apaar_id || '',
      identification_mark_1: row.identification_mark_1 || '', identification_mark_2: row.identification_mark_2 || '',
      science_path: row.science_path || '', subject_codes: row.subject_codes || [],
      is_cwsn: !!row.is_cwsn, cwsn_category: row.cwsn_category || '', needs_scribe: !!row.needs_scribe, needs_extra_time: !!row.needs_extra_time,
    })
    try { const { subjects } = await locApi.subjects(row.exam_class, row.stream); setSubjOptions(subjects) } catch { setSubjOptions([]) }
  }
  function toggleSubject(code) {
    setForm(f => { const has = (f.subject_codes || []).includes(code); return { ...f, subject_codes: has ? f.subject_codes.filter(c => c !== code) : [...(f.subject_codes||[]), code] } })
  }
  async function saveEdit() {
    setSaving(true); setError(null)
    try {
      const names = subjOptions.filter(s => (form.subject_codes||[]).includes(s.code)).map(s => s.name).join(', ')
      await locApi.update(editing.id, { ...form, subject_names: names })
      setEditing(null); load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  async function finalise(row) { try { await locApi.finalise(row.id); load() } catch (e) { setError(e.message) } }
  async function withdraw(row) { const r = window.prompt('Withdraw reason?'); if (r == null) return; try { await locApi.withdraw(row.id, r); load() } catch (e) { setError(e.message) } }
  async function remove(row) { if (!window.confirm(`Delete candidate ${row.candidate_name}? This cannot be undone.`)) return; try { await locApi.remove(row.id); load() } catch (e) { setError(e.message) } }

  function exportCsv() {
    const csv = toCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `LoC_${branchCode}_${examClass}_${sessionCode}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div style={{ padding:'24px 28px', maxWidth:1150 }}>
      <div className="fade-in" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Board Candidates (CBSE LoC)</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>List of Candidates for Class 10 (AISSE) / Class 12 (AISSCE). Enrol → fill CBSE fields → finalise → export CSV for the portal.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      <div style={{ ...card, padding:'14px 16px', marginBottom:16, display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Branch<div><select value={branchCode} onChange={e => setBranch(e.target.value)} style={sel}>{allowedBranches.map(b => <option key={b} value={b}>{b}</option>)}</select></div></label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Session<div><select value={sessionCode} onChange={e => setSession(e.target.value)} style={sel}>{sessions.length===0 && <option value="">—</option>}{sessions.map(s => <option key={s} value={s}>{s}</option>)}</select></div></label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Exam class<div><select value={examClass} onChange={e => setExamClass(e.target.value)} style={sel}>{EXAM_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div></label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Status<div><select value={status} onChange={e => setStatus(e.target.value)} style={sel}><option value="">All</option>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div></label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Search<div><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key==='Enter' && load()} placeholder="Name / Aadhaar / APAAR" style={sel} /></div></label>
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          <button onClick={openEnrol} disabled={!branchCode || !sessionCode} style={primary}>+ Enrol students</button>
          <button onClick={exportCsv} disabled={!rows.length} style={ghost}>Export CSV</button>
        </div>
      </div>

      {error && <div style={{ background:'#fde8e8', color:'var(--crimson)', padding:'10px 14px', borderRadius:'var(--radius-md)', fontSize:13, marginBottom:16 }}>{error}</div>}

      <div style={card}>
        <div style={{ padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Candidates {rows.length ? `(${rows.length})` : ''}</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:760 }}>
            <thead><tr><th style={th}>Candidate</th><th style={th}>Adm</th><th style={th}>Stream</th><th style={th}>Subjects</th><th style={th}>Status</th><th style={{ ...th, textAlign:'right' }}></th></tr></thead>
            <tbody>
              {loading && <tr><td style={{ ...td, textAlign:'center', color:'var(--text-muted)', padding:22 }} colSpan={6}>Loading…</td></tr>}
              {!loading && rows.length===0 && <tr><td style={{ ...td, textAlign:'center', color:'var(--text-muted)', padding:22 }} colSpan={6}>No candidates. Use “Enrol students”.</td></tr>}
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ ...td, fontWeight:500 }}>{r.candidate_name}</td>
                  <td style={{ ...td, color:'var(--text-muted)' }}>{r.students?.admission_no || '—'}</td>
                  <td style={{ ...td, color:'var(--text-muted)' }}>{r.stream || (r.exam_class==='10'?'—':'')}{r.science_path ? ` (${r.science_path})` : ''}</td>
                  <td style={{ ...td, color:'var(--text-muted)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(r.subject_codes||[]).join('+') || '—'}</td>
                  <td style={td}><span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:999, background:'var(--gray-50)', color:STATUS_COLOR[r.status] || '#777' }}>{r.status}</span></td>
                  <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                    <button onClick={() => openEdit(r)} style={ghost}>Edit</button>{' '}
                    {r.status !== 'finalised' && r.status !== 'withdrawn' && <><button onClick={() => finalise(r)} style={ghost}>Finalise</button>{' '}</>}
                    {r.status !== 'withdrawn' && <><button onClick={() => withdraw(r)} style={ghost}>Withdraw</button>{' '}</>}
                    <button onClick={() => remove(r)} style={{ ...ghost, color:'var(--crimson)', borderColor:'rgba(139,26,26,0.3)' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Enrol modal */}
      {enrolOpen && (
        <div style={overlay} onClick={() => !enrolling && setEnrolOpen(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--green-dark)', marginBottom:4 }}>Enrol students — {EXAM_CLASSES.find(c=>c.value===examClass)?.label}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:12 }}>Eligible students not already enrolled for this session.</div>
            <div style={{ maxHeight:'48vh', overflowY:'auto', border:'1px solid var(--gray-100)', borderRadius:8 }}>
              {eligible.length===0 ? <div style={{ padding:20, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No eligible students.</div> :
                eligible.map(s => (
                  <label key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderBottom:'1px solid var(--gray-50)', cursor:'pointer' }}>
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => setPicked(p => { const n = new Set(p); n.has(s.id)?n.delete(s.id):n.add(s.id); return n })} />
                    <span style={{ fontSize:13 }}>{s.full_name}</span>
                    <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:'auto' }}>{s.class_name} · {s.admission_no || '—'} · Roll {s.roll_number || '—'}</span>
                  </label>
                ))}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
              <button onClick={() => setEnrolOpen(false)} style={ghost}>Cancel</button>
              <button onClick={doEnrol} disabled={enrolling || picked.size===0} style={primary}>{enrolling ? 'Enrolling…' : `Enrol ${picked.size}`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div style={overlay} onClick={() => !saving && setEditing(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--green-dark)', marginBottom:12 }}>Edit candidate — {editing.candidate_name}</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Fld label="Candidate name"><input style={field} value={form.candidate_name} onChange={e => setF('candidate_name', e.target.value)} /></Fld>
              <Fld label="Date of birth"><input style={field} type="date" value={form.date_of_birth || ''} onChange={e => setF('date_of_birth', e.target.value)} /></Fld>
              <Fld label="Father name"><input style={field} value={form.father_name} onChange={e => setF('father_name', e.target.value)} /></Fld>
              <Fld label="Mother name"><input style={field} value={form.mother_name} onChange={e => setF('mother_name', e.target.value)} /></Fld>
              <Fld label="Gender"><input style={field} value={form.gender} onChange={e => setF('gender', e.target.value)} /></Fld>
              <Fld label="Nationality"><input style={field} value={form.nationality} onChange={e => setF('nationality', e.target.value)} /></Fld>
              <Fld label="Category"><input style={field} value={form.category} onChange={e => setF('category', e.target.value)} /></Fld>
              <Fld label="Religion"><input style={field} value={form.religion} onChange={e => setF('religion', e.target.value)} /></Fld>
              <Fld label="Aadhaar No."><input style={field} value={form.aadhaar_no} onChange={e => setF('aadhaar_no', e.target.value)} /></Fld>
              <Fld label="APAAR ID"><input style={field} value={form.apaar_id} onChange={e => setF('apaar_id', e.target.value)} /></Fld>
              <Fld label="Identification mark 1"><input style={field} value={form.identification_mark_1} onChange={e => setF('identification_mark_1', e.target.value)} /></Fld>
              <Fld label="Identification mark 2"><input style={field} value={form.identification_mark_2} onChange={e => setF('identification_mark_2', e.target.value)} /></Fld>
              {editing.exam_class === '12' && <Fld label="Science path (PCM/PCB)"><input style={field} value={form.science_path} onChange={e => setF('science_path', e.target.value)} /></Fld>}
            </div>

            <div style={{ marginTop:14 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', marginBottom:6 }}>Subjects ({(form.subject_codes||[]).length})</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {subjOptions.length===0 ? <span style={{ fontSize:12, color:'var(--text-muted)' }}>No subjects loaded.</span> :
                  subjOptions.map(s => {
                    const on = (form.subject_codes||[]).includes(s.code)
                    return <button key={s.code} onClick={() => toggleSubject(s.code)} style={{ padding:'5px 10px', borderRadius:16, border:'1px solid', borderColor:on?'var(--green)':'var(--gray-200)', background:on?'var(--green)':'var(--white)', color:on?'#fff':'var(--text-muted)', fontSize:11.5, cursor:'pointer' }}>{s.code} {s.name}</button>
                  })}
              </div>
            </div>

            <div style={{ marginTop:14, padding:'10px 12px', background:'var(--gray-50)', borderRadius:8 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13 }}><input type="checkbox" checked={form.is_cwsn} onChange={e => setF('is_cwsn', e.target.checked)} /> CWSN (child with special needs)</label>
              {form.is_cwsn && (
                <div style={{ display:'flex', gap:14, marginTop:8, flexWrap:'wrap', alignItems:'center' }}>
                  <select style={sel} value={form.cwsn_category} onChange={e => setF('cwsn_category', e.target.value)}><option value="">Category…</option>{CWSN_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                  <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={form.needs_scribe} onChange={e => setF('needs_scribe', e.target.checked)} /> Needs scribe</label>
                  <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={form.needs_extra_time} onChange={e => setF('needs_extra_time', e.target.checked)} /> Extra time</label>
                </div>
              )}
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
              <button onClick={() => setEditing(null)} style={ghost}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} style={primary}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Fld({ label, children }) {
  return <label style={{ fontSize:11.5, color:'var(--text-muted)' }}>{label}<div style={{ marginTop:3 }}>{children}</div></label>
}
