import React, { useState, useEffect } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints } from '../lib/branchQuery'

// CLASSES loaded via useClasses({ includeAll: true })

export default function Absentees() {
  const { classNames: CLASSES } = useClasses({ includeAll: true })
  const { effectiveBranches } = useAuth()
  const [marks, setMarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterClass, setFilterClass] = useState('All')
  const [filterSubject, setFilterSubject] = useState('All')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('test') // test | student

  useEffect(() => {
    async function load() {
      try {
        const [marksSnap, studentsSnap, testsSnap] = await Promise.all([
          getDocs(query(collection(db, 'testMarks'), where('isAbsent', '==', true), ...branchConstraints('branchCode', effectiveBranches))),
          getDocs(query(collection(db, 'students'), ...branchConstraints('branchCode', effectiveBranches))),
          getDocs(query(collection(db, 'tests'), ...branchConstraints('branchCode', effectiveBranches))),
        ])
        const testIds = new Set(testsSnap.docs.map(d => d.id))
        // Build a set of active student names (trimmed, lowercase for robust matching)
        const activeNamesLower = new Set(
          studentsSnap.docs
            .map(d => d.data())
            .filter(s => s.isActive !== false)
            .map(s => (s.fullName || '').trim().toLowerCase())
        )
        const allMarks = marksSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        // Filter: only show absences for students still in the active students list
        const filtered = allMarks.filter(m => {
          const name = (m.studentName || '').trim().toLowerCase()
          return name && activeNamesLower.has(name) && testIds.has(m.testId)
        })
        // Deduplicate by testId + rollNumber — keep most recent
        const dedupMap = {}
        filtered.forEach(m => {
          const key = `${m.testId}__${String(m.rollNumber || '').trim()}`
          const existing = dedupMap[key]
          if (!existing) { dedupMap[key] = m; return }
          const t1 = m.createdAt?.toMillis?.() || 0
          const t2 = existing.createdAt?.toMillis?.() || 0
          if (t1 > t2) dedupMap[key] = m
        })
        setMarks(Object.values(dedupMap))
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [effectiveBranches])

  const subjects = ['All', ...new Set(marks.map(m => m.subject).filter(Boolean))].sort()

  const filtered = marks.filter(m => {
    const matchClass = filterClass === 'All' || m.className === filterClass
    const matchSubject = filterSubject === 'All' || m.subject === filterSubject
    const matchSearch = !search || m.studentName?.toLowerCase().includes(search.toLowerCase()) || m.rollNumber?.includes(search)
    return matchClass && matchSubject && matchSearch
  })

  // Group by test
  const byTest = filtered.reduce((acc, m) => {
    const key = `${m.testName}||${m.className}||${m.subject}||${m.testDate}`
    if (!acc[key]) acc[key] = { testName: m.testName, className: m.className, subject: m.subject, testDate: m.testDate, students: [] }
    acc[key].students.push(m)
    return acc
  }, {})

  // Group by student
  const byStudent = filtered.reduce((acc, m) => {
    const key = `${m.studentName}||${m.rollNumber}||${m.className}`
    if (!acc[key]) acc[key] = { name: m.studentName, roll: m.rollNumber, className: m.className, absences: [] }
    acc[key].absences.push(m)
    return acc
  }, {})

  const studentList = Object.values(byStudent).sort((a, b) => b.absences.length - a.absences.length)
  const consecutiveFlags = studentList.filter(s => {
    const sorted = s.absences.sort((a,b) => (a.testDate||'').localeCompare(b.testDate||''))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].subject === sorted[i-1].subject) return true
    }
    return false
  })

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Absentee List</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Students who missed tests — grouped by test or student</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:20 }}>
        {[
          { label:'Total absences', value: filtered.length, color:'var(--crimson)' },
          { label:'Unique students', value: Object.keys(byStudent).length, color:'var(--text)' },
          { label:'Tests affected', value: Object.keys(byTest).length, color:'var(--gold-dark)' },
          { label:'Consecutive flags', value: consecutiveFlags.length, color:'var(--crimson)' },
        ].map(s => (
          <div key={s.label} style={{ background: s.color === 'var(--crimson)' ? 'var(--crimson-light)' : 'var(--white)', borderRadius:'var(--radius-lg)', padding:'14px 16px', border:`1px solid ${s.color === 'var(--crimson)' ? 'rgba(139,26,26,0.15)' : 'var(--gray-100)'}` }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color: s.color, lineHeight:1 }}>{s.value}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Consecutive absence warning */}
      {consecutiveFlags.length > 0 && (
        <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-md)', padding:'14px 18px', marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--crimson)', marginBottom:8 }}>⚠ {consecutiveFlags.length} student{consecutiveFlags.length > 1 ? 's' : ''} with consecutive absences in the same subject</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {consecutiveFlags.map(s => (
              <span key={s.name} style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'var(--crimson)', color:'white', fontWeight:500 }}>
                {s.name} ({s.absences.length}×)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:180 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or roll…" style={{ width:'100%', padding:'9px 10px 9px 30px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }} />
        </div>
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} style={{ padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          {subjects.map(s => <option key={s}>{s}</option>)}
        </select>
        <div style={{ display:'flex', background:'var(--gray-50)', borderRadius:'var(--radius-md)', padding:3, border:'1px solid var(--gray-100)' }}>
          {[['test','By Test'],['student','By Student']].map(([k,l]) => (
            <button key={k} onClick={() => setGroupBy(k)} style={{ padding:'6px 14px', borderRadius:'var(--radius-sm)', border:'none', fontSize:12, fontWeight:500, cursor:'pointer', background: groupBy===k ? 'var(--white)' : 'transparent', color: groupBy===k ? 'var(--green)' : 'var(--text-muted)', boxShadow: groupBy===k ? 'var(--shadow-sm)' : 'none' }}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:64, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
          <div style={{ fontSize:32, marginBottom:12 }}>✓</div>
          <p style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--green-dark)', marginBottom:4 }}>No absentees</p>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>No students have missed tests matching your filters.</p>
        </div>
      ) : groupBy === 'test' ? (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {Object.values(byTest).sort((a,b) => (b.testDate||'').localeCompare(a.testDate||'')).map((test, i) => (
            <div key={i} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid rgba(139,26,26,0.12)', overflow:'hidden' }}>
              <div style={{ padding:'13px 18px', background:'var(--crimson-light)', borderBottom:'1px solid rgba(139,26,26,0.1)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:'var(--crimson)' }}>{test.testName}</div>
                  <div style={{ fontSize:12, color:'rgba(139,26,26,0.7)', marginTop:2 }}>{test.className} · {test.subject} · {test.testDate}</div>
                </div>
                <span style={{ background:'var(--crimson)', color:'white', fontSize:13, fontWeight:600, padding:'4px 12px', borderRadius:20 }}>{test.students.length} absent</span>
              </div>
              <div style={{ padding:'12px 18px', display:'flex', flexWrap:'wrap', gap:8 }}>
                {test.students.sort((a,b) => Number(a.rollNumber||0) - Number(b.rollNumber||0)).map(s => (
                  <div key={s.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)', border:'1px solid var(--gray-100)' }}>
                    <div style={{ width:24, height:24, borderRadius:'50%', background:'var(--crimson-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:11, fontWeight:600, color:'var(--crimson)' }}>{(s.studentName||'?')[0]}</span>
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{s.studentName}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>Roll {s.rollNumber || '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--gray-50)' }}>
                {['Rank','Student','Roll','Class','Tests Missed','Subjects','Last Absent'].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studentList.map((s, i) => {
                const isConsecutive = consecutiveFlags.some(f => f.name === s.name)
                const subjectList = [...new Set(s.absences.map(a => a.subject))].join(', ')
                const lastAbsent = s.absences.sort((a,b) => (b.testDate||'').localeCompare(a.testDate||''))[0]?.testDate
                return (
                  <tr key={s.name} style={{ borderTop:'1px solid var(--gray-50)', background: isConsecutive ? 'var(--crimson-light)' : i%2===0 ? 'var(--white)' : 'var(--gray-50)' }}>
                    <td style={{ padding:'11px 14px', fontWeight:600, color: i < 3 ? 'var(--crimson)' : 'var(--text-muted)' }}>#{i+1}</td>
                    <td style={{ padding:'11px 14px', fontWeight:500, color:'var(--text)' }}>
                      {s.name}
                      {isConsecutive && <span style={{ marginLeft:6, fontSize:11, padding:'2px 7px', borderRadius:8, background:'var(--crimson)', color:'white', fontWeight:600 }}>Consecutive</span>}
                    </td>
                    <td style={{ padding:'11px 14px', color:'var(--text-muted)' }}>{s.roll || '—'}</td>
                    <td style={{ padding:'11px 14px' }}><span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{s.className}</span></td>
                    <td style={{ padding:'11px 14px', textAlign:'center' }}>
                      <span style={{ fontSize:13, fontWeight:700, color:'var(--crimson)' }}>{s.absences.length}</span>
                    </td>
                    <td style={{ padding:'11px 14px', color:'var(--text-muted)', fontSize:12 }}>{subjectList}</td>
                    <td style={{ padding:'11px 14px', color:'var(--text-muted)', fontSize:12 }}>{lastAbsent || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
