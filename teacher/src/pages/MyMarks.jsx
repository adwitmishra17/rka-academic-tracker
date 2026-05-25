import React, { useState, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { getTeacherClasses } from '../utils/teacherClasses'

function median(arr) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a,b) => a-b)
  const mid = Math.floor(sorted.length/2)
  return sorted.length%2 ? sorted[mid] : Math.round((sorted[mid-1]+sorted[mid])/2)
}

function pct(marks, max) { return max > 0 ? Math.round((marks/max)*100) : 0 }

function ScoreBadge({ val, max, pass }) {
  const p = pct(val, max)
  const passP = pct(pass, max)
  const color = p >= 80 ? 'var(--green)' : p >= passP ? 'var(--gold-dark)' : 'var(--crimson)'
  const bg = p >= 80 ? 'var(--green-light)' : p >= passP ? 'var(--gold-light)' : 'var(--crimson-light)'
  return <span style={{fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:8,background:bg,color}}>{p}%</span>
}

export default function MyMarks() {
  const { teacher, user } = useAuth()
  const [tests, setTests] = useState([])
  const [marks, setMarks] = useState([])
  const [selectedTest, setSelectedTest] = useState(null)
  const [viewMode, setViewMode] = useState('test') // test | class | student
  const [filterClass, setFilterClass] = useState('All')
  const [threshold, setThreshold] = useState(40)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [myClasses, setMyClasses] = useState([])
  useEffect(() => {
    if (teacher || user) getTeacherClasses(teacher, user).then(setMyClasses)
  }, [teacher, user])

  useEffect(() => {
    async function load() {
      try {
        const testsSnap = await getDocs(collection(db, 'tests'))
        const allTests = testsSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        // Only show tests owned by this teacher (matched by teacherId; teacherName fallback for legacy data)
        const teacherIdMatch = teacher?.id
        const teacherNameLower = (teacher?.fullName || '').toLowerCase().trim()
        const myTests = allTests.filter(t => {
          if (teacherIdMatch && t.teacherId === teacherIdMatch) return true
          if (teacherNameLower && (t.teacherName || '').toLowerCase().trim() === teacherNameLower) return true
          return false
        })
        setTests(myTests.sort((a,b) => (b.testDate||'').localeCompare(a.testDate||'')))

        // Only fetch marks for tests this teacher owns
        const myTestIds = new Set(myTests.map(t => t.id))
        const marksSnap = await getDocs(collection(db, 'testMarks'))
        const allMarks = marksSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        const myMarks = allMarks.filter(m => myTestIds.has(m.testId))
        setMarks(myMarks)
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [teacher])

  const classes = ['All', ...new Set(tests.map(t => t.className))]

  const filteredTests = tests.filter(t =>
    (filterClass === 'All' || t.className === filterClass) &&
    (!search || t.testName?.toLowerCase().includes(search.toLowerCase()) || t.subject?.toLowerCase().includes(search.toLowerCase()))
  )

  // For a selected test — compute stats
  function testStats(test) {
    const tm = marks.filter(m => m.testId === test.id)
    const appeared = tm.filter(m => !m.isAbsent)
    const scores = appeared.map(m => Number(m.marksObtained||0))
    const passMarks = Number(test.passMarks||0)
    const maxMarks = Number(test.maxMarks||1)
    const avg = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0
    const med = median(scores)
    const highest = scores.length ? Math.max(...scores) : 0
    const lowest = scores.length ? Math.min(...scores) : 0
    const passed = scores.filter(s => s >= passMarks).length
    const belowThreshold = appeared.filter(m => pct(Number(m.marksObtained||0), maxMarks) < threshold)
    return { appeared: appeared.length, absent: tm.filter(m=>m.isAbsent).length, avg, med, highest, lowest, passed, belowThreshold, total: tm.length }
  }

  // Student-wise view across all tests
  const studentMap = {}
  marks.filter(m => myClasses.includes(m.className) || myClasses.length === 0).forEach(m => {
    const key = `${m.studentName}||${m.className}`
    if (!studentMap[key]) studentMap[key] = { name: m.studentName, className: m.className, tests: [] }
    const test = tests.find(t => t.id === m.testId)
    if (test) studentMap[key].tests.push({ ...m, testName: test.testName, maxMarks: test.maxMarks, passMarks: test.passMarks })
  })
  const studentList = Object.values(studentMap)
    .filter(s => filterClass === 'All' || s.className === filterClass)
    .filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()))
    .map(s => {
      const appeared = s.tests.filter(t => !t.isAbsent)
      const avgPct = appeared.length ? Math.round(appeared.reduce((a,t) => a + pct(Number(t.marksObtained||0), Number(t.maxMarks||1)), 0) / appeared.length) : null
      const belowThresholdCount = appeared.filter(t => pct(Number(t.marksObtained||0), Number(t.maxMarks||1)) < threshold).length
      return { ...s, avgPct, belowThresholdCount }
    })
    .sort((a,b) => (b.avgPct||0) - (a.avgPct||0))

  const inp = { padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

  return (
    <div style={{ padding:'20px' }}>
      <div className="fade-up" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color:'var(--green-dark)' }}>My Marks Dashboard</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>View performance test-wise, class-wise and student-wise</p>
      </div>

      {/* View mode tabs */}
      <div style={{ display:'flex', background:'var(--gray-50)', borderRadius:'var(--radius-md)', padding:3, border:'1px solid var(--gray-100)', marginBottom:16, width:'100%' }}>
        {[['test','By Test'],['class','By Class'],['student','By Student']].map(([k,l]) => (
          <button key={k} onClick={() => { setViewMode(k); setSelectedTest(null) }} style={{ flex:1, padding:'8px', borderRadius:'var(--radius-sm)', border:'none', fontSize:12, fontWeight:500, cursor:'pointer', background: viewMode===k ? 'var(--white)' : 'transparent', color: viewMode===k ? 'var(--green)' : 'var(--text-muted)', boxShadow: viewMode===k ? 'var(--shadow-sm)' : 'none', transition:'all 0.15s' }}>{l}</button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        <div style={{ position:'relative', flex:1, minWidth:150 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ ...inp, width:'100%', paddingLeft:28 }} />
        </div>
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ ...inp, width:'auto' }}>
          {classes.map(c => <option key={c}>{c}</option>)}
        </select>
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'0 10px', background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)' }}>
          <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>Flag below</span>
          <input type="number" min="0" max="100" value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width:44, border:'none', fontSize:13, fontWeight:600, color:'var(--crimson)', outline:'none', textAlign:'center' }} />
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>%</span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (

        <>
          {/* BY TEST VIEW */}
          {viewMode === 'test' && !selectedTest && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {filteredTests.length === 0 ? (
                <div style={{ textAlign:'center', padding:40, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:13 }}>No tests found.</div>
              ) : filteredTests.map(test => {
                const stats = testStats(test)
                return (
                  <div key={test.id} onClick={() => setSelectedTest(test)} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'14px 16px', cursor:'pointer', transition:'all 0.15s' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{test.testName}</div>
                        <div style={{ display:'flex', gap:6 }}>
                          <span style={{ fontSize:11, padding:'2px 7px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{test.className}</span>
                          <span style={{ fontSize:11, padding:'2px 7px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)' }}>{test.subject}</span>
                          <span style={{ fontSize:11, color:'var(--text-muted)' }}>{test.testDate}</span>
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ flexShrink:0, marginTop:3 }}><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                    {stats.appeared > 0 && (
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                        {[
                          { label:'Avg', value:`${pct(stats.avg, Number(test.maxMarks||1))}%`, color: pct(stats.avg, Number(test.maxMarks||1)) >= 60 ? 'var(--green)' : 'var(--crimson)' },
                          { label:'Median', value:`${pct(stats.med, Number(test.maxMarks||1))}%`, color:'var(--text)' },
                          { label:'Highest', value:`${stats.highest}/${test.maxMarks}`, color:'var(--green)' },
                          { label:'Below '+threshold+'%', value: stats.belowThreshold.length, color: stats.belowThreshold.length > 0 ? 'var(--crimson)' : 'var(--green)' },
                        ].map(s => (
                          <div key={s.label} style={{ background:'var(--gray-50)', borderRadius:'var(--radius-sm)', padding:'8px 6px', textAlign:'center' }}>
                            <div style={{ fontSize:14, fontWeight:700, color:s.color }}>{s.value}</div>
                            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!marks.some(m => m.testId === test.id) && <div style={{ fontSize:11, color:'var(--gold-dark)', marginTop:8 }}>⏳ Marks not entered yet</div>}
                  </div>
                )
              })}
            </div>
          )}

          {/* TEST DETAIL VIEW */}
          {viewMode === 'test' && selectedTest && (() => {
            const test = selectedTest
            const tm = marks.filter(m => m.testId === test.id)
            const appeared = tm.filter(m => !m.isAbsent)
            const scores = appeared.map(m => Number(m.marksObtained||0))
            const maxM = Number(test.maxMarks||1)
            const passM = Number(test.passMarks||0)
            const avg = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0
            const med = median(scores)
            const highest = scores.length ? Math.max(...scores) : 0
            const lowest = scores.length ? Math.min(...scores) : 0
            const sorted = [...appeared].sort((a,b) => Number(b.marksObtained||0)-Number(a.marksObtained||0))

            return (
              <div>
                <button onClick={() => setSelectedTest(null)} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:14, padding:0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                  Back to tests
                </button>

                <div style={{ background:'var(--green-dark)', borderRadius:'var(--radius-lg)', padding:'16px', marginBottom:14, color:'white' }}>
                  <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>{test.testName}</div>
                  <div style={{ fontSize:12, opacity:0.7 }}>{test.className} · {test.subject} · {test.testDate} · Max: {test.maxMarks} · Pass: {test.passMarks}</div>
                </div>

                {/* Stats */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                  {[
                    { label:'Average', value:`${pct(avg,maxM)}%`, sub:`${avg}/${test.maxMarks}`, color:'var(--green)' },
                    { label:'Median', value:`${pct(med,maxM)}%`, sub:`${med}/${test.maxMarks}`, color:'var(--text)' },
                    { label:'Highest', value:`${highest}/${test.maxMarks}`, sub:`${pct(highest,maxM)}%`, color:'var(--green)' },
                    { label:'Lowest', value:`${lowest}/${test.maxMarks}`, sub:`${pct(lowest,maxM)}%`, color: pct(lowest,maxM) < pct(passM,maxM) ? 'var(--crimson)' : 'var(--text)' },
                    { label:'Appeared', value: appeared.length, color:'var(--text)' },
                    { label:`Below ${threshold}%`, value: appeared.filter(m=>pct(Number(m.marksObtained||0),maxM)<threshold).length, color:'var(--crimson)' },
                  ].map(s => (
                    <div key={s.label} style={{ background:'var(--white)', borderRadius:'var(--radius-md)', padding:'12px 10px', border:'1px solid var(--gray-100)', textAlign:'center' }}>
                      <div style={{ fontSize:18, fontWeight:700, color:s.color, fontFamily:'var(--font-display)' }}>{s.value}</div>
                      {s.sub && <div style={{ fontSize:10, color:'var(--text-muted)' }}>{s.sub}</div>}
                      <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Student list */}
                {tm.filter(m=>m.isAbsent).length > 0 && (
                  <div style={{ background:'var(--crimson-light)', borderRadius:'var(--radius-md)', padding:'10px 14px', marginBottom:10, fontSize:12, color:'var(--crimson)' }}>
                    <strong>Absent:</strong> {tm.filter(m=>m.isAbsent).map(m=>m.studentName).join(', ')}
                  </div>
                )}

                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {sorted.map((m,i) => {
                    const p = pct(Number(m.marksObtained||0), maxM)
                    const isBelow = p < threshold
                    return (
                      <div key={m.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background: isBelow ? 'var(--crimson-light)' : 'var(--white)', borderRadius:'var(--radius-md)', border:`1px solid ${isBelow ? 'rgba(139,26,26,0.15)' : 'var(--gray-100)'}` }}>
                        <span style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', minWidth:22 }}>#{i+1}</span>
                        <span style={{ flex:1, fontSize:13, fontWeight:500, color:'var(--text)' }}>{m.studentName}</span>
                        <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{m.marksObtained}/{test.maxMarks}</span>
                        <ScoreBadge val={Number(m.marksObtained||0)} max={maxM} pass={passM} />
                        {isBelow && <span style={{ fontSize:10, color:'var(--crimson)', fontWeight:600 }}>⚠</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* BY CLASS VIEW */}
          {viewMode === 'class' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {(filterClass === 'All' ? myClasses : [filterClass]).map(cls => {
                const classTests = tests.filter(t => t.className === cls)
                const classMarks = marks.filter(m => m.className === cls && !m.isAbsent)
                const overallAvg = classMarks.length
                  ? Math.round(classMarks.reduce((a,m) => a + pct(Number(m.marksObtained||0), Number(tests.find(t=>t.id===m.testId)?.maxMarks||1)), 0) / classMarks.length)
                  : null
                return (
                  <div key={cls} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                    <div style={{ padding:'12px 16px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{cls}</span>
                      <div style={{ display:'flex', gap:10, fontSize:12, color:'var(--green-mid)' }}>
                        <span>{classTests.length} tests</span>
                        {overallAvg !== null && <span style={{ fontWeight:600, color: overallAvg >= 60 ? 'var(--green)' : 'var(--crimson)' }}>Overall avg: {overallAvg}%</span>}
                      </div>
                    </div>
                    <div style={{ padding:'8px 12px', display:'flex', flexDirection:'column', gap:6 }}>
                      {classTests.map(test => {
                        const stats = testStats(test)
                        return (
                          <div key={test.id} onClick={() => { setSelectedTest(test); setViewMode('test') }} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:'var(--radius-sm)', background:'var(--gray-50)', cursor:'pointer' }}>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>{test.testName}</div>
                              <div style={{ fontSize:11, color:'var(--text-muted)' }}>{test.subject} · {test.testDate}</div>
                            </div>
                            {stats.appeared > 0 ? (
                              <div style={{ display:'flex', gap:8, fontSize:11 }}>
                                <span style={{ color:'var(--green)', fontWeight:600 }}>Avg {pct(stats.avg, Number(test.maxMarks||1))}%</span>
                                <span style={{ color:'var(--text-muted)' }}>Med {pct(stats.med, Number(test.maxMarks||1))}%</span>
                                {stats.belowThreshold.length > 0 && <span style={{ color:'var(--crimson)', fontWeight:600 }}>⚠{stats.belowThreshold.length}</span>}
                              </div>
                            ) : <span style={{ fontSize:11, color:'var(--text-muted)' }}>No marks</span>}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                          </div>
                        )
                      })}
                      {classTests.length === 0 && <div style={{ fontSize:12, color:'var(--text-muted)', padding:'8px 0', fontStyle:'italic' }}>No tests for this class yet.</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* BY STUDENT VIEW */}
          {viewMode === 'student' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {studentList.length === 0 ? (
                <div style={{ textAlign:'center', padding:40, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:13 }}>No student data found.</div>
              ) : studentList.map((s,i) => (
                <div key={i} style={{ background: s.belowThresholdCount > 0 ? 'var(--crimson-light)' : 'var(--white)', borderRadius:'var(--radius-lg)', border:`1px solid ${s.belowThresholdCount > 0 ? 'rgba(139,26,26,0.15)' : 'var(--gray-100)'}`, padding:'12px 14px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: s.tests.length > 0 ? 8 : 0 }}>
                    <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:'var(--green)' }}>{(s.name||'?')[0]}</span>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{s.name}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>{s.className}</div>
                    </div>
                    {s.avgPct !== null && (
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:15, fontWeight:700, color: s.avgPct >= 60 ? 'var(--green)' : 'var(--crimson)', fontFamily:'var(--font-display)' }}>{s.avgPct}%</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>overall avg</div>
                      </div>
                    )}
                  </div>
                  {s.belowThresholdCount > 0 && (
                    <div style={{ fontSize:11, color:'var(--crimson)', fontWeight:600, marginBottom:6 }}>
                      ⚠ Below {threshold}% in {s.belowThresholdCount} test{s.belowThresholdCount>1?'s':''}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                    {s.tests.sort((a,b)=>(a.testDate||'').localeCompare(b.testDate||'')).map((t,ti) => {
                      if (t.isAbsent) return <span key={ti} style={{ fontSize:11, padding:'3px 8px', borderRadius:8, background:'var(--gray-100)', color:'var(--text-muted)' }}>{t.testName?.slice(0,10)}: Absent</span>
                      const p = pct(Number(t.marksObtained||0), Number(t.maxMarks||1))
                      const below = p < threshold
                      return (
                        <span key={ti} style={{ fontSize:11, padding:'3px 8px', borderRadius:8, background: below ? 'var(--crimson)' : p >= 60 ? 'var(--green-light)' : 'var(--gold-light)', color: below ? 'white' : p >= 60 ? 'var(--green)' : 'var(--gold-dark)', fontWeight:500 }}>
                          {t.testName?.slice(0,10)}: {p}%
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
