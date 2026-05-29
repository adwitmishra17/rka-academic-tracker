import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { useClasses } from '../hooks/useClasses'
import { examApi } from '../lib/api'

/* ============================================================
   Report Cards (Tracker mirror of SMS)

   Reads the SMS Supabase via admin/server.js (/api/exam/*).
   Stage: VIEW — pick branch + session + class → student list →
   computed marks grid (subjects × terms + totals + co-scholastic).
   Override + printable card are added in later sub-stages.
   ============================================================ */

const card = { background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }
const selStyle = { padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none', minWidth:140 }
const th = { textAlign:'left', padding:'9px 10px', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--gray-100)' }
const td = { padding:'8px 10px', fontSize:13, borderBottom:'1px solid var(--gray-50)' }
const btnGhost   = { padding:'7px 14px', background:'var(--white)', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:12.5, fontWeight:500, cursor:'pointer' }
const btnPrimary = { padding:'7px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:12.5, fontWeight:500, cursor:'pointer' }

export default function ReportCards() {
  const navigate = useNavigate()
  const { allowedBranches = [], currentBranch } = useAuth()
  const { classNames: CLASSES = [] } = useClasses()

  const [sessions, setSessions]   = useState([])
  const [branchCode, setBranch]   = useState(currentBranch || allowedBranches[0] || '')
  const [sessionCode, setSession] = useState('')
  const [className, setClassName] = useState('')
  const [students, setStudents]   = useState([])
  const [selectedId, setSelected] = useState(null)
  const [cardData, setCardData]   = useState(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingCard, setLoadingCard] = useState(false)
  const [error, setError]         = useState(null)
  const [editMode, setEditMode]   = useState(false)
  const [draft, setDraft]         = useState({})
  const [savingMarks, setSaving]  = useState(false)

  useEffect(() => { if (!branchCode && (currentBranch || allowedBranches[0])) setBranch(currentBranch || allowedBranches[0]) }, [currentBranch, allowedBranches]) // eslint-disable-line

  useEffect(() => {
    examApi.sessions()
      .then(({ sessions }) => { setSessions(sessions); if (sessions[0]) setSession(s => s || sessions[0]) })
      .catch(e => setError(e.message))
  }, [])

  useEffect(() => {
    setStudents([]); setSelected(null); setCardData(null)
    if (!branchCode || !className) return
    setLoadingList(true); setError(null)
    examApi.reportCardStudents(branchCode, className)
      .then(({ students }) => setStudents(students))
      .catch(e => setError(e.message))
      .finally(() => setLoadingList(false))
  }, [branchCode, className])

  useEffect(() => {
    setCardData(null); setEditMode(false)
    if (!selectedId || !sessionCode) return
    setLoadingCard(true); setError(null)
    examApi.reportCard(selectedId, sessionCode)
      .then(({ card }) => setCardData(card))
      .catch(e => setError(e.message))
      .finally(() => setLoadingCard(false))
  }, [selectedId, sessionCode])

  const terms = cardData?.terms || []

  function startEdit() {
    const d = {}
    for (const row of (cardData?.grid || [])) {
      for (const t of terms) {
        const c = row.byTerm[t.id]
        if (c?.paperId) d[`${row.subject.id}|${t.id}`] = { paperId: c.paperId, marks: c.marks == null ? '' : String(c.marks), absent: !!c.absent }
      }
    }
    setDraft(d); setEditMode(true)
  }
  function setCell(key, patch) {
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], ...patch, dirty: true } }))
  }
  async function saveOverrides() {
    const rows = Object.values(draft).filter(d => d.dirty)
      .map(d => ({ paperId: d.paperId, studentId: selectedId, marksObtained: d.absent ? null : d.marks, isAbsent: !!d.absent }))
    if (!rows.length) { setEditMode(false); return }
    setSaving(true); setError(null)
    try {
      await examApi.saveMarks(rows)
      const { card } = await examApi.reportCard(selectedId, sessionCode)
      setCardData(card); setEditMode(false)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>
      <div className="fade-in" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Report Cards</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>View a student's consolidated marks across the session's terms. Data is read live from the SMS database.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {/* Filters */}
      <div style={{ ...card, padding:'14px 16px', marginBottom:16, display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Branch
          <div><select value={branchCode} onChange={e => setBranch(e.target.value)} style={selStyle}>
            {allowedBranches.map(b => <option key={b} value={b}>{b}</option>)}
          </select></div>
        </label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Session
          <div><select value={sessionCode} onChange={e => setSession(e.target.value)} style={selStyle}>
            {sessions.length === 0 && <option value="">No sessions</option>}
            {sessions.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        </label>
        <label style={{ fontSize:12, color:'var(--text-muted)' }}>Class
          <div><select value={className} onChange={e => setClassName(e.target.value)} style={selStyle}>
            <option value="">Pick a class</option>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        </label>
      </div>

      {error && <div style={{ background:'var(--crimson-light, #fde8e8)', color:'var(--crimson)', padding:'10px 14px', borderRadius:'var(--radius-md)', fontSize:13, marginBottom:16 }}>{error}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:18 }}>
        {/* Student list */}
        <div style={card}>
          <div style={{ padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>
            Students {students.length ? `(${students.length})` : ''}
          </div>
          <div style={{ maxHeight:'62vh', overflowY:'auto' }}>
            {loadingList ? (
              <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>Loading…</div>
            ) : !className ? (
              <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>Pick a class to list students.</div>
            ) : students.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No students.</div>
            ) : students.map(s => (
              <button key={s.id} onClick={() => setSelected(s.id)} style={{ width:'100%', textAlign:'left', padding:'9px 14px', border:'none', borderBottom:'1px solid var(--gray-50)', background:selectedId===s.id?'var(--green-light)':'var(--white)', cursor:'pointer' }}>
                <div style={{ fontSize:13, fontWeight:selectedId===s.id?600:500, color:selectedId===s.id?'var(--green-dark)':'var(--text)' }}>{s.full_name}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)' }}>{s.admission_no || '—'} · Roll {s.roll_number || '—'}{s.section ? ` · ${s.section}` : ''}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Report card grid */}
        <div style={card}>
          {!selectedId ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>Select a student to view their report card.</div>
          ) : loadingCard ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>Loading report card…</div>
          ) : !cardData ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No data.</div>
          ) : (
            <div style={{ padding:'16px 18px' }}>
              <div style={{ marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:'var(--green-dark)', fontFamily:'var(--font-display)' }}>{cardData.student.full_name}</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                    {cardData.student.class_name}{cardData.student.section ? `-${cardData.student.section}` : ''} · {cardData.student.branches?.code} · Session {cardData.sessionCode}
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                  {!editMode ? (
                    <>
                      <button onClick={() => navigate(`/report-cards/print?studentId=${selectedId}&sessionCode=${encodeURIComponent(sessionCode)}`)} style={btnGhost}>Print card</button>
                      <button onClick={startEdit} disabled={!cardData.grid.length} style={btnGhost}>Override marks</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setEditMode(false)} style={btnGhost}>Cancel</button>
                      <button onClick={saveOverrides} disabled={savingMarks} style={btnPrimary}>{savingMarks ? 'Saving…' : 'Save overrides'}</button>
                    </>
                  )}
                </div>
              </div>
              {editMode && (
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10 }}>
                  Editing marks — changed cells are saved as a <strong>manual override</strong> and the mirror won't overwrite them. Tick <strong>A</strong> for absent.
                </div>
              )}

              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:480 }}>
                  <thead>
                    <tr>
                      <th style={th}>Subject</th>
                      {terms.map(t => <th key={t.id} style={{ ...th, textAlign:'center' }}>{t.short_code || t.name}</th>)}
                      <th style={{ ...th, textAlign:'center' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardData.grid.length === 0 && (
                      <tr><td style={{ ...td, color:'var(--text-muted)' }} colSpan={terms.length + 2}>No scholastic subjects / papers configured for this class &amp; session.</td></tr>
                    )}
                    {cardData.grid.map(row => (
                      <tr key={row.subject.id}>
                        <td style={{ ...td, fontWeight:500 }}>{row.subject.subject_name}</td>
                        {terms.map(t => {
                          const c = row.byTerm[t.id]
                          const key = `${row.subject.id}|${t.id}`
                          const d = draft[key]
                          return (
                            <td key={t.id} style={{ ...td, textAlign:'center', color:'var(--text-muted)' }}>
                              {editMode && c?.paperId ? (
                                <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                                  <input type="number" min="0" value={d?.absent ? '' : (d?.marks ?? '')} disabled={d?.absent}
                                    onChange={e => setCell(key, { marks: e.target.value })}
                                    style={{ width:46, padding:'3px 4px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:12, textAlign:'center' }} />
                                  <span style={{ fontSize:10 }}>/{c.max}</span>
                                  <label title="Absent" style={{ fontSize:10, display:'inline-flex', alignItems:'center', gap:2 }}>
                                    <input type="checkbox" checked={!!d?.absent} onChange={e => setCell(key, { absent: e.target.checked })} />A
                                  </label>
                                </span>
                              ) : (
                                !c || !('marks' in c) ? '—'
                                  : c.absent ? 'ABS'
                                  : c.marks == null ? '—'
                                  : <span><strong style={{ color:'var(--text)' }}>{c.marks}</strong>/{c.max}{c.grade ? <span style={{ color:'var(--green)', fontWeight:600 }}> {c.grade.grade}</span> : ''}</span>
                              )}
                            </td>
                          )
                        })}
                        <td style={{ ...td, textAlign:'center' }}>
                          {row.total.max > 0
                            ? <span><strong>{row.total.obtained}</strong>/{row.total.max} {row.total.grade ? <span style={{ color:'var(--green)', fontWeight:600 }}>{row.total.grade.grade}</span> : ''}</span>
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {cardData.overall.max > 0 && (
                    <tfoot>
                      <tr>
                        <td style={{ ...td, fontWeight:700, borderTop:'2px solid var(--gray-100)' }}>Overall</td>
                        <td style={{ ...td, borderTop:'2px solid var(--gray-100)' }} colSpan={terms.length}></td>
                        <td style={{ ...td, textAlign:'center', fontWeight:700, borderTop:'2px solid var(--gray-100)' }}>
                          {cardData.overall.obtained}/{cardData.overall.max} · {cardData.overall.pct != null ? cardData.overall.pct.toFixed(1) : '—'}% {cardData.overall.grade ? cardData.overall.grade.grade : ''}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {cardData.coScholastic?.length > 0 && (
                <div style={{ marginTop:18 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>Co-scholastic</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {cardData.coScholastic.map(co => (
                      <div key={co.name} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', background:'var(--green-light)', borderRadius:20, border:'1px solid var(--green-muted)' }}>
                        <span style={{ fontSize:12.5, color:'var(--green-dark)' }}>{co.name}</span>
                        <strong style={{ fontSize:12.5, color:'var(--green-dark)' }}>{co.grade}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
