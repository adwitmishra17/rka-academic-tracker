import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, where, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { isAccessible } from '../lib/branchQuery'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

function ScoreBadge({ marks, maxMarks, passMarks }) {
  const pct = maxMarks > 0 ? Math.round((marks / maxMarks) * 100) : 0
  const passing = maxMarks > 0 ? Math.round((passMarks / maxMarks) * 100) : 40
  const color = pct >= 80 ? 'var(--green)' : pct >= passing ? 'var(--gold-dark)' : 'var(--crimson)'
  const bg = pct >= 80 ? 'var(--green-light)' : pct >= passing ? 'var(--gold-light)' : 'var(--crimson-light)'
  return (
    <span style={{ fontSize:12, fontWeight:600, padding:'3px 9px', borderRadius:10, background:bg, color }}>
      {pct}%
    </span>
  )
}

function Medal({ rank }) {
  if (rank === 1) return <span style={{ fontSize:15 }}>🥇</span>
  if (rank === 2) return <span style={{ fontSize:15 }}>🥈</span>
  if (rank === 3) return <span style={{ fontSize:15 }}>🥉</span>
  return <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:600, minWidth:22, display:'inline-block', textAlign:'center' }}>{rank}</span>
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload
    return (
      <div style={{ background:'var(--white)', border:'1px solid var(--gray-100)', borderRadius:8, padding:'10px 14px', boxShadow:'var(--shadow-md)', fontSize:12 }}>
        <div style={{ fontWeight:600, color:'var(--text)', marginBottom:4 }}>{label}</div>
        {d.absent ? (
          <div style={{ color:'var(--crimson)' }}>Absent</div>
        ) : (
          <>
            <div style={{ color:'var(--text-muted)' }}>Marks: <strong style={{ color:'var(--text)' }}>{d.marks}/{d.max}</strong></div>
            <div style={{ color:'var(--text-muted)' }}>Score: <strong style={{ color: d.pct >= 80 ? 'var(--green)' : d.pct >= 40 ? 'var(--gold-dark)' : 'var(--crimson)' }}>{d.pct}%</strong></div>
          </>
        )}
      </div>
    )
  }
  return null
}

export default function TestDetail() {
  const { testId } = useParams()
  const navigate = useNavigate()
  const { effectiveBranches } = useAuth()
  const [test, setTest] = useState(null)
  const [marks, setMarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('marks') // marks | name | roll

  useEffect(() => {
    async function load() {
      try {
        const [testDoc, marksSnap] = await Promise.all([
          getDoc(doc(db, 'tests', testId)),
          getDocs(query(collection(db, 'testMarks'), where('testId', '==', testId)))
        ])
        if (testDoc.exists()) {
          const t = { id: testDoc.id, ...testDoc.data() }
          // Defense in depth: bounce if a branch admin guesses a test URL
          // for a test belonging to the other branch.
          if (!isAccessible(t.branchCode, effectiveBranches)) {
            navigate('/tests')
            return
          }
          setTest(t)
        }
        // Deduplicate by rollNumber — keep most recent entry only
        const rawMarks = marksSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        const dedupByRoll = {}
        rawMarks.forEach(m => {
          const key = String(m.rollNumber || '').trim() || m.id  // fallback to docId if no rollNumber
          const existing = dedupByRoll[key]
          if (!existing) { dedupByRoll[key] = m; return }
          const t1 = m.createdAt?.toMillis?.() || 0
          const t2 = existing.createdAt?.toMillis?.() || 0
          if (t1 > t2) dedupByRoll[key] = m
        })
        setMarks(Object.values(dedupByRoll))
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [testId])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    </div>
  )

  if (!test) return (
    <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>Test not found.</div>
  )

  const appeared = marks.filter(m => !m.isAbsent)
  const absent = marks.filter(m => m.isAbsent)
  const totalMarks = appeared.reduce((s, m) => s + Number(m.marksObtained || 0), 0)
  const avg = appeared.length > 0 ? Math.round(totalMarks / appeared.length) : 0
  const avgPct = Number(test.maxMarks) > 0 ? Math.round((avg / Number(test.maxMarks)) * 100) : 0
  const highest = appeared.length > 0 ? Math.max(...appeared.map(m => Number(m.marksObtained || 0))) : 0
  const lowest = appeared.length > 0 ? Math.min(...appeared.map(m => Number(m.marksObtained || 0))) : 0
  const passed = appeared.filter(m => Number(m.marksObtained || 0) >= Number(test.passMarks || 0)).length
  const passRate = appeared.length > 0 ? Math.round((passed / appeared.length) * 100) : 0

  // Clean up duplicate testMarks entries for this test
  async function handleDedupe() {
    if (!confirm('This will scan test records for duplicate student entries and keep only the most recent one per roll number. Continue?')) return
    try {
      const snap = await getDocs(query(collection(db, 'testMarks'), where('testId', '==', testId)))
      const all = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      // Group by rollNumber, keep newest, delete the rest
      const groups = {}
      all.forEach(m => {
        const key = String(m.rollNumber || '').trim()
        if (!key) return
        if (!groups[key]) groups[key] = []
        groups[key].push(m)
      })
      let deleted = 0
      for (const key in groups) {
        const group = groups[key]
        if (group.length <= 1) continue
        // Sort by createdAt desc, keep first
        group.sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        for (let i = 1; i < group.length; i++) {
          await deleteDoc(doc(db, 'testMarks', group[i].id))
          deleted++
        }
      }
      alert(`Cleanup complete. Removed ${deleted} duplicate record${deleted === 1 ? '' : 's'}.`)
      window.location.reload()
    } catch(e) { alert(`Cleanup failed: ${e.message}`) }
  }

  // Sort marks
  const sortedMarks = [...marks].sort((a, b) => {
    if (sortBy === 'marks') {
      if (a.isAbsent && b.isAbsent) return 0
      if (a.isAbsent) return 1
      if (b.isAbsent) return -1
      return Number(b.marksObtained || 0) - Number(a.marksObtained || 0)
    }
    if (sortBy === 'name') return (a.studentName || '').localeCompare(b.studentName || '')
    if (sortBy === 'roll') return (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0)
    return 0
  })

  // Chart data — appeared students sorted by marks desc
  const chartData = appeared
    .sort((a, b) => Number(b.marksObtained || 0) - Number(a.marksObtained || 0))
    .map(m => ({
      name: m.studentName?.split(' ')[0] || 'Student',
      fullName: m.studentName,
      marks: Number(m.marksObtained || 0),
      max: Number(test.maxMarks || 0),
      pct: Number(test.maxMarks) > 0 ? Math.round((Number(m.marksObtained || 0) / Number(test.maxMarks)) * 100) : 0,
      absent: false
    }))

  // Distribution buckets
  const buckets = [
    { label:'90–100%', min:90, max:100, color:'#1a4a2e' },
    { label:'75–89%', min:75, max:89, color:'#2a6b45' },
    { label:'60–74%', min:60, max:74, color:'#c9a227' },
    { label:'40–59%', min:40, max:59, color:'#e8a020' },
    { label:'Below 40%', min:0, max:39, color:'#8b1a1a' },
  ]
  const distData = buckets.map(b => ({
    label: b.label,
    count: appeared.filter(m => {
      const pct = Number(test.maxMarks) > 0 ? Math.round((Number(m.marksObtained || 0) / Number(test.maxMarks)) * 100) : 0
      return pct >= b.min && pct <= b.max
    }).length,
    color: b.color
  }))

  const passLine = Number(test.maxMarks) > 0 ? Number(test.passMarks || 0) : 0

  return (
    <div style={{ padding:'24px 28px', maxWidth:1200 }}>
      {/* Back button */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <button onClick={() => navigate('/tests')} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, padding:0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Tests
        </button>
        <button onClick={handleDedupe} style={{ fontSize:12, padding:'6px 12px', background:'var(--gold-light)', color:'var(--gold-dark)', border:'1px solid rgba(201,162,39,0.3)', borderRadius:'var(--radius-sm)', cursor:'pointer', fontWeight:500 }} title="Scan and remove duplicate student entries for this test">
          Clean up duplicates
        </button>
      </div>

      {/* Test header */}
      <div className="fade-in" style={{ background:'var(--green-dark)', borderRadius:'var(--radius-lg)', padding:'24px 28px', marginBottom:24, color:'white', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-40, right:-40, width:160, height:160, borderRadius:'50%', background:'rgba(201,162,39,0.08)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg, var(--gold), transparent)' }} />
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
          <div>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color:'white', marginBottom:6 }}>{test.testName}</h1>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {[
                { label: test.className },
                { label: test.subject },
                { label: test.testDate },
                { label: `Max: ${test.maxMarks} marks` },
                { label: `Pass: ${test.passMarks} marks` },
                test.syllabusScope && { label: `Scope: ${test.syllabusScope}` },
              ].filter(Boolean).map((item, i) => (
                <span key={i} style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.85)', border:'1px solid rgba(255,255,255,0.15)' }}>
                  {item.label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <span style={{ fontSize:11, padding:'4px 12px', borderRadius:16, background: marks.length > 0 ? 'rgba(26,74,46,0.4)' : 'rgba(201,162,39,0.3)', color: marks.length > 0 ? '#9fe1cb' : 'var(--gold)', fontWeight:600, border:`1px solid ${marks.length > 0 ? 'rgba(26,74,46,0.6)' : 'rgba(201,162,39,0.4)'}` }}>
              {marks.length > 0 ? '✓ Marks entered' : '⏳ Marks pending'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:12, marginBottom:24 }}>
        {[
          { label:'Appeared', value: appeared.length, color:'var(--green)' },
          { label:'Absent', value: absent.length, color: absent.length > 0 ? 'var(--crimson)' : 'var(--text-muted)', bg: absent.length > 0 ? 'var(--crimson-light)' : 'var(--white)', border: absent.length > 0 ? 'rgba(139,26,26,0.15)' : 'var(--gray-100)' },
          { label:'Class average', value: `${avg}/${test.maxMarks}`, sub: `${avgPct}%`, color: avgPct >= 60 ? 'var(--green)' : avgPct >= 40 ? 'var(--gold-dark)' : 'var(--crimson)' },
          { label:'Highest', value: highest, color:'var(--green)' },
          { label:'Lowest', value: lowest, color: lowest < Number(test.passMarks||0) ? 'var(--crimson)' : 'var(--text)' },
          { label:'Pass rate', value: `${passRate}%`, sub: `${passed}/${appeared.length}`, color: passRate >= 80 ? 'var(--green)' : passRate >= 60 ? 'var(--gold-dark)' : 'var(--crimson)' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg || 'var(--white)', borderRadius:'var(--radius-lg)', padding:'14px 16px', border:`1px solid ${s.border || 'var(--gray-100)'}` }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:600, color: s.color, lineHeight:1 }}>{s.value}</div>
            {s.sub && <div style={{ fontSize:11, color: s.color, marginTop:2, fontWeight:600 }}>{s.sub}</div>}
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {appeared.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:24 }}>
          {/* Bar chart */}
          <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'18px 20px' }}>
            <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:14 }}>Marks — {appeared.length} students (descending)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={appeared.length > 20 ? 8 : appeared.length > 10 ? 14 : 22}>
                <XAxis dataKey="name" tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} interval={appeared.length > 15 ? 2 : 0} />
                <YAxis domain={[0, Number(test.maxMarks || 100)]} tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <ReferenceLine y={Number(test.passMarks || 0)} stroke="var(--crimson)" strokeDasharray="4 4" label={{ value:`Pass (${test.passMarks})`, fill:'var(--crimson)', fontSize:10, position:'right' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="marks" radius={[3,3,0,0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.pct >= 80 ? '#1a4a2e' : d.pct >= 60 ? '#2a6b45' : d.pct >= Number(test.passMarks||0)/Number(test.maxMarks||1)*100 ? '#c9a227' : '#8b1a1a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Distribution */}
          <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'18px 20px' }}>
            <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:14 }}>Score distribution</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {distData.map(d => (
                <div key={d.label}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:12, color:'var(--text-muted)' }}>{d.label}</span>
                    <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{d.count}</span>
                  </div>
                  <div style={{ height:8, background:'var(--gray-100)', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ width: appeared.length > 0 ? `${(d.count/appeared.length)*100}%` : '0%', height:'100%', background:d.color, borderRadius:4, transition:'width 0.5s ease' }} />
                  </div>
                </div>
              ))}
            </div>
            {absent.length > 0 && (
              <div style={{ marginTop:16, padding:'10px 12px', background:'var(--crimson-light)', borderRadius:'var(--radius-sm)', border:'1px solid rgba(139,26,26,0.15)' }}>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--crimson)', marginBottom:4 }}>{absent.length} absent</div>
                <div style={{ fontSize:11, color:'rgba(139,26,26,0.7)' }}>{absent.map(m => m.studentName).join(', ')}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Absent students highlight */}
      {absent.length > 0 && (
        <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.15)', borderRadius:'var(--radius-lg)', padding:'16px 20px', marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--crimson)', marginBottom:10 }}>
            ⚠ {absent.length} student{absent.length > 1 ? 's' : ''} absent for this test
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {absent.sort((a,b) => Number(a.rollNumber||0) - Number(b.rollNumber||0)).map(m => (
              <div key={m.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', background:'var(--white)', borderRadius:'var(--radius-sm)', border:'1px solid rgba(139,26,26,0.15)' }}>
                <div style={{ width:24, height:24, borderRadius:'50%', background:'var(--crimson)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <span style={{ fontSize:10, fontWeight:700, color:'white' }}>{(m.studentName||'?')[0]}</span>
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{m.studentName}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>Roll {m.rollNumber || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Marks table */}
      {marks.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:14 }}>
          No marks entered for this test yet. Teachers enter marks from the teacher app.
        </div>
      ) : (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)' }}>Student Marks</h2>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:12, color:'var(--text-muted)' }}>Sort by:</span>
              {[['marks','Marks'],['name','Name'],['roll','Roll No.']].map(([k,l]) => (
                <button key={k} onClick={() => setSortBy(k)} style={{ padding:'4px 11px', borderRadius:16, border:'1px solid', borderColor: sortBy===k ? 'var(--green)' : 'var(--gray-200)', background: sortBy===k ? 'var(--green-light)' : 'var(--white)', color: sortBy===k ? 'var(--green)' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  {['Rank','Roll No.','Student Name','Marks','Out of','Score','Status'].map(h => (
                    <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedMarks.map((m, i) => {
                  const rank = sortBy === 'marks' && !m.isAbsent ? appeared.filter(a => Number(a.marksObtained||0) > Number(m.marksObtained||0)).length + 1 : null
                  const passed = !m.isAbsent && Number(m.marksObtained||0) >= Number(test.passMarks||0)
                  return (
                    <tr key={m.id} style={{ borderTop:'1px solid var(--gray-50)', background: m.isAbsent ? 'var(--crimson-light)' : i%2===0 ? 'var(--white)' : 'var(--gray-50)' }}>
                      <td style={{ padding:'11px 16px' }}>
                        {m.isAbsent ? <span style={{ fontSize:11, color:'var(--crimson)' }}>—</span> : <Medal rank={rank || i+1} />}
                      </td>
                      <td style={{ padding:'11px 16px', color:'var(--text-muted)', fontWeight:500 }}>{m.rollNumber || '—'}</td>
                      <td style={{ padding:'11px 16px', fontWeight: rank <= 3 ? 600 : 500, color:'var(--text)' }}>{m.studentName}</td>
                      <td style={{ padding:'11px 16px', fontFamily:'var(--font-display)', fontSize:16, fontWeight:700, color: m.isAbsent ? 'var(--crimson)' : passed ? 'var(--green-dark)' : 'var(--crimson)' }}>
                        {m.isAbsent ? '—' : m.marksObtained}
                      </td>
                      <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{test.maxMarks}</td>
                      <td style={{ padding:'11px 16px' }}>
                        {m.isAbsent ? <span style={{ fontSize:12, color:'var(--crimson)' }}>Absent</span> : <ScoreBadge marks={Number(m.marksObtained||0)} maxMarks={Number(test.maxMarks||0)} passMarks={Number(test.passMarks||0)} />}
                      </td>
                      <td style={{ padding:'11px 16px' }}>
                        {m.isAbsent ? (
                          <span style={{ fontSize:11, padding:'3px 9px', borderRadius:8, background:'var(--crimson)', color:'white', fontWeight:600 }}>Absent</span>
                        ) : passed ? (
                          <span style={{ fontSize:11, padding:'3px 9px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>Pass</span>
                        ) : (
                          <span style={{ fontSize:11, padding:'3px 9px', borderRadius:8, background:'var(--crimson-light)', color:'var(--crimson)', fontWeight:500 }}>Fail</span>
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
    </div>
  )
}
