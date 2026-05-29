import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { examApi, hpcApi } from '../lib/api'
import { HPC_CLASSES, DOMAINS, RATINGS } from '../lib/hpcConstants'

/* ============================================================
   HPC Cards (Tracker mirror of SMS) — list + admin override + print.
   Reads SMS Supabase via admin/server.js (/api/hpc).
   ============================================================ */

const card = { background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }
const sel = { padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, color:'var(--text)', background:'var(--white)', outline:'none', minWidth:130 }
const th = { textAlign:'left', padding:'9px 10px', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--gray-100)' }
const td = { padding:'8px 10px', fontSize:13, borderBottom:'1px solid var(--gray-50)' }
const ghost = { padding:'5px 10px', background:'var(--white)', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:12, cursor:'pointer' }
const primary = { padding:'7px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:12.5, fontWeight:500, cursor:'pointer' }
const taStyle = { width:'100%', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit', fontSize:13, padding:'8px 10px', borderRadius:8, border:'1px solid var(--gray-200)', outline:'none' }

export default function HpcCards() {
  const navigate = useNavigate()
  const { allowedBranches = [], currentBranch, isSuperAdmin } = useAuth()

  const [branchCode, setBranch] = useState(currentBranch || allowedBranches[0] || '')
  const [sessions, setSessions] = useState([])
  const [sessionCode, setSession] = useState('')
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [className, setClassName] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ domains:{}, general_remarks:'' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { examApi.sessions().then(({ sessions }) => { setSessions(sessions); if (sessions[0]) setSession(s => s || sessions[0]) }).catch(e => setError(e.message)) }, [])

  useEffect(() => {
    setTerms([]); setTermId('')
    if (!branchCode || !sessionCode) return
    examApi.terms(branchCode, sessionCode).then(({ terms }) => { setTerms(terms); if (terms[0]) setTermId(terms[0].id) }).catch(e => setError(e.message))
  }, [branchCode, sessionCode])

  function load() {
    setRows([])
    if (!branchCode || !termId || !className) return
    setLoading(true); setError(null)
    hpcApi.list(branchCode, termId, className).then(({ assessments }) => setRows(assessments)).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [branchCode, termId, className]) // eslint-disable-line

  function openEdit(row) {
    const base = {}
    for (const d of DOMAINS) { const ex = row.domains?.[d.key] || {}; base[d.key] = { rating: ex.rating || '', remarks: ex.remarks || '' } }
    setDraft({ domains: base, general_remarks: row.general_remarks || '' })
    setEditing(row)
  }
  function setDomainField(key, field, value) {
    setDraft(prev => ({ ...prev, domains: { ...prev.domains, [key]: { ...prev.domains[key], [field]: value } } }))
  }
  async function saveOverride() {
    setSaving(true); setError(null)
    try {
      const merged = { ...(editing.domains || {}) }
      for (const d of DOMAINS) {
        const dr = draft.domains[d.key] || {}
        merged[d.key] = { ...(editing.domains?.[d.key] || {}), rating: dr.rating || null, remarks: dr.remarks?.trim() ? dr.remarks.trim() : null }
      }
      await hpcApi.override(editing.id, merged, draft.general_remarks)
      setEditing(null); load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  async function handleVoid(row) {
    const reason = window.prompt(`Void HPC for ${row.student_name}? Reason:`)
    if (!reason?.trim()) return
    try { await hpcApi.void(row.id, reason.trim()); load() } catch (e) { setError(e.message) }
  }

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>
      <div className="fade-in" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>HPC Cards</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Holistic Progress Cards (Nursery–Class 2). View, admin-override, and print — read live from the SMS database.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      <div style={{ ...card, padding:'14px 16px', marginBottom:16, display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Branch<div><select value={branchCode} onChange={e => setBranch(e.target.value)} style={sel}>{allowedBranches.map(b => <option key={b} value={b}>{b}</option>)}</select></div></label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Session<div><select value={sessionCode} onChange={e => setSession(e.target.value)} style={sel}>{sessions.length===0 && <option value="">—</option>}{sessions.map(s => <option key={s} value={s}>{s}</option>)}</select></div></label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Term<div><select value={termId} onChange={e => setTermId(e.target.value)} style={sel}><option value="">{terms.length?'Pick a term':'No terms'}</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div></label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Class<div><select value={className} onChange={e => setClassName(e.target.value)} style={sel}><option value="">Pick a class</option>{HPC_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}</select></div></label>
      </div>

      {error && <div style={{ background:'#fde8e8', color:'var(--crimson)', padding:'10px 14px', borderRadius:'var(--radius-md)', fontSize:13, marginBottom:16 }}>{error}</div>}

      <div style={card}>
        <div style={{ padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>
          Assessments {rows.length ? `(${rows.length})` : ''}
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr><th style={th}>Student</th><th style={th}>Adm</th><th style={th}>Sec</th><th style={th}>Roll</th><th style={th}>Source</th><th style={{ ...th, textAlign:'right' }}></th></tr></thead>
          <tbody>
            {!loading && !className && <tr><td style={{ ...td, color:'var(--text-muted)', textAlign:'center', padding:22 }} colSpan={6}>Pick a term &amp; class to list assessments.</td></tr>}
            {loading && <tr><td style={{ ...td, color:'var(--text-muted)', textAlign:'center', padding:22 }} colSpan={6}>Loading…</td></tr>}
            {!loading && className && rows.length===0 && <tr><td style={{ ...td, color:'var(--text-muted)', textAlign:'center', padding:22 }} colSpan={6}>No assessments — they appear once the teacher PWA submits them.</td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight:500 }}>{r.student_name}</td>
                <td style={{ ...td, color:'var(--text-muted)' }}>{r.admission_no || '—'}</td>
                <td style={{ ...td, color:'var(--text-muted)' }}>{r.section || '—'}</td>
                <td style={{ ...td, color:'var(--text-muted)' }}>{r.roll_number || '—'}</td>
                <td style={td}><span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:999, background:r.source==='manual'?'rgba(255,149,0,0.12)':'rgba(52,199,89,0.12)', color:r.source==='manual'?'#a55b00':'#0a7d3a' }}>{r.source === 'manual' ? 'Manual' : r.source === 'academic_tracker' ? 'Tracker' : 'Teacher PWA'}</span></td>
                <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                  <button onClick={() => openEdit(r)} style={ghost}>Override</button>{' '}
                  <button onClick={() => navigate(`/hpc/print?id=${r.id}`)} style={ghost}>Print</button>
                  {isSuperAdmin && <>{' '}<button onClick={() => handleVoid(r)} style={{ ...ghost, color:'var(--crimson)', borderColor:'rgba(139,26,26,0.3)' }}>Void</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={() => !saving && setEditing(null)}>
          <div style={{ background:'var(--white)', borderRadius:14, padding:20, width:'min(640px,100%)', maxHeight:'86vh', overflowY:'auto', border:'1px solid var(--gray-100)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--green-dark)', marginBottom:4 }}>Override HPC — {editing.student_name}</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>Saved as a manual override; the mirror won't overwrite it. The teacher's per-indicator detail is preserved.</div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {DOMAINS.map(d => (
                <div key={d.key} style={{ borderBottom:'1px solid var(--gray-100)', paddingBottom:10 }}>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>{d.name}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:8, alignItems:'start' }}>
                    <select value={draft.domains[d.key]?.rating || ''} onChange={e => setDomainField(d.key, 'rating', e.target.value)} style={sel}>
                      <option value="">— rating —</option>{RATINGS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <textarea value={draft.domains[d.key]?.remarks || ''} onChange={e => setDomainField(d.key, 'remarks', e.target.value)} placeholder="Remarks (optional)" rows={2} style={ taStyle } />
                  </div>
                </div>
              ))}
              <div>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>General remarks</div>
                <textarea value={draft.general_remarks} onChange={e => setDraft(d => ({ ...d, general_remarks: e.target.value }))} rows={3} style={ taStyle } />
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
              <button onClick={() => setEditing(null)} style={ghost}>Cancel</button>
              <button onClick={saveOverride} disabled={saving} style={primary}>{saving ? 'Saving…' : 'Save override'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
