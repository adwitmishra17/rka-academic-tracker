// ============================================================================
// admin/src/pages/Students.jsx
//
// Read-only viewer for student records sourced from the SMS Supabase database
// (the single source of truth). Add / edit / withdraw / delete all happen in
// the SMS portal — this page just lists what's there.
//
// Data path:  React → /api/students (admin/server.js with service-role key)
//                  → Supabase public.students table
//
// If you change which fields are displayed here, also update the field
// transform in admin/server.js → toFrontendStudent().
// ============================================================================

import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClasses } from '../hooks/useClasses'
import { useAuth }    from '../App'
import { apiGet }     from '../lib/api'

const inputStyle = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:14, fontFamily:'var(--font-body)', color:'var(--text)', outline:'none', background:'var(--white)' }

export default function Students() {
  const { classNames: CLASSES } = useClasses()
  const { effectiveBranches, currentBranch } = useAuth()
  const navigate = useNavigate()

  const [students,       setStudents]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [loadError,      setLoadError]      = useState('')
  const [filterClass,    setFilterClass]    = useState('All')
  const [search,         setSearch]         = useState('')
  const [showWithdrawn,  setShowWithdrawn]  = useState(false)

  // Load students from /api/students. When a branch is selected, scope the
  // query to it; otherwise load across all of the caller's effective branches.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setLoadError('')
      try {
        if (currentBranch) {
          const { students } = await apiGet('/api/students', { branchCode: currentBranch })
          if (!cancelled) setStudents(students)
        } else {
          // Fan out across allowed branches and merge.
          const results = await Promise.all(
            (effectiveBranches || []).map(b => apiGet('/api/students', { branchCode: b }))
          )
          if (!cancelled) setStudents(results.flatMap(r => r.students))
        }
      } catch (e) {
        console.error('Students.load:', e)
        if (!cancelled) setLoadError(e.message || 'Failed to load students')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentBranch, JSON.stringify(effectiveBranches)])

  // Client-side filter
  const filtered = useMemo(() => students.filter(s => {
    const matchClass  = filterClass === 'All' || s.className === filterClass
    const matchSearch = !search
      || s.fullName?.toLowerCase().includes(search.toLowerCase())
      || s.rollNumber?.includes(search)
      || s.admissionNo?.toLowerCase().includes(search.toLowerCase())
    const matchActive = showWithdrawn ? true : s.isActive
    return matchClass && matchSearch && matchActive
  }), [students, filterClass, search, showWithdrawn])

  // Sort: class order then roll number
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (a.className !== b.className) return (a.className || '').localeCompare(b.className || '')
    return Number(a.rollNumber || 0) - Number(b.rollNumber || 0)
  }), [filtered])

  // Stats
  const total       = students.length
  const activeCount = students.filter(s => s.isActive).length
  const byClass     = CLASSES.reduce((acc, c) => {
    acc[c] = students.filter(s => s.className === c).length
    return acc
  }, {})

  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>

      {/* Header */}
      <div className="fade-in" style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
          <div>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Students</h1>
            <p style={{ fontSize:14, color:'var(--text-muted)' }}>Read-only view of the SMS student database</p>
            <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
          </div>
          <button
            onClick={() => navigate('/students-audit')}
            style={{ padding:'10px 18px', background:'var(--white)', color:'var(--green-dark)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}
          >
            View audit log
          </button>
        </div>
      </div>

      {/* Source-of-truth notice */}
      <div style={{
        background:'var(--gold-light)', border:'1px solid rgba(201,162,39,0.35)',
        borderRadius:'var(--radius-md)', padding:'12px 16px', marginBottom:20,
        display:'flex', gap:10, alignItems:'flex-start',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2" style={{ flexShrink:0, marginTop:2 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <div style={{ fontSize:12.5, color:'var(--gold-dark)', lineHeight:1.55 }}>
          Student records are managed in the <strong>SMS portal</strong> (admissions, withdrawals, class promotions, edits).
          This view is read-only and reflects the SMS database in real time.
        </div>
      </div>

      {/* Error banner */}
      {loadError && (
        <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-md)', padding:'12px 16px', marginBottom:18, color:'var(--crimson)', fontSize:13 }}>
          Failed to load students: {loadError}
        </div>
      )}

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:24 }}>
        <div style={{ background:'var(--green)', borderRadius:'var(--radius-lg)', padding:'16px 18px', color:'white' }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600 }}>{total}</div>
          <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>Total students</div>
        </div>
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'16px 18px', border:'1px solid var(--gray-100)' }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, color:'var(--green-dark)' }}>{activeCount}</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>Active</div>
        </div>
        {Object.entries(byClass).filter(([, v]) => v > 0).slice(0, 4).map(([cls, count]) => (
          <div key={cls} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'16px 18px', border:'1px solid var(--gray-100)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, color:'var(--text)' }}>{count}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{cls}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:200 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, roll number, or admission no…"
            style={{ ...inputStyle, paddingLeft:34 }}
          />
        </div>
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          <option value="All">All classes</option>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
        <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'9px 12px', background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)' }}>
          <input type="checkbox" checked={showWithdrawn} onChange={e => setShowWithdrawn(e.target.checked)} />
          Show withdrawn
        </label>
        <div style={{ fontSize:13, color:'var(--text-muted)' }}>{sorted.length} students</div>
      </div>

      {/* Student table */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}>
          <div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} />
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign:'center', padding:56, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
          <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.8">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            </svg>
          </div>
          <p style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--text)', marginBottom:6 }}>
            {students.length === 0 ? 'No students in the SMS database yet' : 'No students match the current filters'}
          </p>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>
            {students.length === 0
              ? 'Add students through the SMS portal — they will appear here automatically.'
              : 'Try clearing the search or selecting a different class.'}
          </p>
        </div>
      ) : (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)' }}>
                  {['Roll No.', 'Name', 'Admission No.', 'Class', 'Optional', 'Parent Phone', 'Status'].map(h => (
                    <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/students/${s.id}`)}
                    style={{
                      borderBottom:'1px solid var(--gray-50)',
                      background: i%2===0 ? 'var(--white)' : 'var(--gray-50)',
                      opacity: s.isActive ? 1 : 0.6,
                      cursor:'pointer',
                    }}
                  >
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)', fontWeight:500 }}>{s.rollNumber || '—'}</td>
                    <td style={{ padding:'11px 16px', fontWeight:500, color:'var(--text)' }}>{s.fullName}</td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)', fontFamily:'var(--font-mono)', fontSize:12 }}>{s.admissionNo || '—'}</td>
                    <td style={{ padding:'11px 16px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{s.className}</span>
                    </td>
                    <td style={{ padding:'11px 16px' }}>
                      {s.optionalSubject
                        ? <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)', fontWeight:500 }}>{s.optionalSubject}</span>
                        : <span style={{ color:'var(--gray-400)', fontSize:12 }}>—</span>}
                    </td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{s.parentPhone || '—'}</td>
                    <td style={{ padding:'11px 16px' }}>
                      {s.isActive ? (
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>Active</span>
                      ) : (
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--gray-100)', color:'var(--text-muted)', fontWeight:500 }}>Withdrawn</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
