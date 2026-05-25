import React, { useState, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints } from '../lib/branchQuery'

// CLASSES loaded via useClasses()

function Medal({ rank }) {
  if (rank === 1) return <span style={{ fontSize:16 }}>🥇</span>
  if (rank === 2) return <span style={{ fontSize:16 }}>🥈</span>
  if (rank === 3) return <span style={{ fontSize:16 }}>🥉</span>
  return <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:600, minWidth:20, display:'inline-block', textAlign:'center' }}>{rank}</span>
}

function ScoreBadge({ pct, passMarks, maxMarks }) {
  const passing = maxMarks > 0 ? (passMarks / maxMarks) * 100 : 40
  const color = pct >= 80 ? 'var(--green)' : pct >= passing ? 'var(--gold-dark)' : 'var(--crimson)'
  const bg = pct >= 80 ? 'var(--green-light)' : pct >= passing ? 'var(--gold-light)' : 'var(--crimson-light)'
  return (
    <span style={{ fontSize:12, fontWeight:600, padding:'3px 9px', borderRadius:10, background:bg, color, whiteSpace:'nowrap' }}>
      {pct}%
    </span>
  )
}

export default function StudentPerformance() {
  const { classNames: CLASSES } = useClasses()
  const { effectiveBranches } = useAuth()
  const [selectedClass, setSelectedClass] = useState('Class 9')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [subjects, setSubjects] = useState([])
  const [tests, setTests] = useState([])
  const [marks, setMarks] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState('avg') // avg | name | roll

  // Load subjects from tests when class changes
  useEffect(() => {
    async function loadSubjects() {
      const snap = await getDocs(query(collection(db, 'tests'), where('className', '==', selectedClass), ...branchConstraints('branchCode', effectiveBranches)))
      const subs = [...new Set(snap.docs.map(d => d.data().subject).filter(Boolean))].sort()
      setSubjects(subs)
      setSelectedSubject(subs[0] || '')
    }
    loadSubjects()
  }, [selectedClass, effectiveBranches])

  // Load data when class+subject changes
  useEffect(() => {
    if (!selectedSubject) return
    async function load() {
      setLoading(true)
      try {
        const [testsSnap, marksSnap, studentsSnap] = await Promise.all([
          getDocs(query(collection(db, 'tests'), where('className', '==', selectedClass), where('subject', '==', selectedSubject), ...branchConstraints('branchCode', effectiveBranches))),
          getDocs(query(collection(db, 'testMarks'), where('className', '==', selectedClass), where('subject', '==', selectedSubject), ...branchConstraints('branchCode', effectiveBranches))),
          getDocs(query(collection(db, 'students'), where('className', '==', selectedClass), ...branchConstraints('branchCode', effectiveBranches))),
        ])
        setTests(testsSnap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => (a.testDate||'').localeCompare(b.testDate||'')))
        setMarks(marksSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        setStudents(studentsSnap.docs.map(d => ({ id:d.id, ...d.data() })))
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [selectedClass, selectedSubject, effectiveBranches])

  // Build student performance data
  const studentNames = students.length > 0
    ? students.map(s => ({ name: s.fullName, roll: s.rollNumber }))
    : [...new Set(marks.map(m => m.studentName))].map(n => ({ name: n, roll: marks.find(m => m.studentName === n)?.rollNumber || '' }))

  // Filter out orphaned marks — only use marks whose testId matches a current test
  const validTestIds = new Set(tests.map(t => t.id))
  const validMarks = marks.filter(m => validTestIds.has(m.testId))

  const perfData = studentNames.map(({ name, roll }) => {
    const studentMarks = validMarks.filter(m => m.studentName === name)
    const appeared = studentMarks.filter(m => !m.isAbsent)
    const absent = studentMarks.filter(m => m.isAbsent)
    const totalObtained = appeared.reduce((s, m) => s + Number(m.marksObtained || 0), 0)
    const totalMax = appeared.reduce((s, m) => s + Number(m.maxMarks || 0), 0)
    const avgPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : null
    const testResults = tests.map(t => {
      const m = studentMarks.find(m => m.testId === t.id)
      if (!m) return { marks: null, pct: null, absent: false, notEntered: true }
      if (m.isAbsent) return { marks: 0, pct: 0, absent: true, notEntered: false }
      const pct = Number(t.maxMarks) > 0 ? Math.round((Number(m.marksObtained || 0) / Number(t.maxMarks)) * 100) : 0
      return { marks: Number(m.marksObtained || 0), pct, absent: false, notEntered: false }
    })
    return { name, roll, avgPct, appeared: appeared.length, absent: absent.length, testResults }
  }).filter(s => s.appeared > 0 || s.absent > 0)

  // Sort
  const sorted = [...perfData].sort((a, b) => {
    if (sortBy === 'avg') return (b.avgPct ?? -1) - (a.avgPct ?? -1)
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'roll') return (Number(a.roll) || 0) - (Number(b.roll) || 0)
    return 0
  })

  // Class averages per test
  const classAvg = tests.map(t => {
    const tm = marks.filter(m => m.testId === t.id && !m.isAbsent)
    return tm.length > 0 ? Math.round(tm.reduce((s, m) => s + Number(m.marksObtained || 0), 0) / tm.length) : null
  })

  return (
    <div style={{ padding:'24px 28px', maxWidth:1300 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Student Performance</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Class & subject-wise marks in descending order</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {/* Class selector */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16 }}>
        {CLASSES.map(c => (
          <button key={c} onClick={() => setSelectedClass(c)} style={{ padding:'7px 13px', borderRadius:20, border:'1px solid', borderColor: selectedClass===c ? 'var(--green)' : 'var(--gray-200)', background: selectedClass===c ? 'var(--green)' : 'var(--white)', color: selectedClass===c ? 'white' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
            {c}
          </button>
        ))}
      </div>

      {/* Subject selector */}
      {subjects.length > 0 && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:20 }}>
          {subjects.map(s => (
            <button key={s} onClick={() => setSelectedSubject(s)} style={{ padding:'6px 13px', borderRadius:20, border:'1px solid', borderColor: selectedSubject===s ? 'var(--gold-dark)' : 'var(--gray-200)', background: selectedSubject===s ? 'var(--gold-light)' : 'var(--white)', color: selectedSubject===s ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {subjects.length === 0 && !loading && (
        <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:14 }}>
          No tests found for {selectedClass}. Schedule tests first.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : tests.length > 0 && (
        <>
          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:20 }}>
            {[
              { label:'Students', value: sorted.length },
              { label:'Tests', value: tests.length },
              { label:'Class avg', value: sorted.length > 0 ? `${Math.round(sorted.filter(s=>s.avgPct!==null).reduce((a,s)=>a+(s.avgPct||0),0)/Math.max(sorted.filter(s=>s.avgPct!==null).length,1))}%` : '—', color:'var(--green)' },
              { label:'Top scorer', value: sorted[0]?.avgPct ? `${sorted[0].avgPct}%` : '—', color:'var(--gold-dark)' },
              { label:'Need attention', value: sorted.filter(s => s.avgPct !== null && s.avgPct < 40).length, color:'var(--crimson)' },
            ].map(s => (
              <div key={s.label} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'14px 16px', border:'1px solid var(--gray-100)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color: s.color || 'var(--text)', lineHeight:1 }}>{s.value}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Sort controls */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:500 }}>Sort by:</span>
            {[['avg','Average %'],['name','Name'],['roll','Roll No.']].map(([k,l]) => (
              <button key={k} onClick={() => setSortBy(k)} style={{ padding:'5px 12px', borderRadius:16, border:'1px solid', borderColor: sortBy===k ? 'var(--green)' : 'var(--gray-200)', background: sortBy===k ? 'var(--green-light)' : 'var(--white)', color: sortBy===k ? 'var(--green)' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer' }}>
                {l}
              </button>
            ))}
            <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)' }}>{selectedClass} · {selectedSubject}</span>
          </div>

          {/* Performance table */}
          {sorted.length === 0 ? (
            <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:14 }}>
              No marks entered for {selectedSubject} yet.
            </div>
          ) : (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr style={{ background:'var(--green-dark)' }}>
                      <th style={{ padding:'11px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.7)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>Rank</th>
                      <th style={{ padding:'11px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.7)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Student</th>
                      <th style={{ padding:'11px 14px', textAlign:'center', fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.7)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Roll</th>
                      {tests.map((t, i) => (
                        <th key={t.id} style={{ padding:'11px 10px', textAlign:'center', fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.7)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap', minWidth:80 }}>
                          <div>{t.testName?.slice(0,10) || `Test ${i+1}`}</div>
                          <div style={{ fontSize:10, opacity:0.6, fontWeight:400 }}>{t.testDate}</div>
                        </th>
                      ))}
                      <th style={{ padding:'11px 14px', textAlign:'center', fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.9)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap', background:'rgba(201,162,39,0.2)' }}>Average</th>
                      <th style={{ padding:'11px 10px', textAlign:'center', fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.7)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Absent</th>
                    </tr>
                    {/* Class average row */}
                    <tr style={{ background:'var(--green-light)', borderBottom:'2px solid var(--green-muted)' }}>
                      <td colSpan={3} style={{ padding:'8px 14px', fontSize:11, fontWeight:600, color:'var(--green-dark)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Class Average</td>
                      {classAvg.map((avg, i) => (
                        <td key={i} style={{ padding:'8px 10px', textAlign:'center', fontSize:12, fontWeight:600, color:'var(--green-dark)' }}>
                          {avg !== null ? `${avg}` : '—'}
                        </td>
                      ))}
                      <td style={{ padding:'8px 14px', textAlign:'center', fontSize:12, fontWeight:700, color:'var(--green-dark)', background:'rgba(201,162,39,0.1)' }}>
                        {sorted.length > 0 ? `${Math.round(sorted.filter(s=>s.avgPct!==null).reduce((a,s)=>a+(s.avgPct||0),0)/Math.max(sorted.filter(s=>s.avgPct!==null).length,1))}%` : '—'}
                      </td>
                      <td></td>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s, idx) => {
                      const rank = sortBy === 'avg' ? idx + 1 : null
                      const rowBg = idx % 2 === 0 ? 'var(--white)' : 'var(--gray-50)'
                      const isTopThree = sortBy === 'avg' && idx < 3
                      return (
                        <tr key={s.name} style={{ borderTop:'1px solid var(--gray-50)', background: isTopThree ? (idx===0 ? '#fffdf0' : rowBg) : rowBg }}>
                          <td style={{ padding:'12px 14px' }}>
                            <Medal rank={rank || idx+1} />
                          </td>
                          <td style={{ padding:'12px 14px', fontWeight: isTopThree ? 600 : 500, color:'var(--text)' }}>
                            {s.name}
                          </td>
                          <td style={{ padding:'12px 10px', textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>{s.roll || '—'}</td>
                          {s.testResults.map((r, ti) => (
                            <td key={ti} style={{ padding:'12px 10px', textAlign:'center' }}>
                              {r.notEntered ? (
                                <span style={{ fontSize:11, color:'var(--gray-400)' }}>—</span>
                              ) : r.absent ? (
                                <span style={{ fontSize:11, padding:'2px 7px', borderRadius:8, background:'var(--crimson-light)', color:'var(--crimson)', fontWeight:500 }}>Absent</span>
                              ) : (
                                <div>
                                  <div style={{ fontWeight:600, color:'var(--text)', marginBottom:2 }}>{r.marks}/{tests[ti]?.maxMarks}</div>
                                  <ScoreBadge pct={r.pct} passMarks={tests[ti]?.passMarks} maxMarks={tests[ti]?.maxMarks} />
                                </div>
                              )}
                            </td>
                          ))}
                          <td style={{ padding:'12px 14px', textAlign:'center', background:'rgba(201,162,39,0.05)', borderLeft:'1px solid var(--gray-100)' }}>
                            {s.avgPct !== null ? (
                              <ScoreBadge pct={s.avgPct} passMarks={40} maxMarks={100} />
                            ) : '—'}
                          </td>
                          <td style={{ padding:'12px 10px', textAlign:'center' }}>
                            {s.absent > 0 ? (
                              <span style={{ fontSize:12, padding:'2px 7px', borderRadius:8, background:'var(--crimson-light)', color:'var(--crimson)', fontWeight:600 }}>{s.absent}</span>
                            ) : (
                              <span style={{ fontSize:12, color:'var(--green)' }}>✓</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
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
